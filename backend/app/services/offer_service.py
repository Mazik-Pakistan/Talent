"""Offer Letter cycle — invite+offer, sign/negotiate, then docs → IT → activate."""

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
    OfferExtendValidityRequest,
    OfferNegotiateRequest,
    OfferSignRequest,
    OfferTermsPayload,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


ACTIVE_OFFER_STATUSES = ("sent", "viewed", "signed")
MAX_NEGOTIATION_ROUNDS = 3


class OfferService:
    async def create_and_send(self, current_user: CurrentUser, request: OfferCreateRequest) -> dict:
        """Legacy/resend path: send offer to an existing candidate (no intake gate)."""
        candidate = await self._find_candidate(request.candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        if current_user.role != "super_admin" and candidate.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="You can only send offers to your own candidates.")
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
                "status": {"$in": ["sent", "viewed", "draft"]},
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
        return {"offer": self._public(offer)}

    async def has_signed_offer(self, user_id: str, email: str | None = None) -> bool:
        query: dict = {"status": "signed", "$or": [{"candidate_id": user_id}]}
        if email:
            query["$or"].append({"candidate_email": email})
        doc = await database.offer_letters.find_one(query)
        return bool(doc)

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
        query: dict = {"negotiation.status": "pending", "status": {"$in": ["sent", "viewed"]}}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        docs = await database.offer_letters.find(query).sort("negotiation.requested_at", -1).to_list(length=50)
        return {"offers": [self._public(o) for o in docs], "count": len(docs)}

    async def list_awaiting_offer_response(self, current_user: CurrentUser) -> dict:
        """Registered candidates with an unsigned active offer."""
        query: dict = {"status": {"$in": ["sent", "viewed", "expired"]}, "candidate_id": {"$ne": None}}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
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
            raise HTTPException(status_code=409, detail=f"This offer cannot be signed (status: {offer['status']}).")

        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") == "pending":
            raise HTTPException(
                status_code=409,
                detail="Your negotiation request is pending. Wait for your recruiter to respond before signing.",
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
                    detail="This offer letter has expired. Ask your recruiter to resend it.",
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

        await database.candidates.update_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]},
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

        await database.candidates.update_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]},
            {
                "$set": {
                    **mark_candidate_historical_fields(
                        reason="offer_declined",
                        lifecycle_state="declined",
                        when=now,
                    ),
                    "conversion_status": "offer_declined",
                    "cycle_group_key": cycle_group_key(current_user.email),
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
            raise HTTPException(status_code=409, detail="This offer cannot be negotiated.")
        rounds_used = int(offer.get("negotiation_rounds_used") or 0)
        if rounds_used >= int(offer.get("negotiation_max_rounds") or MAX_NEGOTIATION_ROUNDS):
            raise HTTPException(
                status_code=409,
                detail="Maximum negotiation rounds reached. You can accept or decline this offer.",
            )
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") == "pending":
            raise HTTPException(status_code=409, detail="A negotiation request is already pending.")

        now = datetime.now(UTC)
        proposed_allowances = [
            row.model_dump() if hasattr(row, "model_dump") else row for row in (request.proposed_allowances or [])
        ]
        proposed_benefits = [b.model_dump() for b in request.proposed_benefits]
        requested_changes = request.requested_changes or self._derive_requested_changes(
            current_salary=offer.get("monthly_salary"),
            proposed_salary=request.proposed_salary,
            current_start_date=offer.get("start_date"),
            proposed_start_date=request.proposed_start_date,
            current_allowances=offer.get("allowances") or [],
            proposed_allowances=proposed_allowances,
            current_benefits=offer.get("benefits") or [],
            proposed_benefits=proposed_benefits,
        )
        negotiation_doc = {
            "status": "pending",
            "proposed_salary": request.proposed_salary,
            "proposed_start_date": request.proposed_start_date,
            "proposed_allowances": proposed_allowances,
            "proposed_benefits": proposed_benefits,
            "requested_changes": requested_changes,
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
                "proposed_salary": request.proposed_salary,
                "proposed_start_date": request.proposed_start_date,
                "proposed_allowances": proposed_allowances,
                "proposed_benefits": proposed_benefits,
                "requested_changes": requested_changes,
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
            await create_notification(
                recipient_id=offer["recruiter_id"],
                recipient_role="recruiter",
                notif_type="offer_negotiation",
                title="Offer negotiation requested",
                message=(
                    f"{offer['candidate_name']} proposed {offer.get('currency', 'PKR')} "
                    f"{request.proposed_salary:,.0f} and start date {request.proposed_start_date}."
                ),
                link="/dashboard/recruiter/candidates",
                related_id=str(offer["_id"]),
            )
            recruiter = await database.recruiters.find_one({"user_id": offer["recruiter_id"]}) or {}
            to_email = recruiter.get("email") or offer.get("recruiter_email")
            if to_email:
                try:
                    email_service.send_offer_negotiation_request(
                        to_email=to_email,
                        recruiter_name=offer.get("recruiter_name") or "Recruiter",
                        candidate_name=offer.get("candidate_name") or "Candidate",
                        job_title=offer.get("job_title") or "",
                        current_salary=offer.get("monthly_salary"),
                        proposed_salary=request.proposed_salary,
                        currency=offer.get("currency") or "PKR",
                        current_start_date=str(offer.get("start_date") or ""),
                        proposed_start_date=request.proposed_start_date,
                        note=request.note,
                    )
                except Exception:
                    pass

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Negotiation sent to your recruiter. You will be notified when they respond.",
            "offer": self._public(refreshed),
        }

    async def accept_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending negotiation on this offer.")

        now = datetime.now(UTC)
        next_version = int(offer.get("version") or 1) + 1
        final_salary = (
            request.revised_salary
            if request.revised_salary is not None
            else float(negotiation.get("proposed_salary") or offer.get("monthly_salary") or 0)
        )
        final_start_date = request.revised_start_date or negotiation.get("proposed_start_date") or offer.get("start_date")
        final_allowances_raw = (
            [row.model_dump() if hasattr(row, "model_dump") else row for row in (request.revised_allowances or [])]
            or negotiation.get("proposed_allowances")
            or offer.get("allowances")
            or []
        )
        final_benefits_raw = (
            [b.model_dump() if hasattr(b, "model_dump") else b for b in (request.revised_benefits or [])]
            or negotiation.get("proposed_benefits")
            or offer.get("benefits")
            or []
        )
        decision_summary = request.decision_summary or self._build_decision_summary(
            negotiation=negotiation,
            final_salary=final_salary,
            final_start_date=final_start_date,
            final_allowances=final_allowances_raw,
            final_benefits=final_benefits_raw,
            currency=offer.get("currency") or "PKR",
        )
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "status": "withdrawn",
                    "negotiation.status": "accepted",
                    "negotiation.responded_at": now,
                    "negotiation.recruiter_note": request.recruiter_note,
                    "negotiation.decision_summary": decision_summary,
                    "updated_at": now,
                    "withdrawn_at": now,
                    "superseded_by_version": next_version,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="accepted",
                        when=now,
                        note=request.recruiter_note or request.decision_summary,
                        snapshot={
                            "revised_salary": final_salary,
                            "revised_start_date": final_start_date,
                            "revised_allowances": final_allowances_raw,
                            "revised_benefits": final_benefits_raw,
                            "decision_summary": decision_summary,
                        },
                    )
                },
            },
        )

        terms = OfferTermsPayload(
            job_title=offer["job_title"],
            department=offer["department"],
            employment_type=offer.get("employment_type") or "Full-time",
            office_location=offer.get("office_location"),
            reporting_manager=offer["reporting_manager"],
            start_date=str(final_start_date),
            monthly_salary=float(final_salary),
            currency=offer.get("currency") or "PKR",
            allowances=[AllowanceItem.model_validate(x) if isinstance(x, dict) else x for x in final_allowances_raw],
            benefits=[BenefitItem.model_validate(x) if isinstance(x, dict) else x for x in final_benefits_raw],
            offer_expiry_days=None,
            terms=offer.get("terms") or "",
            message_to_candidate=offer.get("message_to_candidate"),
        )
        # Rebuild expiry from original window if possible
        expiry_days = settings.OFFER_EXPIRE_DAYS
        if offer.get("expires_at") and offer.get("sent_at"):
            try:
                delta = offer["expires_at"] - offer["sent_at"]
                expiry_days = max(1, min(90, delta.days or settings.OFFER_EXPIRE_DAYS))
            except Exception:
                pass

        v2 = self._build_offer_doc(
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
        v2["negotiation"] = self._empty_negotiation_state()
        v2["negotiation_used"] = True  # no second round on v2
        v2["negotiation_rounds_used"] = int(offer.get("negotiation_rounds_used") or 0)
        v2["negotiation_max_rounds"] = int(offer.get("negotiation_max_rounds") or MAX_NEGOTIATION_ROUNDS)
        v2["negotiation_history"] = [
            *list(offer.get("negotiation_history") or []),
            self._history_entry(
                actor_role="system",
                action="reissued_offer",
                when=now,
                note=decision_summary,
                snapshot={"version": next_version},
            ),
        ]
        v2["recruiter_name"] = offer.get("recruiter_name") or current_user.full_name
        v2["recruiter_id"] = offer.get("recruiter_id") or current_user.id
        result = await database.offer_letters.insert_one(v2)
        v2["_id"] = result.inserted_id

        candidate_id = offer.get("candidate_id")
        if candidate_id:
            await database.candidates.update_one(
                {"user_id": candidate_id},
                {"$set": {"conversion_status": "offer_sent", "updated_at": now}},
            )
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_negotiation_accepted",
                title="Negotiation accepted — new offer ready",
                message=f"Your recruiter sent an updated offer letter (v{next_version}). Review the revised compensation and sign when ready.",
                link="/offer",
                related_id=str(v2["_id"]),
            )
            try:
                email_service.send_offer_negotiation_result(
                    to_email=offer["candidate_email"],
                    full_name=offer.get("candidate_name") or "Candidate",
                    accepted=True,
                    job_title=offer.get("job_title") or "",
                    recruiter_note=request.recruiter_note,
                )
            except Exception:
                pass

        return {
            "message": "Negotiation accepted. A revised offer (v2) was sent to the candidate.",
            "offer": self._public(v2),
        }

    async def counter_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending negotiation on this offer.")

        now = datetime.now(UTC)
        next_version = int(offer.get("version") or 1) + 1
        final_salary = (
            request.revised_salary
            if request.revised_salary is not None
            else float(offer.get("monthly_salary") or negotiation.get("proposed_salary") or 0)
        )
        final_start_date = request.revised_start_date or offer.get("start_date") or negotiation.get("proposed_start_date")
        final_allowances_raw = (
            [row.model_dump() if hasattr(row, "model_dump") else row for row in (request.revised_allowances or [])]
            or negotiation.get("proposed_allowances")
            or offer.get("allowances")
            or []
        )
        final_benefits_raw = (
            [b.model_dump() if hasattr(b, "model_dump") else b for b in (request.revised_benefits or [])]
            or negotiation.get("proposed_benefits")
            or offer.get("benefits")
            or []
        )
        decision_summary = request.decision_summary or "Recruiter sent a counter-offer with revised terms."

        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "status": "withdrawn",
                    "negotiation.status": "countered",
                    "negotiation.responded_at": now,
                    "negotiation.recruiter_note": request.recruiter_note,
                    "negotiation.decision_summary": decision_summary,
                    "updated_at": now,
                    "withdrawn_at": now,
                    "superseded_by_version": next_version,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="countered",
                        when=now,
                        note=request.recruiter_note or request.decision_summary,
                        snapshot={
                            "revised_salary": final_salary,
                            "revised_start_date": final_start_date,
                            "revised_allowances": final_allowances_raw,
                            "revised_benefits": final_benefits_raw,
                            "decision_summary": decision_summary,
                        },
                    )
                },
            },
        )

        terms = OfferTermsPayload(
            job_title=offer["job_title"],
            department=offer["department"],
            employment_type=offer.get("employment_type") or "Full-time",
            office_location=offer.get("office_location"),
            reporting_manager=offer["reporting_manager"],
            start_date=str(final_start_date),
            monthly_salary=float(final_salary),
            currency=offer.get("currency") or "PKR",
            allowances=[AllowanceItem.model_validate(x) if isinstance(x, dict) else x for x in final_allowances_raw],
            benefits=[BenefitItem.model_validate(x) if isinstance(x, dict) else x for x in final_benefits_raw],
            offer_expiry_days=None,
            terms=offer.get("terms") or "",
            message_to_candidate=offer.get("message_to_candidate"),
        )
        expiry_days = settings.OFFER_EXPIRE_DAYS
        if offer.get("expires_at") and offer.get("sent_at"):
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
        v_next["negotiation"] = self._empty_negotiation_state()
        v_next["negotiation_used"] = bool(offer.get("negotiation_used"))
        v_next["negotiation_rounds_used"] = int(offer.get("negotiation_rounds_used") or 0)
        v_next["negotiation_max_rounds"] = int(offer.get("negotiation_max_rounds") or MAX_NEGOTIATION_ROUNDS)
        v_next["negotiation_history"] = [
            *list(offer.get("negotiation_history") or []),
            self._history_entry(
                actor_role="system",
                action="counter_offer_issued",
                when=now,
                note=decision_summary,
                snapshot={"version": next_version},
            ),
        ]
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
                notif_type="offer_countered",
                title="Counter-offer ready",
                message=f"Your recruiter sent a counter-offer (v{next_version}). Review, sign, or continue negotiation.",
                link="/offer",
                related_id=str(v_next["_id"]),
            )
        return {
            "message": f"Counter-offer sent as v{next_version}.",
            "offer": self._public(v_next),
        }

    async def reject_negotiation(
        self, current_user: CurrentUser, offer_id: str, request: NegotiationRespondRequest
    ) -> dict:
        offer = await self._find(offer_id)
        self._assert_recruiter(current_user, offer)
        negotiation = offer.get("negotiation") or {}
        if negotiation.get("status") != "pending":
            raise HTTPException(status_code=409, detail="There is no pending negotiation on this offer.")

        now = datetime.now(UTC)
        decision_summary = request.decision_summary or "The original offer remains unchanged. Candidate may accept or decline it."
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "negotiation.status": "rejected",
                    "negotiation.responded_at": now,
                    "negotiation.recruiter_note": request.recruiter_note,
                    "negotiation.decision_summary": decision_summary,
                    "negotiation_used": True,
                    "updated_at": now,
                },
                "$push": {
                    "negotiation_history": self._history_entry(
                        actor_role="recruiter",
                        action="rejected",
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
                notif_type="offer_negotiation_rejected",
                title="Negotiation declined",
                message=(
                    "Your recruiter declined the negotiation. You may accept the original offer or decline it. "
                    "No further negotiation is available."
                ),
                link="/offer",
                related_id=str(offer["_id"]),
            )
            try:
                email_service.send_offer_negotiation_result(
                    to_email=offer["candidate_email"],
                    full_name=offer.get("candidate_name") or "Candidate",
                    accepted=False,
                    job_title=offer.get("job_title") or "",
                    recruiter_note=request.recruiter_note,
                )
            except Exception:
                pass

        refreshed = await database.offer_letters.find_one({"_id": offer["_id"]})
        return {
            "message": "Negotiation rejected. The candidate can accept or decline the original offer.",
            "offer": self._public(refreshed),
        }

    async def approve(self, current_user: CurrentUser, offer_id: str, request: OfferApproveRequest) -> dict:
        """Recruiter activates the employee via EmployeeService (requires IT + signed offer + docs).

        When force=True, recruiters can approve a signed offer even after the offer window expires.
        """
        from app.services.employee_service import EmployeeService

        offer = await self._find(offer_id)
        if current_user.role != "super_admin" and offer.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to approve this offer.")
        signed_at = offer.get("signed_at")
        is_signed_offer = bool(signed_at) or offer.get("status") == "signed"
        if not is_signed_offer:
            raise HTTPException(
                status_code=409,
                detail=f"Offer must be signed by the candidate before activation (status: {offer['status']}).",
            )

        expires_at = offer.get("expires_at")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        is_expired = bool(expires_at and expires_at < datetime.now(UTC))
        if is_expired and not request.force:
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
                "action": "offer_approved_force" if (is_expired or offer["status"] != "signed") and request.force else "offer_approved",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {
            "message": (
                "Expired offer force-approved and employee activated with IT-provisioned email and assets — they'll be asked to complete their profile."
                if is_expired and request.force
                else "Employee activated with IT-provisioned email and assets — they'll be asked to complete their profile."
            ),
            "employee": result["employee"],
        }

    async def extend_validity(
        self, current_user: CurrentUser, offer_id: str, request: OfferExtendValidityRequest
    ) -> dict:
        """Recruiter extends an expired unsigned offer for a specific candidate."""
        offer = await self._find(offer_id)
        self._assert_recruiter(current_user, offer)
        if offer.get("signed_at"):
            raise HTTPException(status_code=409, detail="Signed offers cannot have their validity extended here.")
        if offer.get("status") not in ("sent", "viewed", "expired"):
            raise HTTPException(
                status_code=409,
                detail=f"This offer cannot have its validity extended (status: {offer.get('status')}).",
            )

        expires_at = offer.get("expires_at")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        is_expired = bool(expires_at and expires_at < now)
        if not is_expired:
            raise HTTPException(status_code=409, detail="This offer has not expired yet.")

        next_status = "viewed" if offer.get("viewed_at") else "sent"
        next_expires_at = now + timedelta(days=request.extra_days)
        await database.offer_letters.update_one(
            {"_id": offer["_id"]},
            {
                "$set": {
                    "status": next_status,
                    "expires_at": next_expires_at,
                    "updated_at": now,
                    "reopened_at": now,
                }
            },
        )

        candidate_id = offer.get("candidate_id")
        if candidate_id:
            await database.candidates.update_one(
                {"user_id": candidate_id},
                {"$set": {"conversion_status": "offer_sent", "updated_at": now}},
            )
            await create_notification(
                recipient_id=candidate_id,
                recipient_role="candidate",
                notif_type="offer_validity_extended",
                title="Offer validity extended",
                message=(
                    f"{current_user.full_name} extended your offer validity by {request.extra_days} day"
                    f"{'' if request.extra_days == 1 else 's'}. Review and sign it before it expires again."
                ),
                link="/offer",
                related_id=str(offer["_id"]),
            )

        try:
            email_service.send_offer_letter(
                to_email=offer["candidate_email"],
                full_name=offer.get("candidate_name") or "Candidate",
                job_title=offer.get("job_title") or "",
                department=offer.get("department") or "",
                start_date=offer.get("start_date") or "",
            )
        except Exception:
            pass

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
                    "note": request.note,
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
            "message": f"Offer validity extended by {request.extra_days} day{'' if request.extra_days == 1 else 's'}.",
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
        allowances = [a.model_dump() if hasattr(a, "model_dump") else a for a in (terms.allowances or [])]
        return {
            "candidate_id": candidate_id,
            "candidate_name": candidate_name,
            "candidate_email": candidate_email.lower().strip(),
            "invitation_token": invitation_token,
            "recruiter_id": recruiter.id,
            "recruiter_name": recruiter.full_name,
            "recruiter_email": recruiter.email,
            "job_title": terms.job_title,
            "department": terms.department,
            "employment_type": terms.employment_type,
            "office_location": terms.office_location,
            "reporting_manager": terms.reporting_manager,
            "start_date": terms.start_date,
            "monthly_salary": terms.monthly_salary,
            "currency": terms.currency,
            "allowances": allowances,
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

    def _assert_owner(self, current_user: CurrentUser, offer: dict) -> None:
        if current_user.role == "super_admin":
            return
        if offer.get("candidate_id") != current_user.id and offer.get("candidate_email") != current_user.email:
            raise HTTPException(status_code=403, detail="Not authorized for this offer letter.")

    def _assert_recruiter(self, current_user: CurrentUser, offer: dict) -> None:
        if current_user.role == "super_admin":
            return
        if offer.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized for this offer letter.")

    @staticmethod
    def _empty_negotiation_state() -> dict:
        return {
            "status": "none",
            "proposed_salary": None,
            "proposed_start_date": None,
            "proposed_allowances": [],
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
        def _iso(value):
            return value.isoformat() if hasattr(value, "isoformat") else value

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
            "reporting_manager": offer.get("reporting_manager"),
            "start_date": offer.get("start_date"),
            "monthly_salary": offer.get("monthly_salary"),
            "currency": offer.get("currency"),
            "allowances": offer.get("allowances") or [],
            "benefits": offer.get("benefits") or [],
            "terms": offer.get("terms"),
            "message_to_candidate": offer.get("message_to_candidate"),
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
            "is_expired": bool(
                offer.get("expires_at")
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