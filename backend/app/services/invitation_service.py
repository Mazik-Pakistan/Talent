from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.invitation import CreateInvitationRequest
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


class InvitationService:
    async def create_invitation(self, request: CreateInvitationRequest, actor: CurrentUser) -> dict:
        existing_candidate = await database.candidates.find_one(
            {"email": request.email.lower().strip(), "status": "active"}
        )
        if existing_candidate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A candidate account already exists for this email address.",
            )

        now = datetime.now(UTC)
        email = request.email.lower().strip()

        # Expire stale pending invites and repair stuck "accepted" invites from the old flow
        await database.invitations.update_many(
            {
                "email": email,
                "status": {"$in": ["pending", "accepted"]},
            },
            {"$set": {"status": "expired", "updated_at": now}},
        )

        token = token_urlsafe(32)
        expires_at = now + timedelta(days=request.expires_in_days)
        invitation = {
            "token": token,
            "email": email,
            "full_name": request.full_name,
            "job_title": request.job_title,
            "department": request.department,
            "office_location": request.office_location,
            "start_date": request.start_date.isoformat() if request.start_date else None,
            "recruiter_id": actor.id,
            "recruiter_email": actor.email,
            "created_by_role": actor.role,
            "status": "pending",
            "expires_at": expires_at,
            "used_at": None,
            "created_at": now,
            "updated_at": now,
        }
        await database.invitations.insert_one(invitation)

        invite_link = settings.invitation_link(token)
        expires_display = expires_at.strftime("%B %d, %Y at %H:%M UTC")
        email_sent = False
        email_error = None
        try:
            email_service.send_invitation_email(
                to_email=email,
                full_name=request.full_name,
                job_title=request.job_title,
                department=request.department,
                invite_link=invite_link,
                expires_at=expires_display,
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
                "action": "invitation_created",
                "outcome": "success" if email_sent else "partial",
                "created_at": now,
            }
        )

        await create_notification(
            recipient_id=actor.id,
            recipient_role=actor.role if actor.role in ("recruiter", "super_admin") else "recruiter",
            notif_type="invitation_sent",
            title="Invitation sent" if email_sent else "Invitation created",
            message=(
                f"Invitation for {request.full_name} ({email}) was emailed."
                if email_sent
                else f"Invitation for {request.full_name} created. Email could not be sent — copy the link."
            ),
            link="/dashboard/recruiter#invite-section",
            related_id=token,
        )

        message = (
            "Invitation created and emailed to the candidate."
            if email_sent
            else "Invitation created, but the email could not be sent. Copy the link below to share it manually."
        )

        return {
            "message": message,
            "email_sent": email_sent,
            "email_error": email_error,
            "invitation": {
                "token": token,
                "email": email,
                "full_name": request.full_name,
                "job_title": request.job_title,
                "department": request.department,
                "office_location": invitation["office_location"],
                "start_date": invitation["start_date"],
                "status": "pending",
                "expires_at": invitation["expires_at"].isoformat(),
                "invite_link": invite_link,
            },
        }

    async def get_invitation(self, token: str) -> dict:
        invitation = await self._get_valid_invitation(token)
        return {
            "invitation": {
                "token": invitation["token"],
                "email": invitation["email"],
                "full_name": invitation["full_name"],
                "job_title": invitation["job_title"],
                "department": invitation["department"],
                "office_location": invitation.get("office_location"),
                "start_date": invitation.get("start_date"),
                "expires_at": invitation["expires_at"].isoformat()
                if isinstance(invitation["expires_at"], datetime)
                else invitation["expires_at"],
                "status": invitation["status"],
            }
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
