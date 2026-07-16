"""Offer Letter cycle — the bridge between candidate intake (Epic 3) and
employee activation (Epic 3/5). Owns: send offer, candidate view/sign/decline,
recruiter approve (which triggers EmployeeService.create_from_candidate)."""

from datetime import UTC, datetime, timedelta

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.offer import OfferApproveRequest, OfferCreateRequest, OfferDeclineRequest, OfferSignRequest
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


class OfferService:
    async def create_and_send(self, current_user: CurrentUser, request: OfferCreateRequest) -> dict:
        candidate = await self._find_candidate(request.candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        if current_user.role != "super_admin" and candidate.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="You can only send offers to your own candidates.")
        if candidate.get("status") == "converted":
            raise HTTPException(status_code=409, detail="This candidate is already an employee.")

        onboarding = candidate.get("onboarding") or {}
        if onboarding.get("status") != "submitted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Candidate must submit their profile, resume, and documents before you can send an offer.",
            )

        existing = await database.offer_letters.find_one(
            {"candidate_id": request.candidate_id, "status": {"$in": ["sent", "viewed", "signed"]}}
        )
        if existing:
            raise HTTPException(status_code=409, detail="This candidate already has an active offer letter.")

        now = datetime.now(UTC)
        expiry_days = request.offer_expiry_days or settings.OFFER_EXPIRE_DAYS
        offer_doc = {
            "candidate_id": request.candidate_id,
            "candidate_name": candidate["full_name"],
            "candidate_email": candidate["email"],
            "recruiter_id": current_user.id,
            "recruiter_name": current_user.full_name,
            "job_title": request.job_title,
            "department": request.department,
            "employment_type": request.employment_type,
            "office_location": request.office_location,
            "reporting_manager": request.reporting_manager,
            "start_date": request.start_date,
            "monthly_salary": request.monthly_salary,
            "currency": request.currency,
            "terms": request.terms,
            "message_to_candidate": request.message_to_candidate,
            "status": "sent",
            "sent_at": now,
            "expires_at": now + timedelta(days=expiry_days),
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
        result = await database.offer_letters.insert_one(offer_doc)
        offer_doc["_id"] = result.inserted_id

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
            recipient_id=request.candidate_id,
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
                "candidate_id": request.candidate_id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_sent",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {"message": "Offer letter sent.", "offer": self._public(offer_doc)}

    async def get_mine(self, current_user: CurrentUser) -> dict:
        offer = await database.offer_letters.find_one(
            {"candidate_id": current_user.id}, sort=[("created_at", -1)]
        )
        if not offer:
            offer = await database.offer_letters.find_one(
                {"candidate_email": current_user.email}, sort=[("created_at", -1)]
            )
        if not offer:
            return {"offer": None}
        if offer["status"] == "sent":
            await database.offer_letters.update_one(
                {"_id": offer["_id"]}, {"$set": {"status": "viewed", "viewed_at": datetime.now(UTC)}}
            )
            offer["status"] = "viewed"
        return {"offer": self._public(offer)}

    async def list_for_candidate(self, current_user: CurrentUser, candidate_id: str) -> dict:
        if current_user.role not in ("recruiter", "super_admin"):
            raise HTTPException(status_code=403, detail="Not authorized.")
        offers = (
            await database.offer_letters.find({"candidate_id": candidate_id}).sort("created_at", -1).to_list(length=20)
        )
        return {"offers": [self._public(o) for o in offers]}

    async def sign(self, current_user: CurrentUser, offer_id: str, request: OfferSignRequest) -> dict:
        offer = await self._find(offer_id)
        self._assert_owner(current_user, offer)
        if offer["status"] not in ("sent", "viewed"):
            raise HTTPException(status_code=409, detail=f"This offer cannot be signed (status: {offer['status']}).")

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
        signature = {
            "full_legal_name": request.full_legal_name,
            "signature_data_url": request.signature_data_url,
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
                message=f"{offer['candidate_name']} digitally signed their offer letter. Approve to activate them.",
                link="/dashboard/recruiter#pending-review-section",
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
            "message": "Offer signed. Your recruiter will review and activate your employee account.",
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
        await database.candidates.update_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]},
            {"$set": {"conversion_status": "offer_declined", "updated_at": now}},
        )
        if offer.get("recruiter_id"):
            await create_notification(
                recipient_id=offer["recruiter_id"],
                recipient_role="recruiter",
                notif_type="offer_declined",
                title="Offer letter declined",
                message=f"{offer['candidate_name']} declined their offer letter.",
                link="/dashboard/recruiter#pending-review-section",
                related_id=str(offer["_id"]),
            )
        return {"message": "Offer declined."}

    async def approve(self, current_user: CurrentUser, offer_id: str, request: OfferApproveRequest) -> dict:
        """Recruiter/HR approval — activates the employee via EmployeeService."""
        from app.services.employee_service import EmployeeService  # local import avoids a circular import

        offer = await self._find(offer_id)
        if current_user.role != "super_admin" and offer.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to approve this offer.")
        if offer["status"] != "signed":
            raise HTTPException(status_code=409, detail=f"Offer must be signed before approval (status: {offer['status']}).")

        result = await EmployeeService().create_from_candidate(current_user, offer["candidate_id"])
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": offer["candidate_id"],
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "offers",
                "action": "offer_approved",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {
            "message": "Offer approved. Employee activated — they'll be asked to complete their profile.",
            "employee": result["employee"],
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

    @staticmethod
    def _public(offer: dict) -> dict:
        def _iso(value):
            return value.isoformat() if hasattr(value, "isoformat") else value

        return {
            "id": str(offer.get("_id", "")),
            "candidate_id": offer.get("candidate_id"),
            "candidate_name": offer.get("candidate_name"),
            "job_title": offer.get("job_title"),
            "department": offer.get("department"),
            "employment_type": offer.get("employment_type"),
            "office_location": offer.get("office_location"),
            "reporting_manager": offer.get("reporting_manager"),
            "start_date": offer.get("start_date"),
            "monthly_salary": offer.get("monthly_salary"),
            "currency": offer.get("currency"),
            "terms": offer.get("terms"),
            "message_to_candidate": offer.get("message_to_candidate"),
            "status": offer.get("status"),
            "recruiter_name": offer.get("recruiter_name"),
            "sent_at": _iso(offer.get("sent_at")),
            "expires_at": _iso(offer.get("expires_at")),
            "viewed_at": _iso(offer.get("viewed_at")),
            "signed_at": _iso(offer.get("signed_at")),
            "signature": offer.get("signature"),
            "declined_reason": offer.get("declined_reason"),
            "approved_at": _iso(offer.get("approved_at")),
        }


offer_service = OfferService()