from datetime import UTC, datetime

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import database, supabase
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
)


class AuthService:
    # ------------------------------------------------------------------
    # Existing registration and verification (unchanged, kept for context)
    # ------------------------------------------------------------------

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
        if recruiter:
            if recruiter["status"] == "active":
                return {
                    "message": "Your email has already been verified.",
                    "already_verified": True,
                    "role": "recruiter",
                    "redirect_to": "/login",
                }

            verified_at = datetime.now(UTC)
            await database.recruiters.update_one(
                {"_id": recruiter["_id"], "status": "pending_verification"},
                {"$set": {"status": "active", "email_verified_at": verified_at, "updated_at": verified_at}},
            )
            await self._create_audit_log(user.id, recruiter["email"], "recruiter_email_verified", "success")
            return {
                "message": "Your email has been verified. Your recruiter account is now active.",
                "already_verified": False,
                "role": "recruiter",
                "redirect_to": "/login",
            }

        # US-010: candidate verification after invitation-based registration
        from app.services.candidate_service import CandidateService

        candidate_result = await CandidateService().activate_from_token(access_token)
        if candidate_result:
            return candidate_result

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account was not found.")

    # ------------------------------------------------------------------
    # New methods for US-003 → US-006
    # ------------------------------------------------------------------

    async def resend_verification(self, email: str) -> dict:
        """
        Resend the verification email while the account is still inactive.
        US-003: Recruiter wants to resend verification if not received.
        Also supports candidates (US-010) without changing recruiter behavior.
        """
        recruiter = await database.recruiters.find_one({"email": email})
        if recruiter:
            if recruiter["status"] != "pending_verification":
                return {"message": "If an account with that email exists, a new verification email has been sent."}

            try:
                await run_in_threadpool(
                    supabase.auth.resend,
                    {
                        "type": "signup",
                        "email": email,
                        "options": {"email_redirect_to": settings.verification_redirect_url},
                    },
                )
            except Exception as error:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="We could not resend the verification email. Please try again.",
                ) from error

            await self._create_audit_log(
                recruiter["supabase_user_id"], email, "recruiter_verification_resent", "success"
            )
            return {"message": "A new verification email has been sent. Please check your inbox."}

        candidate = await database.candidates.find_one({"email": email})
        if not candidate or candidate["status"] != "pending_verification":
            return {"message": "If an account with that email exists, a new verification email has been sent."}

        try:
            await run_in_threadpool(
                supabase.auth.resend,
                {
                    "type": "signup",
                    "email": email,
                    "options": {"email_redirect_to": settings.verification_redirect_url},
                },
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not resend the verification email. Please try again.",
            ) from error

        await database.audit_logs.insert_one(
            {
                "candidate_id": candidate["supabase_user_id"],
                "email": email,
                "module": "authentication",
                "action": "candidate_verification_resent",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {"message": "A new verification email has been sent. Please check your inbox."}

    async def login(self, request: LoginRequest) -> dict:
        """
        Authenticate recruiter and return JWT tokens.
        US-004: Recruiter securely logs in.
        US-005: 'remember_me' flag influences token persistence (handled later by refresh flow).
        """
        try:
            auth_response = await run_in_threadpool(
                supabase.auth.sign_in_with_password,
                {"email": request.email, "password": request.password},
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            ) from error

        user = auth_response.user
        if not user or not user.email_confirmed_at:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email before logging in.",
            )

        recruiter = await database.recruiters.find_one({"supabase_user_id": user.id})
        if recruiter and recruiter["status"] == "active":
            await self._create_audit_log(user.id, recruiter["email"], "recruiter_login", "success")
            return {
                "message": "Login successful.",
                "user": {
                    "id": recruiter["supabase_user_id"],
                    "full_name": recruiter["full_name"],
                    "email": recruiter["email"],
                    "phone": recruiter["phone"],
                    "role": recruiter["role"],
                },
                "session": {
                    "access_token": auth_response.session.access_token,
                    "refresh_token": auth_response.session.refresh_token,
                    "expires_in": auth_response.session.expires_in,
                    "token_type": auth_response.session.token_type,
                },
                "redirect_to": "/dashboard",
            }

        candidate = await database.candidates.find_one({"supabase_user_id": user.id})
        if candidate and candidate["status"] == "active":
            await database.audit_logs.insert_one(
                {
                    "candidate_id": user.id,
                    "email": candidate["email"],
                    "module": "authentication",
                    "action": "candidate_login",
                    "outcome": "success",
                    "created_at": datetime.now(UTC),
                }
            )
            onboarding_status = (candidate.get("onboarding") or {}).get("status")
            redirect_to = "/onboarding" if onboarding_status != "submitted" else "/onboarding"
            return {
                "message": "Login successful.",
                "user": {
                    "id": candidate["supabase_user_id"],
                    "full_name": candidate["full_name"],
                    "email": candidate["email"],
                    "phone": candidate["phone"],
                    "role": candidate["role"],
                    "job_title": candidate.get("job_title"),
                    "department": candidate.get("department"),
                },
                "session": {
                    "access_token": auth_response.session.access_token,
                    "refresh_token": auth_response.session.refresh_token,
                    "expires_in": auth_response.session.expires_in,
                    "token_type": auth_response.session.token_type,
                },
                "redirect_to": redirect_to,
            }

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not active. Please verify your email.",
        )

    async def refresh_token(self, refresh_token: str) -> dict:
        """
        Exchange a valid refresh token for a new token pair.
        US-005: Secure persistent session via refresh tokens.
        """
        try:
            response = await run_in_threadpool(
                supabase.auth.refresh_session,
                refresh_token,
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The refresh token is invalid or has expired.",
            ) from error

        if not response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not refresh the session. Please log in again.",
            )

        return {
            "message": "Session refreshed.",
            "session": {
                "access_token": response.session.access_token,
                "refresh_token": response.session.refresh_token,
                "expires_in": response.session.expires_in,
                "token_type": response.session.token_type,
            },
        }

    async def forgot_password(self, email: str) -> dict:
        """
        Send a password‑reset email.
        US-006: Recruiter requests a secure password reset.
        """
        # Check if recruiter exists (optional, for audit logging)
        recruiter = await database.recruiters.find_one({"email": email})
        if recruiter and recruiter["status"] == "active":
            await self._create_audit_log(
                recruiter["supabase_user_id"], email, "recruiter_password_reset_requested", "success"
            )

        try:
            await run_in_threadpool(
                supabase.auth.reset_password_for_email,
                email,
                {"redirect_to": settings.password_reset_redirect_url},
            )
        except Exception as error:
            # Still return a generic message to prevent email enumeration
            pass

        return {
            "message": "If an account with that email exists, a password reset link has been sent."
        }

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