from datetime import UTC, datetime

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import database, supabase
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    BootstrapSuperAdminRequest,
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

        super_admin = await database.super_admins.find_one({"supabase_user_id": user.id})
        if super_admin:
            if super_admin["status"] == "active":
                return {
                    "message": "Your email has already been verified.",
                    "already_verified": True,
                    "role": "super_admin",
                    "redirect_to": "/login",
                }
            verified_at = datetime.now(UTC)
            await database.super_admins.update_one(
                {"_id": super_admin["_id"], "status": "pending_verification"},
                {"$set": {"status": "active", "email_verified_at": verified_at, "updated_at": verified_at}},
            )
            return {
                "message": "Your email has been verified. Your super admin account is now active.",
                "already_verified": False,
                "role": "super_admin",
                "redirect_to": "/login",
            }

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account was not found.")

    async def bootstrap_super_admin(self, request: BootstrapSuperAdminRequest) -> dict:
        existing_count = await database.super_admins.count_documents({})
        if existing_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A super admin already exists. Sign in with the Super Admin role.",
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
                            "role": "super_admin",
                        },
                        "email_redirect_to": settings.verification_redirect_url,
                    },
                },
            )
        except Exception as error:
            message = str(error).lower()
            if "rate limit" in message:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Email sending is temporarily rate-limited by Supabase. Wait a few minutes, then try again.",
                ) from error
            if "already" in message or "registered" in message or "duplicate" in message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not create the super admin account. Please try again.",
            ) from error

        if not response.user or response.user.identities == []:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        now = datetime.now(UTC)
        await database.super_admins.insert_one(
            {
                "supabase_user_id": response.user.id,
                "full_name": request.full_name,
                "email": request.email,
                "phone": request.phone,
                "role": "super_admin",
                "status": "pending_verification",
                "email_verified_at": None,
                "created_at": now,
                "updated_at": now,
            }
        )
        return {
            "message": "Super admin created. Check your inbox to verify your email, then sign in as Super Admin.",
            "role": "super_admin",
        }

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

    ROLE_REDIRECTS = {
        "recruiter": "/dashboard/recruiter",
        "candidate": "/dashboard/candidate",
        "employee": "/dashboard/employee",
        "super_admin": "/dashboard/super-admin",
    }

    async def login(self, request: LoginRequest) -> dict:
        """
        Authenticate by selected role and route to the matching dashboard.
        US-004: Secure login for recruiter (extended for candidate, employee, super_admin).
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

        profile = await self._resolve_role_profile(user.id, request.role)
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No active {request.role.replace('_', ' ')} account found for these credentials.",
            )

        redirect_to = self.ROLE_REDIRECTS[request.role]
        if request.role == "candidate":
            onboarding_status = (profile.get("onboarding") or {}).get("status")
            if onboarding_status != "submitted":
                redirect_to = "/onboarding"

        await database.audit_logs.insert_one(
            {
                "user_id": user.id,
                "email": profile["email"],
                "module": "authentication",
                "action": f"{request.role}_login",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )

        return {
            "message": "Login successful.",
            "user": {
                "id": profile["supabase_user_id"],
                "full_name": profile["full_name"],
                "email": profile["email"],
                "phone": profile.get("phone"),
                "role": request.role,
                "job_title": profile.get("job_title"),
                "department": profile.get("department"),
            },
            "session": {
                "access_token": auth_response.session.access_token,
                "refresh_token": auth_response.session.refresh_token,
                "expires_in": auth_response.session.expires_in,
                "token_type": auth_response.session.token_type,
            },
            "redirect_to": redirect_to,
        }

    async def _resolve_role_profile(self, supabase_user_id: str, role: str) -> dict | None:
        collections = {
            "recruiter": database.recruiters,
            "candidate": database.candidates,
            "employee": database.employees,
            "super_admin": database.super_admins,
        }
        collection = collections.get(role)
        if collection is None:
            return None
        profile = await collection.find_one({"supabase_user_id": supabase_user_id})
        if not profile or profile.get("status") != "active":
            return None
        return profile

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
        Send a password-reset email via Supabase.
        US-006: Secure password reset for any role account.
        """
        normalized_email = email.lower().strip()

        for collection_name in ("recruiters", "candidates", "employees", "super_admins"):
            profile = await database[collection_name].find_one({"email": normalized_email})
            if profile and profile.get("status") == "active":
                await database.audit_logs.insert_one(
                    {
                        "user_id": profile.get("supabase_user_id"),
                        "email": normalized_email,
                        "role": profile.get("role"),
                        "module": "authentication",
                        "action": "password_reset_requested",
                        "outcome": "requested",
                        "created_at": datetime.now(UTC),
                    }
                )
                break

        try:
            await run_in_threadpool(
                supabase.auth.reset_password_for_email,
                normalized_email,
                {"redirect_to": settings.password_reset_redirect_url},
            )
        except Exception as error:
            message = str(error).lower()
            await database.audit_logs.insert_one(
                {
                    "email": normalized_email,
                    "module": "authentication",
                    "action": "password_reset_failed",
                    "outcome": "failed",
                    "detail": str(error)[:500],
                    "created_at": datetime.now(UTC),
                }
            )
            if "rate limit" in message:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many reset emails were requested. Please wait a few minutes and try again.",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "We could not send the password reset email. "
                    "Confirm the email exists in Supabase Auth, that "
                    f"{settings.password_reset_redirect_url} is allowed in Supabase Redirect URLs, "
                    "and that Auth email/SMTP is configured."
                ),
            ) from error

        return {
            "message": "If an account with that email exists, a password reset link has been sent. Check your inbox and spam folder."
        }

    async def reset_password(self, access_token: str, refresh_token: str, password: str) -> dict:
        """Complete password reset using the recovery session from the email link."""
        try:
            await run_in_threadpool(supabase.auth.set_session, access_token, refresh_token)
            await run_in_threadpool(supabase.auth.update_user, {"password": password})
        except Exception as error:
            message = str(error).lower()
            if "session" in message or "token" in message or "jwt" in message:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="This reset link is invalid or has expired. Request a new one.",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not update your password. Please try again.",
            ) from error

        try:
            user_response = await run_in_threadpool(supabase.auth.get_user, access_token)
            user = user_response.user
            if user and user.email:
                await database.audit_logs.insert_one(
                    {
                        "user_id": user.id,
                        "email": user.email,
                        "module": "authentication",
                        "action": "password_reset_completed",
                        "outcome": "success",
                        "created_at": datetime.now(UTC),
                    }
                )
        except Exception:
            pass

        return {"message": "Your password has been updated. You can now sign in."}

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