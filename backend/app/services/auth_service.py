from datetime import UTC, datetime

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import database, supabase
from app.schemas.auth import RegisterRequest


class AuthService:
    async def register(self, request: RegisterRequest) -> dict:
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
                        "data": {"full_name": request.full_name, "phone": request.phone, "role": "recruiter"},
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
        recruiter = {
            "supabase_user_id": response.user.id,
            "full_name": request.full_name,
            "email": request.email,
            "phone": request.phone,
            "role": "recruiter",
            "status": "pending_verification",
            "email_verified_at": None,
            "created_at": now,
            "updated_at": now,
        }

        try:
            await database.recruiters.insert_one(recruiter)
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

        await self._create_audit_log(response.user.id, request.email, "recruiter_registered", "success")
        return {"message": "Registration successful. Check your inbox to verify your email address."}

    async def verify_email(self, access_token: str) -> dict:
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

        recruiter = await database.recruiters.find_one({"supabase_user_id": user.id})
        if not recruiter:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recruiter account was not found.")

        if recruiter["status"] == "active":
            return {"message": "Your email has already been verified.", "already_verified": True}

        verified_at = datetime.now(UTC)
        await database.recruiters.update_one(
            {"_id": recruiter["_id"], "status": "pending_verification"},
            {"$set": {"status": "active", "email_verified_at": verified_at, "updated_at": verified_at}},
        )
        await self._create_audit_log(user.id, recruiter["email"], "recruiter_email_verified", "success")
        return {"message": "Your email has been verified. Your recruiter account is now active.", "already_verified": False}

    async def _create_audit_log(self, recruiter_id: str, email: str, action: str, outcome: str) -> None:
        await database.audit_logs.insert_one(
            {
                "recruiter_id": recruiter_id,
                "email": email,
                "module": "authentication",
                "action": action,
                "outcome": outcome,
                "created_at": datetime.now(UTC),
            }
        )
