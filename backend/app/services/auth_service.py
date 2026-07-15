"""MongoDB + JWT authentication service — replaces all Supabase Auth."""

import random
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from jose import jwt
from pymongo import ReturnDocument

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.schemas.auth import (
    BootstrapSuperAdminRequest,
    LoginRequest,
    RegisterRequest,
)
from app.services.email_service import email_service

# ---------- Brute-force protection constants ----------
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_MINUTES = 15


def _generate_otp() -> str:
    """Generate a cryptographically random 6-digit OTP."""
    return str(random.SystemRandom().randint(100000, 999999))


class AuthService:

    # ------------------------------------------------------------------ #
    # SIGNUP — Recruiter                                                    #
    # ------------------------------------------------------------------ #

    async def register(self, request: RegisterRequest) -> dict:
        """
        Step 1 of signup: store pending user + send OTP email.
        Account is NOT active until OTP is verified.
        """
        email = request.email.lower().strip()

        # Duplicate checks across all active collections
        if await database.users.find_one({"email": email}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )
        if await database.recruiters.find_one({"email": email}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        otp = _generate_otp()
        now = datetime.now(UTC)
        otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        # pending entry expires after 30 minutes so MongoDB TTL can clean it up
        pending_expires_at = now + timedelta(minutes=30)

        await database.pending_users.replace_one(
            {"email": email},
            {
                "email": email,
                "full_name": request.full_name,
                "phone": request.phone,
                "password_hash": hash_password(request.password),
                "role": "recruiter",
                "otp": otp,
                "otp_expires_at": otp_expires_at,
                "expires_at": pending_expires_at,
                "created_at": now,
            },
            upsert=True,
        )

        try:
            email_service.send_signup_otp(email, request.full_name, otp)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not send the verification email. Please try again.",
            ) from exc

        return {
            "message": "Registration successful. A 6-digit verification code has been sent to your email.",
        }

    # ------------------------------------------------------------------ #
    # OTP VERIFICATION — Signup                                            #
    # ------------------------------------------------------------------ #

    async def verify_otp(self, email: str, otp: str) -> dict:
        """
        Step 2 of signup: verify the OTP, activate the account, and return JWT.
        """
        email = email.lower().strip()

        pending = await database.pending_users.find_one({"email": email})
        if not pending:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No pending registration found for this email. Please register again.",
            )

        otp_expires_at = pending["otp_expires_at"]
        if otp_expires_at.tzinfo is None:
            otp_expires_at = otp_expires_at.replace(tzinfo=UTC)

        if datetime.now(UTC) > otp_expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This verification code has expired. Please request a new one.",
            )

        if pending["otp"] != otp.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid verification code. Please try again.",
            )

        now = datetime.now(UTC)
        role = pending["role"]

        # Create user credentials record
        user_doc = {
            "email": email,
            "password_hash": pending["password_hash"],
            "role": role,
            "created_at": now,
            "updated_at": now,
        }
        try:
            result = await database.users.insert_one(user_doc)
            user_id = str(result.inserted_id)
        except Exception as exc:
            if "duplicate key" in str(exc).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Account could not be created. Please contact support.",
            ) from exc

        # Create role-specific profile
        profile_doc = {
            "user_id": user_id,
            "full_name": pending["full_name"],
            "email": email,
            "phone": pending.get("phone"),
            "role": role,
            "status": "active",
            "email_verified_at": now,
            "created_at": now,
            "updated_at": now,
        }

        collection_map = {
            "recruiter": database.recruiters,
            "super_admin": database.super_admins,
            "candidate": database.candidates,
            "employee": database.employees,
        }
        collection = collection_map.get(role)
        extra = pending.get("extra_data") or {}
        if collection is not None:
            profile_doc.update(extra)
            if role == "candidate":
                # Remove any leftover unverified docs from the old Supabase path
                await database.candidates.delete_many(
                    {"email": email, "status": {"$ne": "active"}}
                )
                onboarding = profile_doc.get("onboarding") or {}
                onboarding["status"] = "in_progress"
                profile_doc["onboarding"] = onboarding
            await collection.insert_one(profile_doc)

        # Remove the pending record
        await database.pending_users.delete_one({"email": email})

        # Audit log
        await self._create_audit_log(user_id, email, f"{role}_email_verified", "success")

        # For non-candidate roles: redirect to login (no auto-session)
        if role != "candidate":
            return {
                "message": "Your email has been verified. Your account is now active.",
                "already_verified": False,
                "role": role,
                "redirect_to": "/login",
            }

        # Candidate: mark invitation used, notify recruiter, issue JWT for onboarding
        invite_token = extra.get("invitation_token")
        if invite_token:
            await database.invitations.update_one(
                {"token": invite_token},
                {"$set": {"status": "used", "used_at": now, "updated_at": now}},
            )

        recruiter_id = extra.get("recruiter_id")
        if recruiter_id:
            from app.services.dashboard_service import create_notification

            await create_notification(
                recipient_id=recruiter_id,
                recipient_role="recruiter",
                notif_type="candidate_registered",
                title="Candidate registered",
                message=f"{pending['full_name']} verified their email and started onboarding.",
                link="/dashboard/recruiter#approvals-section",
                related_id=user_id,
            )

        access_token = create_access_token({"user_id": user_id, "email": email, "role": role})
        refresh_token_str = create_refresh_token({"user_id": user_id, "email": email, "role": role})
        await self._store_refresh_token(user_id, refresh_token_str)

        return {
            "message": "Your email has been verified. Continue to onboarding.",
            "already_verified": False,
            "role": role,
            "redirect_to": "/onboarding",
            "user": {
                "id": user_id,
                "full_name": pending["full_name"],
                "email": email,
                "phone": pending.get("phone"),
                "role": role,
            },
            "session": {
                "access_token": access_token,
                "refresh_token": refresh_token_str,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
            },
        }

    # ------------------------------------------------------------------ #
    # RESEND OTP                                                           #
    # ------------------------------------------------------------------ #

    async def resend_otp(self, email: str) -> dict:
        """Resend a fresh OTP to the pending user's email."""
        email = email.lower().strip()

        pending = await database.pending_users.find_one({"email": email})
        if not pending:
            # Generic response — don't leak whether the email is pending
            return {"message": "If a pending registration exists, a new code has been sent."}

        otp = _generate_otp()
        now = datetime.now(UTC)
        otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        pending_expires_at = now + timedelta(minutes=30)

        await database.pending_users.update_one(
            {"email": email},
            {
                "$set": {
                    "otp": otp,
                    "otp_expires_at": otp_expires_at,
                    "expires_at": pending_expires_at,
                }
            },
        )

        try:
            email_service.send_signup_otp(email, pending.get("full_name", ""), otp)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not resend the verification email. Please try again.",
            ) from exc

        return {"message": "A new verification code has been sent to your email."}

    # Kept for backward compatibility — delegates to resend_otp
    async def resend_verification(self, email: str) -> dict:
        return await self.resend_otp(email)

    # ------------------------------------------------------------------ #
    # BOOTSTRAP SUPER ADMIN                                                #
    # ------------------------------------------------------------------ #

    async def bootstrap_super_admin(self, request: BootstrapSuperAdminRequest) -> dict:
        """Create the first super admin when none exists yet (OTP-gated)."""
        existing_count = await database.super_admins.count_documents({})
        if existing_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A super admin already exists. Sign in with the Super Admin role.",
            )

        email = request.email.lower().strip()

        if await database.users.find_one({"email": email}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        otp = _generate_otp()
        now = datetime.now(UTC)
        otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        pending_expires_at = now + timedelta(minutes=30)

        await database.pending_users.replace_one(
            {"email": email},
            {
                "email": email,
                "full_name": request.full_name,
                "phone": request.phone,
                "password_hash": hash_password(request.password),
                "role": "super_admin",
                "otp": otp,
                "otp_expires_at": otp_expires_at,
                "expires_at": pending_expires_at,
                "created_at": now,
            },
            upsert=True,
        )

        try:
            email_service.send_signup_otp(email, request.full_name, otp)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not send the verification email. Please try again.",
            ) from exc

        return {
            "message": "Super admin registration initiated. Check your inbox for the verification code.",
            "role": "super_admin",
        }

    # ------------------------------------------------------------------ #
    # LOGIN                                                                #
    # ------------------------------------------------------------------ #

    ROLE_REDIRECTS = {
        "recruiter": "/dashboard/recruiter",
        "candidate": "/dashboard/candidate",
        "employee": "/dashboard/employee",
        "super_admin": "/dashboard/super-admin",
    }

    async def login(self, request: LoginRequest) -> dict:
        """
        Authenticate with email + password, scoped to the requested role.
        Business rule: max 5 failed attempts, 15-minute lockout.
        """
        email = request.email.lower().strip()
        await self._check_account_lock(email)

        # Verify credentials against the users collection
        user_doc = await database.users.find_one({"email": email})
        if not user_doc or not verify_password(request.password, user_doc.get("password_hash", "")):
            await self._register_failed_login(email)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        await self._clear_failed_login(email)
        user_id = str(user_doc["_id"])

        # Resolve the role profile
        profile = await self._resolve_role_profile(user_id, request.role)
        if not profile:
            # Helpful message when candidate was converted to employee
            if request.role == "candidate":
                converted = await database.candidates.find_one(
                    {"email": email, "status": "converted"}
                )
                if converted:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Your candidate profile was converted to an employee. Sign in with the Employee role.",
                    )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No active {request.role.replace('_', ' ')} account found for these credentials.",
            )

        redirect_to = self.ROLE_REDIRECTS[request.role]
        if request.role == "candidate":
            onboarding_status = (profile.get("onboarding") or {}).get("status")
            if onboarding_status != "submitted":
                redirect_to = "/onboarding"
        if request.role == "employee":
            redirect_to = "/dashboard/employee"

        access_token = create_access_token({"user_id": user_id, "email": email, "role": request.role})
        refresh_token_str = create_refresh_token({"user_id": user_id, "email": email, "role": request.role})
        await self._store_refresh_token(user_id, refresh_token_str)

        await database.audit_logs.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "module": "authentication",
                "action": f"{request.role}_login",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )

        return {
            "message": "Login successful.",
            "user": {
                "id": user_id,
                "full_name": profile["full_name"],
                "email": profile["email"],
                "phone": profile.get("phone"),
                "role": request.role,
                "job_title": profile.get("job_title"),
                "department": profile.get("department"),
                "employee_id": profile.get("employee_id"),
            },
            "session": {
                "access_token": access_token,
                "refresh_token": refresh_token_str,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
            },
            "redirect_to": redirect_to,
        }

    # ------------------------------------------------------------------ #
    # LOGOUT                                                               #
    # ------------------------------------------------------------------ #

    async def logout(self, current_user: CurrentUser) -> dict:
        """Revoke all refresh tokens for the current user."""
        await database.refresh_tokens.delete_many({"user_id": current_user.id})
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "role": current_user.role,
                "module": "authentication",
                "action": f"{current_user.role}_logout",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {"message": "You have been signed out."}

    # ------------------------------------------------------------------ #
    # REFRESH TOKEN                                                        #
    # ------------------------------------------------------------------ #

    async def refresh_token(self, refresh_token_str: str) -> dict:
        """Exchange a valid refresh token for a new access token."""
        stored = await database.refresh_tokens.find_one({"token": refresh_token_str})
        if not stored:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The refresh token is invalid or has expired.",
            )

        expires_at = stored["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if datetime.now(UTC) > expires_at:
            await database.refresh_tokens.delete_one({"token": refresh_token_str})
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The refresh token is invalid or has expired.",
            )

        # Decode to get payload
        try:
            from jose import JWTError
            payload = jwt.decode(refresh_token_str, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The refresh token is invalid or has expired.",
            )

        user_id = payload.get("user_id")
        email = payload.get("email")
        role = payload.get("role")

        new_access_token = create_access_token({"user_id": user_id, "email": email, "role": role})
        new_refresh_token = create_refresh_token({"user_id": user_id, "email": email, "role": role})

        # Rotate: delete old, store new
        await database.refresh_tokens.delete_one({"token": refresh_token_str})
        await self._store_refresh_token(user_id, new_refresh_token)

        return {
            "message": "Session refreshed.",
            "session": {
                "access_token": new_access_token,
                "refresh_token": new_refresh_token,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
            },
        }

    # ------------------------------------------------------------------ #
    # FORGOT PASSWORD                                                      #
    # ------------------------------------------------------------------ #

    async def forgot_password(self, email: str) -> dict:
        """Generate a password-reset OTP and send it by email."""
        email = email.lower().strip()

        # Check if the user exists across all role collections
        user_exists = False
        for collection_name in ("recruiters", "candidates", "employees", "super_admins"):
            profile = await database[collection_name].find_one({"email": email})
            if profile and profile.get("status") == "active":
                user_exists = True
                await database.audit_logs.insert_one(
                    {
                        "user_id": profile.get("user_id"),
                        "email": email,
                        "role": profile.get("role"),
                        "module": "authentication",
                        "action": "password_reset_requested",
                        "outcome": "requested",
                        "created_at": datetime.now(UTC),
                    }
                )
                break

        # Always return a generic message — don't leak whether the email exists
        if user_exists:
            otp = _generate_otp()
            now = datetime.now(UTC)
            otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

            await database.otp_verifications.replace_one(
                {"email": email, "purpose": "reset_password"},
                {
                    "email": email,
                    "purpose": "reset_password",
                    "otp": otp,
                    "used": False,
                    "expires_at": otp_expires_at,
                    "created_at": now,
                },
                upsert=True,
            )

            try:
                email_service.send_forgot_password_otp(email, otp)
            except Exception:
                pass  # Best-effort; don't reveal failures

        return {
            "message": "If an account with that email exists, a password reset code has been sent. Check your inbox and spam folder."
        }

    # ------------------------------------------------------------------ #
    # RESET PASSWORD                                                       #
    # ------------------------------------------------------------------ #

    async def reset_password(self, email: str, otp: str, password: str) -> dict:
        """Verify the reset OTP and update the user's password."""
        email = email.lower().strip()

        otp_record = await database.otp_verifications.find_one(
            {"email": email, "purpose": "reset_password"}
        )
        if not otp_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No password reset request was found. Please request a new code.",
            )

        if otp_record.get("used"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset code has already been used. Please request a new one.",
            )

        expires_at = otp_record["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)

        if datetime.now(UTC) > expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset code has expired. Please request a new one.",
            )

        if otp_record["otp"] != otp.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reset code. Please try again.",
            )

        # Update the password
        new_hash = hash_password(password)
        result = await database.users.update_one(
            {"email": email},
            {"$set": {"password_hash": new_hash, "updated_at": datetime.now(UTC)}},
        )
        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found.",
            )

        # Invalidate the OTP and all existing refresh tokens
        await database.otp_verifications.update_one(
            {"email": email, "purpose": "reset_password"},
            {"$set": {"used": True}},
        )
        user_doc = await database.users.find_one({"email": email})
        if user_doc:
            await database.refresh_tokens.delete_many({"user_id": str(user_doc["_id"])})

        await database.audit_logs.insert_one(
            {
                "email": email,
                "module": "authentication",
                "action": "password_reset_completed",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )

        return {"message": "Your password has been updated. You can now sign in."}

    # ------------------------------------------------------------------ #
    # CHANGE PASSWORD (authenticated)                                     #
    # ------------------------------------------------------------------ #

    async def change_password(self, current_user: CurrentUser, current_password: str, new_password: str) -> dict:
        """Allow authenticated users to change their own password."""
        user_doc = await database.users.find_one({"email": current_user.email})
        if not user_doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

        if not verify_password(current_password, user_doc.get("password_hash", "")):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current password is incorrect.",
            )

        new_hash = hash_password(new_password)
        await database.users.update_one(
            {"email": current_user.email},
            {"$set": {"password_hash": new_hash, "updated_at": datetime.now(UTC)}},
        )

        # Invalidate all refresh tokens for security
        await database.refresh_tokens.delete_many({"user_id": current_user.id})

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "module": "authentication",
                "action": "password_changed",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )
        return {"message": "Password updated successfully."}

    # ------------------------------------------------------------------ #
    # Helpers: brute-force protection                                     #
    # ------------------------------------------------------------------ #

    async def _check_account_lock(self, email: str) -> None:
        record = await database.login_attempts.find_one({"email": email})
        if not record or not record.get("locked_until"):
            return

        locked_until = record["locked_until"]
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=UTC)

        now = datetime.now(UTC)
        if locked_until <= now:
            await database.login_attempts.update_one(
                {"email": email}, {"$set": {"failed_count": 0, "locked_until": None}}
            )
            return

        minutes_left = max(1, int((locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                "This account is temporarily locked after too many failed sign-in attempts. "
                f"Try again in {minutes_left} minute(s)."
            ),
        )

    async def _register_failed_login(self, email: str) -> None:
        now = datetime.now(UTC)
        record = await database.login_attempts.find_one_and_update(
            {"email": email},
            {
                "$inc": {"failed_count": 1},
                "$set": {"last_attempt_at": now},
                "$setOnInsert": {"email": email},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )

        await database.audit_logs.insert_one(
            {
                "email": email,
                "module": "authentication",
                "action": "login_failed",
                "outcome": "failed",
                "created_at": now,
            }
        )

        if record and record.get("failed_count", 0) >= LOCKOUT_THRESHOLD:
            locked_until = now + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            await database.login_attempts.update_one(
                {"email": email},
                {"$set": {"locked_until": locked_until, "failed_count": 0}},
            )

    async def _clear_failed_login(self, email: str) -> None:
        await database.login_attempts.delete_one({"email": email})

    # ------------------------------------------------------------------ #
    # Helpers: profile resolution & refresh tokens                        #
    # ------------------------------------------------------------------ #

    async def _resolve_role_profile(self, user_id: str, role: str) -> dict | None:
        collections = {
            "recruiter": database.recruiters,
            "candidate": database.candidates,
            "employee": database.employees,
            "super_admin": database.super_admins,
        }
        collection = collections.get(role)
        if collection is None:
            return None
        profile = await collection.find_one({"user_id": user_id})
        if not profile or profile.get("status") != "active":
            return None
        return profile

    async def _store_refresh_token(self, user_id: str, token: str) -> None:
        await database.refresh_tokens.insert_one(
            {
                "user_id": user_id,
                "token": token,
                "expires_at": datetime.now(UTC) + timedelta(days=7),
                "created_at": datetime.now(UTC),
            }
        )

    async def _create_audit_log(self, user_id: str, email: str, action: str, outcome: str) -> None:
        await database.audit_logs.insert_one(
            {
                "recruiter_id": user_id,
                "email": email,
                "module": "authentication",
                "action": action,
                "outcome": outcome,
                "created_at": datetime.now(UTC),
            }
        )