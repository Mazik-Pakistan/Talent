from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.invitation import CreateInvitationRequest
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.offer_service import offer_service
from app.services.people_history import (
    find_active_candidate,
    find_active_employee,
    find_active_user,
    lookup_history_by_email,
    prepare_email_for_reinvite,
)


class InvitationService:
    async def create_invitation(self, request: CreateInvitationRequest, actor: CurrentUser) -> dict:
        if request.offer is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An offer letter is required when inviting a candidate. Include salary, start date, benefits, and reporting manager.",
            )

        email = request.email.lower().strip()
        existing_candidate = await find_active_candidate(email)
        if existing_candidate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A candidate account already exists for this email address.",
            )

        existing_employee = await find_active_employee(email)
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active employee already exists for this email address.",
            )

        active_user = await find_active_user(email)
        if active_user and active_user.get("role") in ("recruiter", "super_admin"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email belongs to a staff account and cannot be invited as a candidate.",
            )

        history = await lookup_history_by_email(
            email,
            recruiter_id=None if actor.role == "super_admin" else actor.id,
            is_super_admin=actor.role == "super_admin",
        )
        # Same-email reinvite: archive old login so a fresh candidate cycle can register.
        await prepare_email_for_reinvite(email)

        now = datetime.now(UTC)

        await database.invitations.update_many(
            {
                "email": email,
                "status": {"$in": ["pending", "accepted"]},
            },
            {"$set": {"status": "expired", "updated_at": now}},
        )

        token = token_urlsafe(32)
        expires_at = now + timedelta(days=request.expires_in_days)
        start_date = (
            request.offer.start_date
            if request.offer.start_date
            else (request.start_date.isoformat() if request.start_date else None)
        )
        invitation = {
            "token": token,
            "email": email,
            "full_name": request.full_name,
            "job_title": request.job_title,
            "department": request.department,
            "office_location": request.offer.office_location or request.office_location,
            "is_remote": bool(request.is_remote or (request.offer and request.offer.is_remote)),
            "start_date": start_date,
            "organization_id": getattr(actor, "organization_id", None),
            "recruiter_id": actor.id,
            "recruiter_email": actor.email,
            "created_by_role": actor.role,
            "status": "pending",
            "expires_at": expires_at,
            "used_at": None,
            "created_at": now,
            "updated_at": now,
            "has_offer": True,
        }
        await database.invitations.insert_one(invitation)

        offer_doc = await offer_service.create_with_invitation(
            terms=request.offer,
            recruiter=actor,
            candidate_name=request.full_name,
            candidate_email=email,
            invitation_token=token,
        )

        invite_link = settings.invitation_link(token)
        expires_display = expires_at.strftime("%B %d, %Y at %H:%M UTC")
        email_sent = False
        email_error = None
        try:
            email_service.send_offer_invitation_email(
                to_email=email,
                full_name=request.full_name,
                job_title=request.job_title,
                department=request.department,
                start_date=str(request.offer.start_date),
                currency=request.offer.currency,
                monthly_salary=request.offer.monthly_salary,
                invite_link=invite_link,
                expires_at=expires_display,
                organization_id=invitation.get("organization_id"),
            )
            email_sent = True
        except Exception as exc:
            email_error = str(exc)

        await database.audit_logs.insert_one(
            {
                "user_id": actor.id,
                "recruiter_id": actor.id,
                "email": email,
                "role": actor.role,
                "module": "recruitment",
                "action": "invitation_with_offer_created",
                "outcome": "success" if email_sent else "partial",
                "offer_id": str(offer_doc.get("_id")),
                "created_at": now,
            }
        )

        await create_notification(
            recipient_id=actor.id,
            recipient_role=actor.role if actor.role in ("recruiter", "super_admin") else "recruiter",
            notif_type="invitation_sent",
            title="Offer invitation sent" if email_sent else "Offer invitation created",
            message=(
                f"Offer invitation for {request.full_name} ({email}) was emailed."
                if email_sent
                else f"Offer invitation for {request.full_name} created. Email could not be sent — please retry."
            ),
            link="/dashboard/recruiter/invite",
            related_id=token,
        )

        message = (
            "Invitation and offer letter created and emailed to the candidate."
            if email_sent
            else "Invitation and offer letter created, but the email could not be sent. Please retry sending."
        )

        return {
            "message": message,
            "email_sent": email_sent,
            "email_error": email_error,
            "person_history": history,
            "reinvite_from_history": bool(history.get("matches")),
            "invitation": {
                "token": token,
                "email": email,
                "full_name": request.full_name,
                "job_title": request.job_title,
                "department": request.department,
                "office_location": invitation["office_location"],
                "is_remote": bool(invitation.get("is_remote")),
                "start_date": invitation["start_date"],
                "status": "pending",
                "expires_at": invitation["expires_at"].isoformat(),
                "invite_link": invite_link,
                "has_offer": True,
            },
            "offer": offer_service._public(offer_doc),
        }

    async def get_invitation(self, token: str) -> dict:
        invitation = await self._get_valid_invitation(token)
        offer = await database.offer_letters.find_one(
            {"invitation_token": token, "status": {"$in": ["sent", "viewed"]}},
            sort=[("version", -1), ("created_at", -1)],
        )
        return {
            "invitation": {
                "token": invitation["token"],
                "email": invitation["email"],
                "full_name": invitation["full_name"],
                "job_title": invitation["job_title"],
                "department": invitation["department"],
                "office_location": invitation.get("office_location"),
                "is_remote": bool(invitation.get("is_remote") or (offer or {}).get("is_remote")),
                "start_date": invitation.get("start_date"),
                "expires_at": invitation["expires_at"].isoformat()
                if isinstance(invitation["expires_at"], datetime)
                else invitation["expires_at"],
                "status": invitation["status"],
                "has_offer": bool(offer or invitation.get("has_offer")),
                "kind": invitation.get("kind", "candidate"),
                "capabilities": invitation.get("capabilities"),
            },
            "offer": offer_service._public(offer) if offer else None,
        }

    async def _get_valid_invitation(self, token: str) -> dict:
        invitation = await database.invitations.find_one({"token": token})
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

        expires_at = invitation["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)

        if invitation["status"] == "used":
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invitation has already been used.",
            )

        if invitation["status"] != "pending" or expires_at <= datetime.now(UTC):
            if invitation["status"] == "pending":
                await database.invitations.update_one(
                    {"_id": invitation["_id"]},
                    {"$set": {"status": "expired", "updated_at": datetime.now(UTC)}},
                )
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invitation is invalid or has expired.",
            )

        return invitation
