from datetime import UTC, datetime

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import database, supabase
from app.schemas.invitation import CandidateRegisterRequest, OnboardingSaveRequest
from app.services.invitation_service import InvitationService


class CandidateService:
    def __init__(self) -> None:
        self.invitation_service = InvitationService()

    async def register(self, request: CandidateRegisterRequest) -> dict:
        invitation = await self.invitation_service._get_valid_invitation(request.invitation_token)

        if request.email.lower() != invitation["email"].lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the email address that received this invitation.",
            )

        existing_candidate = await database.candidates.find_one({"email": request.email})
        if existing_candidate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        existing_recruiter = await database.recruiters.find_one({"email": request.email})
        if existing_recruiter:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        try:
            response = await run_in_threadpool(
                supabase.auth.sign_up,
                {
                    "email": request.email,
                    "password": request.password,
                    "options": {
                        "data": {
                            "full_name": request.full_name,
                            "phone": request.phone,
                            "role": "candidate",
                            "invitation_token": request.invitation_token,
                        },
                        "email_redirect_to": settings.verification_redirect_url,
                    },
                },
            )
        except Exception as error:
            message = str(error).lower()
            if "already" in message or "registered" in message or "duplicate" in message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from error
            if "rate limit" in message:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Email sending is temporarily rate-limited by Supabase. Wait a few minutes, then try again (or use a different email).",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not create your account. Please try again.",
            ) from error

        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not create your account. Please try again.",
            )

        if response.user.identities == []:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        now = datetime.now(UTC)
        candidate = {
            "supabase_user_id": response.user.id,
            "full_name": request.full_name,
            "email": request.email,
            "phone": request.phone,
            "role": "candidate",
            "status": "pending_verification",
            "email_verified_at": None,
            "invitation_token": invitation["token"],
            "job_title": invitation["job_title"],
            "department": invitation["department"],
            "start_date": invitation.get("start_date"),
            "recruiter_id": invitation["recruiter_id"],
            "onboarding": {
                "status": "not_started",
                "current_step": "personal",
                "personal": None,
                "emergency": None,
                "employment": None,
                "documents": None,
                "submitted_at": None,
            },
            "created_at": now,
            "updated_at": now,
        }

        try:
            await database.candidates.insert_one(candidate)
        except Exception as error:
            if "duplicate key" in str(error).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Your account could not be saved. Please contact support if this continues.",
            ) from error

        await database.invitations.update_one(
            {"_id": invitation["_id"]},
            {"$set": {"status": "accepted", "updated_at": now}},
        )

        await database.audit_logs.insert_one(
            {
                "candidate_id": response.user.id,
                "email": request.email,
                "module": "authentication",
                "action": "candidate_registered",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "Registration successful. Check your inbox to verify your email address.",
            "role": "candidate",
            "redirect_to": "/verify-email",
        }

    async def activate_from_token(self, access_token: str) -> dict | None:
        """Activate a candidate after email verification. Returns None if not a candidate."""
        try:
            response = await run_in_threadpool(supabase.auth.get_user, access_token)
            user = response.user
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your verification session is invalid or has expired.",
            ) from error

        if not user or not user.email_confirmed_at:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Verify your email from the link in your inbox before continuing.",
            )

        candidate = await database.candidates.find_one({"supabase_user_id": user.id})
        if not candidate:
            return None

        if candidate["status"] == "active":
            return {
                "message": "Your email has already been verified.",
                "already_verified": True,
                "role": "candidate",
                "redirect_to": "/onboarding",
                "user": self._public_user(candidate),
            }

        verified_at = datetime.now(UTC)
        await database.candidates.update_one(
            {"_id": candidate["_id"], "status": "pending_verification"},
            {
                "$set": {
                    "status": "active",
                    "email_verified_at": verified_at,
                    "updated_at": verified_at,
                    "onboarding.status": "in_progress",
                }
            },
        )

        if candidate.get("invitation_token"):
            await database.invitations.update_one(
                {"token": candidate["invitation_token"]},
                {"$set": {"status": "used", "used_at": verified_at, "updated_at": verified_at}},
            )

        await database.audit_logs.insert_one(
            {
                "candidate_id": user.id,
                "email": candidate["email"],
                "module": "authentication",
                "action": "candidate_email_verified",
                "outcome": "success",
                "created_at": verified_at,
            }
        )

        candidate["status"] = "active"
        return {
            "message": "Your email has been verified. Continue to onboarding.",
            "already_verified": False,
            "role": "candidate",
            "redirect_to": "/onboarding",
            "user": self._public_user(candidate),
        }

    async def get_onboarding(self, access_token: str) -> dict:
        candidate = await self._require_active_candidate(access_token)
        return {
            "candidate": self._public_user(candidate),
            "onboarding": candidate.get("onboarding")
            or {
                "status": "not_started",
                "current_step": "personal",
                "personal": None,
                "emergency": None,
                "employment": None,
                "documents": None,
                "submitted_at": None,
            },
        }

    async def save_onboarding(self, access_token: str, request: OnboardingSaveRequest) -> dict:
        candidate = await self._require_active_candidate(access_token)
        onboarding = candidate.get("onboarding") or {}

        if onboarding.get("status") == "submitted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Onboarding has already been submitted.",
            )

        updates: dict = {"updated_at": datetime.now(UTC)}

        if request.step == "personal":
            if not request.personal:
                raise HTTPException(status_code=400, detail="Personal information is required.")
            updates["onboarding.personal"] = request.personal.model_dump(mode="json")
            updates["onboarding.current_step"] = "emergency"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "emergency":
            if not request.emergency:
                raise HTTPException(status_code=400, detail="Emergency contact is required.")
            updates["onboarding.emergency"] = request.emergency.model_dump(mode="json")
            updates["onboarding.current_step"] = "employment"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "employment":
            if not request.employment:
                raise HTTPException(status_code=400, detail="Employment information is required.")
            updates["onboarding.employment"] = request.employment.model_dump(mode="json")
            updates["onboarding.current_step"] = "documents"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "documents":
            if not request.documents:
                raise HTTPException(status_code=400, detail="Document acknowledgements are required.")
            updates["onboarding.documents"] = request.documents.model_dump(mode="json")
            updates["onboarding.current_step"] = "submit"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "submit":
            required = ["personal", "emergency", "employment", "documents"]
            missing = [key for key in required if not onboarding.get(key)]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Complete these steps before submitting: {', '.join(missing)}.",
                )
            submitted_at = datetime.now(UTC)
            updates["onboarding.status"] = "submitted"
            updates["onboarding.current_step"] = "complete"
            updates["onboarding.submitted_at"] = submitted_at
            await database.audit_logs.insert_one(
                {
                    "candidate_id": candidate["supabase_user_id"],
                    "email": candidate["email"],
                    "module": "onboarding",
                    "action": "onboarding_submitted",
                    "outcome": "success",
                    "created_at": submitted_at,
                }
            )

        await database.candidates.update_one({"_id": candidate["_id"]}, {"$set": updates})
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        return {
            "message": "Onboarding progress saved."
            if request.step != "submit"
            else "Onboarding submitted successfully.",
            "onboarding": refreshed.get("onboarding"),
            "candidate": self._public_user(refreshed),
        }

    async def _require_active_candidate(self, access_token: str) -> dict:
        try:
            response = await run_in_threadpool(supabase.auth.get_user, access_token)
            user = response.user
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required.",
            ) from error

        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

        candidate = await database.candidates.find_one({"supabase_user_id": user.id})
        if not candidate or candidate["status"] != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only verified candidates can access onboarding.",
            )
        return candidate

    @staticmethod
    def _public_user(candidate: dict) -> dict:
        return {
            "id": candidate["supabase_user_id"],
            "full_name": candidate["full_name"],
            "email": candidate["email"],
            "phone": candidate["phone"],
            "role": candidate["role"],
            "job_title": candidate.get("job_title"),
            "department": candidate.get("department"),
            "start_date": candidate.get("start_date"),
        }
