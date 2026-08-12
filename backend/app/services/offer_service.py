"""Offer Letter cycle — invite+offer, candidate clarification/sign, then docs → IT → activate."""

import logging
import threading
from datetime import UTC, datetime, timedelta

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.auth import names_match
from app.schemas.offer import (
    AllowanceItem,
    BenefitItem,
    NegotiationRespondRequest,
    OfferApproveRequest,
    OfferCreateRequest,
    OfferDeclineRequest,
    OfferEditResendRequest,
    OfferExtendValidityRequest,
    OfferNegotiateRequest,
    OfferSignRequest,
    OfferTermsPayload,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.organization_service import recruiter_can_access_record, recruiter_people_scope

logger = logging.getLogger(__name__)


ACTIVE_OFFER_STATUSES = ("sent", "viewed", "signed")
MAX_NEGOTIATION_ROUNDS = 3
OFFER_SIGN_REQUIRED_DETAIL = "Offer signing is required before onboarding can begin."


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _send_email_bg(fn, **kwargs) -> None:
    """Background SMTP with retries and observability."""

    def _run() -> None:
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                fn(**kwargs)
                return
            except Exception as exc:  # noqa: BLE001
                if attempt == max_retries:
                    logger.error(
                        "Background email failed after %s attempts: %s",
                        max_retries,
                        exc,
                        exc_info=True,
                    )
                else:
                    logger.warning(
                        "Background email attempt %s/%s failed: %s",
                        attempt,
                        max_retries,
                        exc,
                    )

    threading.Thread(target=_run, daemon=True).start()


class OfferService:
    async def create_and_send(self, current_user: CurrentUser, request: OfferCreateRequest) -> dict:
        """Legacy/resend path: send offer to an existing candidate (no intake gate)."""
        candidate = await self._find_candidate(request.candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        await self._assert_recruiter_can_access(current_user, candidate, detail="You can only send offers to candidates within your organization.")
        if candidate.get("status") == "converted":
            raise HTTPException(status_code=409, detail="This candidate is already an employee.")

        candidate_id = candidate.get("user_id") or str(candidate["_id"])
        existing = await database.offer_letters.find_one(
            {
                "$or": [
                    {"candidate_id": candidate_id},
                    {"candidate_email": candidate.get("email")},
                ],
                "status": {"$in": list(ACTIVE_OFFER_STATUSES)},
            }
        )
        if existing:
            raise HTTPException(status_code=409, detail="This candidate already has an active offer letter.")

        offer_doc = self._build_offer_doc(
            terms=request,
            recruiter=current_user,
            candidate_name=candidate["full_name"],
            candidate_email=candidate["email"],
            candidate_id=candidate_id,
            invitation_token=candidate.get("invitation_token"),
            version=1,
        )
        result = await database.offer_letters.insert_one(offer_doc)
        offer_doc["_id"] = result.inserted_id

        now = datetime.now(UTC)
        await database.candidates.update_one(
            {"_id": candidate["_id"]}, {"$set": {"conversion_status": "offer_sent", "updated_at": now}}
        )

        try:
            email_service.send_offer_letter(
                to_email=candidate["email"],
                full_name=candidate["full_name"],
                job_title=request.job_title,
                department=request.department,
                start_date=request.start_date,
                organization_id=getattr(current_user, "organization_id", None),
            )
        except Exception:
            pass

        await create_notification(
            recipient_id=candidate_id,
            recipient_role="candidate",
            notif_type="offer_sent",
            title="Your offer letter has arrived",
            message=f"{current_user.full_name} sent you an offer for {request.job_title}. Review and sign it.",
            link="/offer",
            related_id=str(offer_doc["_id"]),
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": candidate_id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_sent",
                "outcome": "success",
                "created_at": now,
            }
        )
        return {"message": "Offer letter sent.", "offer": self._public(offer_doc)}

    async def create_with_invitation(
        self,
        *,
        terms: OfferTermsPayload,
        recruiter: CurrentUser,
        candidate_name: str,
        candidate_email: str,
        invitation_token: str,
    ) -> dict:
        """Create offer letter bound to an invitation (pre-registration)."""
        await self.withdraw_unsigned_for_email(candidate_email)
        offer_doc = self._build_offer_doc(
            terms=terms,
            recruiter=recruiter,
            candidate_name=candidate_name,
            candidate_email=candidate_email,
            candidate_id=None,
            invitation_token=invitation_token,
            version=1,
        )
        result = await database.offer_letters.insert_one(offer_doc)
        offer_doc["_id"] = result.inserted_id
        return offer_doc

    async def withdraw_unsigned_for_email(self, email: str) -> None:
        now = datetime.now(UTC)
        await database.offer_letters.update_many(
            {
                "candidate_email": email.lower().strip(),
                "status": {"$in": ["sent", "viewed"]},
            },
            {"$set": {"status": "withdrawn", "updated_at": now, "withdrawn_at": now}},
        )

    async def bind_to_candidate(
        self,
        *,
        user_id: str,
        email: str,
        invitation_token: str | None,
        full_name: str,
    ) -> dict | None:
        """Attach a pre-invite offer to the newly verified candidate account."""
        now = datetime.now(UTC)
        query: dict = {
            "status": {"$in": ["sent", "viewed"]},
            "$or": [{"candidate_email": email.lower().strip()}],
        }
        if invitation_token:
            query["$or"].append({"invitation_token": invitation_token})

        offer = await database.offer_letters.find_one(query, sort=[("created_at", -1)])
        if not offer:
            return None

        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "candidate_id": user_id,
                    "candidate_name": full_name or offer.get("candidate_name"),
                    "updated_at": now,
                }
            },
        )
        await database.candidates.update_one(
            {"user_id": user_id},
            {"$set": {"conversion_status": "offer_sent", "updated_at": now}},
        )
        offer["candidate_id"] = user_id
        return offer

    async def get_mine(self, current_user: CurrentUser) -> dict:
        offer = await database.offer_letters.find_one(
            {
                "$or": [
                    {"candidate_id": current_user.id},
                    {"candidate_email": current_user.email},
                ],
                "status": {"$nin": ["withdrawn"]},
            },
            sort=[("version", -1), ("created_at", -1)],
        )
        if not offer:
            return {"offer": None}
        if offer["status"] == "sent":
            await database.offer_letters.update_one(
                {"_id": offer["_id"]}, {"$set": {"status": "viewed", "viewed_at": datetime.now(UTC)}}
            )
            offer["status"] = "viewed"
        # Older edit-and-resend versions reset negotiation to empty; recover the
        # clarification reply from the withdrawn parent so the candidate still sees it.
        offer = await self._hydrate_clarification_from_parent(offer)
        return {"offer": self._public(offer)}

    async def _hydrate_clarification_from_parent(self, offer: dict) -> dict:
        negotiation = offer.get("negotiation") or {}
        has_reply = bool(
            (negotiation.get("recruiter_note") or "").strip()
            or (negotiation.get("decision_summary") or "").strip()
        )
        if negotiation.get("status") in ("resolved", "closed", "pending") and has_reply:
            return offer
        parent_id = offer.get("parent_offer_id")
        if not parent_id:
            return offer
        try:
            parent = await database.offer_letters.find_one({"_id": ObjectId(parent_id)})
        except Exception:
            parent = None
        if not parent:
            return offer
        parent_neg = parent.get("negotiation") or {}
        parent_reply = (parent_neg.get("recruiter_note") or "").strip() or (
            parent_neg.get("decision_summary") or ""
        ).strip()
        if not parent_reply and not parent_neg.get("note"):
            return offer
        merged = {
            **self._empty_negotiation_state(),
            **{k: v for k, v in negotiation.items() if v not in (None, "", [], "none")},
            "status": negotiation.get("status")
            if negotiation.get("status") in ("resolved", "closed", "pending")
            else (parent_neg.get("status") if parent_neg.get("status") in ("resolved", "closed") else "resolved"),
            "note": negotiation.get("note") or parent_neg.get("note"),
            "requested_at": negotiation.get("requested_at") or parent_neg.get("requested_at"),
            "requested_changes": negotiation.get("requested_changes")
            or parent_neg.get("requested_changes")
            or [],
            "responded_at": negotiation.get("responded_at") or parent_neg.get("responded_at"),
            "recruiter_note": (negotiation.get("recruiter_note") or "").strip() or parent_neg.get("recruiter_note"),
            "decision_summary": (negotiation.get("decision_summary") or "").strip()
            or parent_neg.get("decision_summary"),
        }
        return {**offer, "negotiation": merged}

    async def has_signed_offer(self, user_id: str, email: str | None = None) -> bool:
        query: dict = {"status": "signed", "$or": [{"candidate_id": user_id}]}
        if email:
            query["$or"].append({"candidate_email": email})
        doc = await database.offer_letters.find_one(query)
        return bool(doc)

    async def require_signed_offer(
        self,
        user_id: str,
        email: str | None = None,
        *,
        detail: str = OFFER_SIGN_REQUIRED_DETAIL,
    ) -> None:
        """Hard gate: candidates must have a signed offer before onboarding mutations."""
        if not await self.has_signed_offer(user_id, email):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    async def require_signed_offer_for_candidate(self, current_user: CurrentUser) -> None:
        """No-op for non-candidates; raises 403 when a candidate has not signed."""
        if getattr(current_user, "role", None) != "candidate":
            return
        await self.require_signed_offer(current_user.id, current_user.email)

    async def list_for_candidate(self, current_user: CurrentUser, candidate_id: str) -> dict:
        if current_user.role not in ("recruiter", "super_admin"):
            raise HTTPException(status_code=403, detail="Not authorized.")
        offers = (
            await database.offer_letters.find(
                {
                    "$or": [
                        {"candidate_id": candidate_id},
                        {"candidate_email": candidate_id},
                    ]
                }
            )
            .sort("created_at", -1)
            .to_list(length=20)
        )
        return {"offers": [self._public(o) for o in offers]}

    async def list_pending_negotiations(self, current_user: CurrentUser) -> dict:
        query: dict = {"negotiation.status": "pending", "status": {"$in": ["sent", "viewed", "expired"]}}
        scope = await recruiter_people_scope(current_user)
        if scope:
            query = {"$and": [query, scope]}
        docs = await database.offer_letters.find(query).sort("negotiation.requested_at", -1).to_list(length=50)
        return {"offers": [self._public(o) for o in docs], "count": len(docs)}

    async def list_awaiting_offer_response(self, current_user: CurrentUser) -> dict:
        """Registered candidates with an unsigned active offer."""
        query: dict = {"status": {"$in": ["sent", "viewed", "expired"]}, "candidate_id": {"$ne": None}}
        scope = await recruiter_people_scope(current_user)
        if scope:
            query = {"$and": [query, scope]}
        docs = await database.offer_letters.find(query).sort("sent_at", -1).to_list(length=100)
        out = []
        for offer in docs:
            if offer.get("signed_at"):
                continue
            neg = (offer.get("negotiation") or {}).get("status")
            if neg == "pending":
                continue
            out.append(self._public(offer))
        return {"offers": out, "count": len(out)}

    async def sign(self, current_user: CurrentUser, offer_id: str, request: OfferSignRequest) -> dict:
        offer = await self._find(offer_id)
        self._assert_owner(current_user, offer)
        if offer["status"] not in ("sent", "viewed"):
            raise HTTPException(
                status_code=409,
                detail="This offer can only be signed while it is still open. Open your offer letter to check its current status.",
            )

        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") == "pending":
            raise HTTPException(
                status_code=409,
                detail="Your clarification request is pending. Wait for your recruiter to respond before signing.",
            )

        expires_at = offer.get("expires_at")
        if expires_at:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at < datetime.now(UTC):
                await database.offer_letters.update_one(
                    {"_id": offer["_id"]},
                    {"$set": {"status": "expired"}},
                )
                raise HTTPException(
                    status_code=410,
                    detail="This offer letter has expired. Ask your recruiter to extend or resend it.",
                )

        now = datetime.now(UTC)
        expected_name = offer.get("candidate_name") or current_user.full_name
        if not names_match(request.full_legal_name, expected_name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Full legal name must match your registered name: {expected_name}",
            )
        signature = {
            "full_legal_name": " ".join((expected_name or request.full_legal_name).split()),
            "signature_data_url": request.signature_data_url if request.signature_method == "pad" else None,
            "signature_upload_url": request.signature_upload_url if request.signature_method == "upload" else None,
            "signature_method": request.signature_method,
            "agreed": request.agreed,
            "signed_at": now.isoformat(),
            "ip_hint": None,
        }

        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "status": "signed",
                    "signature": signature,
                    "signed_at": now,
                    "updated_at": now,
                }
            },
        )

        candidate_query = {"user_id": offer.get("candidate_id")} if offer.get("candidate_id") else {"email": offer.get("candidate_email")}
        if candidate_query:
            await database.candidates.update_one(
                candidate_query,
                {"$set": {"conversion_status": "offer_signed", "updated_at": now}},
            )

        if offer.get("recruiter_id"):
            await create_notification(
                recipient_id=offer["recruiter_id"],
                recipient_role="recruiter",
                notif_type="offer_signed",
                title="Offer letter signed",
                message=(
                    f"{offer['candidate_name']} signed their offer letter (v{offer.get('version', 1)}). "
                    "They will now complete documents; then you can start IT provisioning."
                ),
                link="/dashboard/recruiter/candidates",
                related_id=str(offer["_id"]),
            )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "module": "offers",
                "action": "offer_signed",
                "offer_id": str(offer["_id"]),
                "email": current_user.email,
                "actor_email": current_user.email,
                "outcome": "success",
                "created_at": now,
            }
        )

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Offer signed. You can now complete your documents and profile.",
            "offer": self._public(refreshed),
        }

    async def decline(self, current_user: CurrentUser, offer_id: str, request: OfferDeclineRequest) -> dict:
        offer = await self._find(offer_id)
        self._assert_owner(current_user, offer)
        if offer["status"] not in ("sent", "viewed"):
            raise HTTPException(status_code=409, detail="This offer can no longer be declined.")
        now = datetime.now(UTC)
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {"$set": {"status": "declined", "declined_reason": request.reason, "declined_at": now, "updated_at": now}},
        )
        from app.services.people_history import cycle_group_key, mark_candidate_historical_fields

        candidate_query = {"user_id": offer.get("candidate_id")} if offer.get("candidate_id") else {"email": offer.get("candidate_email")}
        if candidate_query:
            await database.candidates.update_one(
                candidate_query,
                {
                    "$set": {
                        **mark_candidate_historical_fields(
                            reason="offer_declined",
                            lifecycle_state="declined",
                            when=now,
                        ),
                        "conversion_status": "offer_declined",
                        "cycle_group_key": cycle_group_key(offer.get("candidate_email") or current_user.email),
                        "updated_at": now,
                    }
                },
            )
        if offer.get("recruiter_id"):
            await create_notification(
                recipient_id=offer["recruiter_id"],
                recipient_role="recruiter",
                notif_type="offer_declined",
                title="Offer letter declined",
                message=f"{offer['candidate_name']} declined their offer letter.",
                link="/dashboard/recruiter/candidates",
                related_id=str(offer["_id"]),
            )
        return {"message": "Offer declined."}

    async def negotiate(self, current_user: CurrentUser, offer_id: str, request: OfferNegotiateRequest) -> dict:
        offer = await self._find(offer_id)
        self._assert_owner(current_user, offer)
        if offer["status"] not in ("sent", "viewed"):
            raise HTTPException(status_code=409, detail="This offer cannot receive clarification requests.")
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") == "pending":
            raise HTTPException(status_code=409, detail="A clarification request is already pending.")

        now = datetime.now(UTC)
        rounds_used = int(offer.get("negotiation_rounds_used") or 0)
        negotiation_doc = {
            "status": "pending",
            "proposed_salary": None,
            "proposed_start_date": None,
            "proposed_allowances": [],
            "proposed_salary_breakdown": [],  # legacy alias for older stored docs
            "proposed_benefits": [],
            "requested_changes": ["clarification"],
            "note": request.note,
            "requested_at": now,
            "responded_at": None,
            "recruiter_note": None,
            "decision_summary": None,
        }
        history_entry = self._history_entry(
            actor_role="candidate",
            action="requested",
            when=now,
            note=request.note,
            snapshot={
                "requested_changes": ["clarification"],
            },
        )
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "negotiation": negotiation_doc,
                    "negotiation_used": True,
                    "negotiation_rounds_used": rounds_used + 1,
                    "updated_at": now,
                },
                "$push": {"negotiation_history": history_entry},
            },
        )

        if offer.get("recruiter_id"):
            note_preview = (request.note or "").strip()
            notif_message = f"{offer['candidate_name']} sent a clarification request on the offer letter."
            if note_preview:
                notif_message = f"{offer['candidate_name']}: {note_preview[:180]}"
            await create_notification(
                recipient_id=offer["recruiter_id"],
                recipient_role="recruiter",
                notif_type="offer_clarification",
                title="Offer clarification requested",
                message=notif_message,
                link="/dashboard/recruiter/candidates",
                related_id=str(offer["_id"]),
            )
            recruiter = await database.recruiters.find_one({"user_id": offer["recruiter_id"]}) or {}
            to_email = recruiter.get("email") or offer.get("recruiter_email")
            if not to_email:
                user = await database.users.find_one({"_id": offer["recruiter_id"]}) or {}
                if not user and ObjectId.is_valid(str(offer["recruiter_id"])):
                    user = await database.users.find_one({"_id": ObjectId(str(offer["recruiter_id"]))}) or {}
                to_email = user.get("email")
            if to_email:
                _send_email_bg(
                    email_service.send_offer_clarification_request,
                    to_email=to_email,
                    recruiter_name=offer.get("recruiter_name") or "Recruiter",
                    candidate_name=offer.get("candidate_name") or "Candidate",
                    job_title=offer.get("job_title") or "",
                    note=request.note,
                    organization_id=offer.get("organization_id"),
                )

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Clarification sent to your recruiter. You will be notified when they respond.",
            "offer": self._public(refreshed),
        }

    async def accept_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        await self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending clarification on this offer.")

        now = datetime.now(UTC)
        decision_summary = request.decision_summary or "Recruiter responded to the clarification request."
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "negotiation.status": "resolved",
                    "negotiation.responded_at": now,
                    "negotiation.recruiter_note": request.recruiter_note,
                    "negotiation.decision_summary": decision_summary,
                    "updated_at": now,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="resolved",
                        when=now,
                        note=request.recruiter_note or request.decision_summary,
                        snapshot={
                            "decision_summary": decision_summary,
                        },
                    )
                },
            },
        )

        candidate_id = offer.get("candidate_id")
        if candidate_id:
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_clarification_resolved",
                title="Offer clarification resolved",
                message=(
                    request.recruiter_note.strip()
                    if request.recruiter_note and request.recruiter_note.strip()
                    else "Your recruiter responded to your offer clarification request. Review the response and continue."
                ),
                link="/offer",
                related_id=str(offer["_id"]),
            )
        if offer.get("candidate_email"):
            _send_email_bg(
                email_service.send_offer_clarification_result,
                to_email=offer["candidate_email"],
                full_name=offer.get("candidate_name") or "Candidate",
                job_title=offer.get("job_title") or "",
                outcome="resolved",
                recruiter_note=request.recruiter_note,
                organization_id=offer.get("organization_id"),
            )

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Clarification resolved. The candidate can review your response and continue.",
            "offer": self._public(refreshed),
        }

    async def counter_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        await self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending clarification on this offer.")

        return await self.accept_negotiation(current_user, offer_id, request)

    async def reject_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        await self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending clarification on this offer.")

        now = datetime.now(UTC)
        decision_summary = request.decision_summary or "The clarification request was closed by the recruiter."
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "negotiation.status": "closed",
                    "negotiation.responded_at": now,
                    "negotiation.recruiter_note": request.recruiter_note,
                    "negotiation.decision_summary": decision_summary,
                    "negotiation_used": True,
                    "updated_at": now,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="closed",
                        when=now,
                        note=request.recruiter_note or request.decision_summary,
                        snapshot={"decision_summary": decision_summary},
                    )
                },
            },
        )

        candidate_id = offer.get("candidate_id")
        if candidate_id:
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_clarification_closed",
                title="Offer clarification closed",
                message=(
                    request.recruiter_note.strip()
                    if request.recruiter_note and request.recruiter_note.strip()
                    else "Your recruiter closed the clarification request. Review their note and continue with the offer."
                ),
                link="/offer",
                related_id=str(offer["_id"]),
            )
        if offer.get("candidate_email"):
            _send_email_bg(
                email_service.send_offer_clarification_result,
                to_email=offer["candidate_email"],
                full_name=offer.get("candidate_name") or "Candidate",
                job_title=offer.get("job_title") or "",
                outcome="closed",
                recruiter_note=request.recruiter_note,
                organization_id=offer.get("organization_id"),
            )

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Clarification closed. The candidate can review your note and continue.",
            "offer": self._public(refreshed),
        }

    async def edit_and_resend(
        self, current_user: CurrentUser, offer_id: str, request: OfferEditResendRequest
    ) -> dict:
        """Edit any offer terms after clarification and resend as a new unsigned version."""
        offer = await self._find(offer_id)
        await self._assert_recruiter(current_user, offer)
        if offer.get("signed_at") or offer.get("status") == "signed":
            raise HTTPException(status_code=409, detail="Signed offers cannot be edited. Create a new invitation instead.")
        if offer.get("status") not in ("sent", "viewed", "expired"):
            raise HTTPException(
                status_code=409,
                detail="This offer cannot be edited in its current state. Create a new invitation instead if needed.",
            )

        now = datetime.now(UTC)
        next_version = int(offer.get("version") or 1) + 1
        negotiation = offer.get("negotiation") or {}
        decision_summary = (
            request.decision_summary
            or request.recruiter_note
            or "Recruiter updated the offer letter after clarification and resent it."
        )

        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "status": "withdrawn",
                    "negotiation.status": "resolved" if negotiation.get("status") == "pending" else negotiation.get("status") or "none",
                    "negotiation.responded_at": now if negotiation.get("status") == "pending" else negotiation.get("responded_at"),
                    "negotiation.recruiter_note": request.recruiter_note or negotiation.get("recruiter_note"),
                    "negotiation.decision_summary": decision_summary,
                    "updated_at": now,
                    "withdrawn_at": now,
                    "superseded_by_version": next_version,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="edited_and_resent",
                        when=now,
                        note=request.recruiter_note or decision_summary,
                        snapshot={
                            "decision_summary": decision_summary,
                            "job_title": request.job_title,
                            "monthly_salary": request.monthly_salary,
                            "start_date": request.start_date,
                            "version": next_version,
                        },
                    )
                },
            },
        )

        terms = OfferTermsPayload(
            job_title=request.job_title,
            department=request.department,
            employment_type=request.employment_type or "Full-time",
            office_location=request.office_location,
            is_remote=bool(getattr(request, "is_remote", False) or offer.get("is_remote")),
            reporting_manager=request.reporting_manager,
            start_date=request.start_date,
            monthly_salary=float(request.monthly_salary),
            currency=request.currency or "PKR",
            allowances=list(request.allowances or request.salary_breakdown or []),
            salary_breakdown=list(request.salary_breakdown or request.allowances or []),
            benefits=request.benefits or [],
            offer_expiry_days=request.offer_expiry_days,
            terms=request.terms or "",
            message_to_candidate=request.message_to_candidate,
        )
        expiry_days = request.offer_expiry_days or settings.OFFER_EXPIRE_DAYS
        if not request.offer_expiry_days and offer.get("expires_at") and offer.get("sent_at"):
            try:
                delta = offer["expires_at"] - offer["sent_at"]
                expiry_days = max(1, min(90, delta.days or settings.OFFER_EXPIRE_DAYS))
            except Exception:
                pass

        v_next = self._build_offer_doc(
            terms=terms,
            recruiter=current_user,
            candidate_name=offer.get("candidate_name") or "",
            candidate_email=offer.get("candidate_email") or "",
            candidate_id=offer.get("candidate_id"),
            invitation_token=offer.get("invitation_token"),
            version=next_version,
            parent_offer_id=str(offer["_id"]),
            expiry_days=expiry_days,
        )
        # Carry clarification context onto the new version so the candidate still
        # sees their question and the recruiter reply on the active (vN) letter.
        # Without this, get_mine returns empty negotiation and the UI hides the response.
        recruiter_reply = (request.recruiter_note or "").strip() or negotiation.get("recruiter_note")
        v_next["negotiation"] = {
            **self._empty_negotiation_state(),
            "status": "resolved",
            "note": negotiation.get("note"),
            "requested_at": negotiation.get("requested_at"),
            "requested_changes": list(negotiation.get("requested_changes") or []),
            "proposed_salary": negotiation.get("proposed_salary"),
            "proposed_start_date": negotiation.get("proposed_start_date"),
            "proposed_allowances": list(negotiation.get("proposed_allowances") or []),
            "proposed_salary_breakdown": list(
                negotiation.get("proposed_salary_breakdown") or negotiation.get("proposed_allowances") or []
            ),
            "proposed_benefits": list(negotiation.get("proposed_benefits") or []),
            "responded_at": now,
            "recruiter_note": recruiter_reply or decision_summary,
            "decision_summary": decision_summary,
        }

        prior_history = list(offer.get("negotiation_history") or [])
        prior_history.append(
            self._history_entry(
                actor_role="recruiter",
                action="edited_and_resent",
                when=now,
                note=recruiter_reply or decision_summary,
                snapshot={
                    "decision_summary": decision_summary,
                    "job_title": request.job_title,
                    "monthly_salary": request.monthly_salary,
                    "start_date": request.start_date,
                    "version": next_version,
                },
            )
        )
        prior_history.append(
            self._history_entry(
                actor_role="system",
                action="reissued_offer",
                when=now,
                note=recruiter_reply or decision_summary,
                snapshot={"version": next_version},
            )
        )
        v_next["negotiation_history"] = prior_history
        v_next["negotiation_used"] = True
        v_next["negotiation_rounds_used"] = int(offer.get("negotiation_rounds_used") or 0)
        v_next["negotiation_max_rounds"] = int(offer.get("negotiation_max_rounds") or MAX_NEGOTIATION_ROUNDS)
        v_next["recruiter_name"] = offer.get("recruiter_name") or current_user.full_name
        v_next["recruiter_id"] = offer.get("recruiter_id") or current_user.id
        result = await database.offer_letters.insert_one(v_next)
        v_next["_id"] = result.inserted_id

        candidate_id = offer.get("candidate_id")
        if candidate_id:
            await database.candidates.update_one(
                {"user_id": candidate_id},
                {"$set": {"conversion_status": "offer_sent", "updated_at": now}},
            )
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_edited_resent",
                title="Updated offer letter ready",
                message=(
                    (request.recruiter_note or "").strip()
                    or (
                        f"Your recruiter updated the offer letter (v{next_version}) after your clarification. "
                        "Please review and sign when ready."
                    )
                ),
                link="/offer",
                related_id=str(v_next["_id"]),
            )

        if offer.get("candidate_email"):
            _send_email_bg(
                email_service.send_offer_letter,
                to_email=offer["candidate_email"],
                full_name=offer.get("candidate_name") or "Candidate",
                job_title=request.job_title,
                department=request.department,
                start_date=request.start_date,
                organization_id=offer.get("organization_id"),
            )
            _send_email_bg(
                email_service.send_offer_clarification_result,
                to_email=offer["candidate_email"],
                full_name=offer.get("candidate_name") or "Candidate",
                job_title=request.job_title,
                outcome="updated",
                recruiter_note=request.recruiter_note or decision_summary,
                organization_id=offer.get("organization_id"),
            )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": candidate_id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_edited_and_resent",
                "offer_id": str(v_next["_id"]),
                "outcome": "success",
                "metadata": {
                    "parent_offer_id": str(offer["_id"]),
                    "version": next_version,
                    "note": request.recruiter_note,
                },
                "created_at": now,
            }
        )

        return {
            "message": f"Offer letter updated and resent as v{next_version}.",
            "offer": self._public(v_next),
        }

    async def approve(self, current_user: CurrentUser, offer_id: str, request: OfferApproveRequest) -> dict:
        """Recruiter activates the employee via EmployeeService (requires IT + signed offer + docs).

        When force=True, recruiters can approve a signed offer even after the offer window expires.
        """
        from app.services.employee_service import EmployeeService

        offer = await self._find(offer_id)
        await self._assert_recruiter_can_access(current_user, offer, detail="Not authorized to approve this offer.")
        signed_at = offer.get("signed_at")
        is_signed_offer = bool(signed_at) or offer.get("status") == "signed"
        if not is_signed_offer:
            raise HTTPException(
                status_code=409,
                detail="The candidate must sign this offer before it can be activated.",
            )

        expires_at = offer.get("expires_at")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        # Validity window only blocks unsigned offers. A signed acceptance stays valid;
        # recruiters should not see "Offer expired" or need force just because the
        # original response deadline has passed.
        past_validity = bool(expires_at and expires_at < datetime.now(UTC))
        needs_force = past_validity and not is_signed_offer
        if needs_force and not request.force:
            raise HTTPException(
                status_code=410,
                detail="This offer has expired. Use force approval to activate it anyway.",
            )

        result = await EmployeeService().create_from_candidate(
            current_user, offer["candidate_id"], allow_unsigned=request.force
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": offer["candidate_id"],
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_approved_force" if (needs_force or offer["status"] != "signed") and request.force else "offer_approved",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {
            "message": (
                "Expired offer force-approved and employee activated with IT-provisioned email and assets — they'll be asked to complete their profile."
                if needs_force and request.force
                else "Employee activated with IT-provisioned email and assets — they'll be asked to complete their profile."
            ),
            "employee": result["employee"],
        }

    async def extend_validity(
        self, current_user: CurrentUser, offer_id: str, request: OfferExtendValidityRequest
    ) -> dict:
        """Recruiter extends an expired unsigned offer — updates letter dates, emails, and notifies."""
        offer = await self._find(offer_id)
        await self._assert_recruiter(current_user, offer)
        if offer.get("signed_at"):
            raise HTTPException(status_code=409, detail="Signed offers cannot have their validity extended here.")
        if offer.get("status") not in ("sent", "viewed", "expired"):
            raise HTTPException(
                status_code=409,
                detail="This offer’s validity cannot be extended in its current state.",
            )

        expires_at = offer.get("expires_at")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        is_expired = bool(expires_at and expires_at < now)
        if not is_expired:
            raise HTTPException(status_code=409, detail="This offer has not expired yet.")

        note = (request.note or "").strip() or None
        next_status = "viewed" if offer.get("viewed_at") else "sent"
        next_expires_at = now + timedelta(days=request.extra_days)
        expiry_display = next_expires_at.strftime("%b %d, %Y")

        set_fields: dict = {
            "status": next_status,
            "expires_at": next_expires_at,
            "updated_at": now,
            "reopened_at": now,
            "extended_at": now,
            "extended_by": current_user.id,
            "extended_by_name": current_user.full_name,
            "extension_extra_days": request.extra_days,
            "extension_note": note,
            "previous_expires_at": expires_at,
        }
        # Surface the extension on the letter copy candidates see / print.
        if note:
            set_fields["message_to_candidate"] = note

        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {"$set": set_fields},
        )

        candidate_id = offer.get("candidate_id")
        days_label = f"{request.extra_days} day" if request.extra_days == 1 else f"{request.extra_days} days"
        notif_message = (
            f"{current_user.full_name} extended your offer by {days_label}. "
            f"New deadline: {expiry_display}. Open your offer letter to review and sign."
        )
        if note:
            notif_message = f"{notif_message} Note: {note}"

        if candidate_id:
            await database.candidates.update_one(
                {"user_id": candidate_id},
                {"$set": {"conversion_status": "offer_sent", "updated_at": now}},
            )
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_validity_extended",
                title="Offer letter extended",
                message=notif_message[:500],
                link="/offer",
                related_id=str(offer["_id"]),
            )

        _send_email_bg(
            email_service.send_offer_validity_extended,
            to_email=offer["candidate_email"],
            full_name=offer.get("candidate_name") or "Candidate",
            job_title=offer.get("job_title") or "",
            recruiter_name=current_user.full_name or "Your recruiter",
            extra_days=request.extra_days,
            new_expires_at=expiry_display,
            note=note,
            offer_link=f"{settings.frontend_base_url.rstrip('/')}/offer",
            organization_id=offer.get("organization_id"),
        )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": candidate_id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_validity_extended",
                "offer_id": str(offer["_id"]),
                "outcome": "success",
                "metadata": {
                    "extra_days": request.extra_days,
                    "note": note,
                    "previous_status": offer.get("status"),
                    "new_status": next_status,
                    "previous_expires_at": _iso(expires_at),
                    "new_expires_at": next_expires_at.isoformat(),
                },
                "created_at": now,
            }
        )

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": (
                f"Offer extended by {days_label}. Letter updated, email sent, "
                "and candidate notified on their dashboard."
            ),
            "offer": self._public(refreshed),
        }

    def _build_offer_doc(
        self,
        *,
        terms: OfferTermsPayload,
        recruiter: CurrentUser,
        candidate_name: str,
        candidate_email: str,
        candidate_id: str | None,
        invitation_token: str | None,
        version: int,
        parent_offer_id: str | None = None,
        expiry_days: int | None = None,
    ) -> dict:
        now = datetime.now(UTC)
        days = expiry_days or terms.offer_expiry_days or settings.OFFER_EXPIRE_DAYS
        benefits = [b.model_dump() if hasattr(b, "model_dump") else b for b in (terms.benefits or [])]
        allowances = [
            a.model_dump() if hasattr(a, "model_dump") else a
            for a in (terms.allowances or terms.salary_breakdown or [])
        ]
        return {
            "candidate_id": candidate_id,
            "candidate_name": candidate_name,
            "candidate_email": candidate_email.lower().strip(),
            "invitation_token": invitation_token,
            "organization_id": getattr(recruiter, "organization_id", None),
            "recruiter_id": recruiter.id,
            "recruiter_name": recruiter.full_name,
            "recruiter_email": recruiter.email,
            "job_title": terms.job_title,
            "department": terms.department,
            "employment_type": terms.employment_type,
            "office_location": terms.office_location,
            "is_remote": bool(getattr(terms, "is_remote", False)),
            "reporting_manager": terms.reporting_manager,
            "start_date": terms.start_date,
            "monthly_salary": terms.monthly_salary,
            "currency": terms.currency,
            "allowances": allowances,
            "salary_breakdown": allowances,  # legacy alias
            "benefits": benefits,
            "terms": terms.terms,
            "message_to_candidate": terms.message_to_candidate,
            "status": "sent",
            "version": version,
            "parent_offer_id": parent_offer_id,
            "negotiation_used": False,
            "negotiation_rounds_used": 0,
            "negotiation_max_rounds": MAX_NEGOTIATION_ROUNDS,
            "negotiation": self._empty_negotiation_state(),
            "negotiation_history": [],
            "sent_at": now,
            "expires_at": now + timedelta(days=days),
            "viewed_at": None,
            "signature": None,
            "signed_at": None,
            "declined_reason": None,
            "declined_at": None,
            "approved_at": None,
            "approved_by": None,
            "created_at": now,
            "updated_at": now,
        }

    async def _find_candidate(self, candidate_id: str) -> dict | None:
        query_or = [{"user_id": candidate_id}, {"email": candidate_id}]
        if ObjectId.is_valid(candidate_id):
            query_or.append({"_id": ObjectId(candidate_id)})
        return await database.candidates.find_one({"$or": query_or})

    async def _find(self, offer_id: str) -> dict:
        query_or = []
        if ObjectId.is_valid(offer_id):
            query_or.append({"_id": ObjectId(offer_id)})
        offer = await database.offer_letters.find_one({"$or": query_or}) if query_or else None
        if not offer:
            raise HTTPException(status_code=404, detail="Offer letter not found.")
        return offer

    @staticmethod
    async def _assert_recruiter_can_access(current_user: CurrentUser, record: dict, detail: str = "Not authorized.") -> None:
        if current_user.role == "super_admin":
            return
        if not await recruiter_can_access_record(current_user, record):
            raise HTTPException(status_code=403, detail=detail)

    def _assert_owner(self, current_user: CurrentUser, offer: dict) -> None:
        if current_user.role == "super_admin":
            return
        if offer.get("candidate_id") != current_user.id and offer.get("candidate_email") != current_user.email:
            raise HTTPException(status_code=403, detail="Not authorized for this offer letter.")

    async def _assert_recruiter(self, current_user: CurrentUser, offer: dict) -> None:
        await self._assert_recruiter_can_access(current_user, offer, detail="Not authorized for this offer letter.")

    @staticmethod
    def _empty_negotiation_state() -> dict:
        return {
            "status": "none",
            "proposed_salary": None,
            "proposed_start_date": None,
            "proposed_allowances": [],
            "proposed_salary_breakdown": [],  # legacy alias
            "proposed_benefits": [],
            "requested_changes": [],
            "note": None,
            "requested_at": None,
            "responded_at": None,
            "recruiter_note": None,
            "decision_summary": None,
        }

    @staticmethod
    def _history_entry(*, actor_role: str, action: str, when: datetime, note: str | None = None, snapshot: dict | None = None) -> dict:
        return {
            "actor_role": actor_role,
            "action": action,
            "note": note,
            "snapshot": snapshot or {},
            "created_at": when,
        }

    @staticmethod
    def _normalize_benefits(items: list[dict] | None) -> list[str]:
        return sorted([str(item.get("label") or "").strip().lower() for item in (items or []) if item.get("selected", True)])

    def _derive_requested_changes(
        self,
        *,
        current_salary,
        proposed_salary,
        current_start_date,
        proposed_start_date,
        current_allowances: list[dict],
        proposed_allowances: list[dict],
        current_benefits: list[dict],
        proposed_benefits: list[dict],
    ) -> list[str]:
        changes: list[str] = []
        if proposed_salary is not None and float(proposed_salary) != float(current_salary or 0):
            changes.append("salary")
        if str(proposed_start_date or "") != str(current_start_date or ""):
            changes.append("joining_date")
        if proposed_allowances and proposed_allowances != (current_allowances or []):
            changes.append("allowances")
        if self._normalize_benefits(proposed_benefits) != self._normalize_benefits(current_benefits):
            changes.append("benefits")
        return changes

    def _build_decision_summary(
        self,
        *,
        negotiation: dict,
        final_salary: float,
        final_start_date: str,
        final_allowances: list[dict],
        final_benefits: list[dict],
        currency: str,
    ) -> str:
        requested = set(negotiation.get("requested_changes") or [])
        resolved: list[str] = []
        if "salary" in requested:
            resolved.append(f"salary {currency} {final_salary:,.0f}")
        if "joining_date" in requested:
            resolved.append(f"joining date {final_start_date}")
        if "allowances" in requested and final_allowances:
            resolved.append("updated allowances")
        if "benefits" in requested and final_benefits:
            resolved.append("updated benefits")
        if not resolved:
            return "Revised offer issued after negotiation."
        return "Updated offer issued with " + ", ".join(resolved) + "."

    @staticmethod
    def _public(offer: dict) -> dict:
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("requested_at"):
            negotiation = {**negotiation, "requested_at": _iso(negotiation.get("requested_at"))}
        if negotiation.get("responded_at"):
            negotiation = {**negotiation, "responded_at": _iso(negotiation.get("responded_at"))}
        history = []
        for entry in offer.get("negotiation_history") or []:
            history.append(
                {
                    **entry,
                    "created_at": _iso(entry.get("created_at")),
                }
            )

        return {
            "id": str(offer.get("_id", "")),
            "candidate_id": offer.get("candidate_id"),
            "candidate_name": offer.get("candidate_name"),
            "candidate_email": offer.get("candidate_email"),
            "job_title": offer.get("job_title"),
            "department": offer.get("department"),
            "employment_type": offer.get("employment_type"),
            "office_location": offer.get("office_location"),
            "is_remote": bool(offer.get("is_remote")),
            "reporting_manager": offer.get("reporting_manager"),
            "start_date": offer.get("start_date"),
            "monthly_salary": offer.get("monthly_salary"),
            "currency": offer.get("currency"),
            "allowances": offer.get("allowances") or offer.get("salary_breakdown") or [],
            "salary_breakdown": offer.get("salary_breakdown") or offer.get("allowances") or [],
            "benefits": offer.get("benefits") or [],
            "terms": offer.get("terms"),
            "message_to_candidate": offer.get("message_to_candidate"),
            "extension_note": offer.get("extension_note"),
            "extended_at": _iso(offer.get("extended_at")),
            "extended_by_name": offer.get("extended_by_name"),
            "extension_extra_days": offer.get("extension_extra_days"),
            "status": offer.get("status"),
            "version": offer.get("version") or 1,
            "parent_offer_id": offer.get("parent_offer_id"),
            "negotiation_used": bool(offer.get("negotiation_used")),
            "negotiation_rounds_used": int(offer.get("negotiation_rounds_used") or 0),
            "negotiation_max_rounds": int(offer.get("negotiation_max_rounds") or MAX_NEGOTIATION_ROUNDS),
            "negotiation": negotiation,
            "negotiation_history": history,
            "recruiter_id": offer.get("recruiter_id"),
            "recruiter_name": offer.get("recruiter_name"),
            "sent_at": _iso(offer.get("sent_at")),
            "expires_at": _iso(offer.get("expires_at")),
            # Signed offers are accepted — do not flag them expired just because
            # the original response deadline date has passed.
            "is_expired": bool(
                not (offer.get("signed_at") or (offer.get("status") or "").lower() == "signed")
                and offer.get("expires_at")
                and (
                    offer["expires_at"].replace(tzinfo=UTC)
                    if getattr(offer.get("expires_at"), "tzinfo", None) is None
                    else offer.get("expires_at")
                )
                < datetime.now(UTC)
            ),
            "viewed_at": _iso(offer.get("viewed_at")),
            "signed_at": _iso(offer.get("signed_at")),
            "signature": offer.get("signature"),
            "declined_reason": offer.get("declined_reason"),
            "approved_at": _iso(offer.get("approved_at")),
        }


offer_service = OfferService()