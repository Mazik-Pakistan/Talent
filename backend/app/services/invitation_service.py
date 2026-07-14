from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.invitation import CreateInvitationRequest


class InvitationService:
    async def create_invitation(self, request: CreateInvitationRequest, actor: CurrentUser) -> dict:
        existing_candidate = await database.candidates.find_one({"email": request.email})
        if existing_candidate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A candidate account already exists for this email address.",
            )

        active_invite = await database.invitations.find_one(
            {
                "email": request.email,
                "status": "pending",
                "expires_at": {"$gt": datetime.now(UTC)},
            }
        )
        if active_invite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active invitation already exists for this email address.",
            )

        now = datetime.now(UTC)
        token = token_urlsafe(32)
        invitation = {
            "token": token,
            "email": request.email,
            "full_name": request.full_name,
            "job_title": request.job_title,
            "department": request.department,
            "start_date": request.start_date.isoformat() if request.start_date else None,
            "recruiter_id": actor.id,
            "recruiter_email": actor.email,
            "created_by_role": actor.role,
            "status": "pending",
            "expires_at": now + timedelta(days=request.expires_in_days),
            "used_at": None,
            "created_at": now,
            "updated_at": now,
        }
        await database.invitations.insert_one(invitation)

        await database.audit_logs.insert_one(
            {
                "user_id": actor.id,
                "recruiter_id": actor.id,
                "email": request.email,
                "role": actor.role,
                "module": "recruitment",
                "action": "invitation_created",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "Invitation created successfully.",
            "invitation": {
                "token": token,
                "email": request.email,
                "full_name": request.full_name,
                "job_title": request.job_title,
                "department": request.department,
                "start_date": invitation["start_date"],
                "status": "pending",
                "expires_at": invitation["expires_at"].isoformat(),
                "invite_link": settings.invitation_link(token),
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
