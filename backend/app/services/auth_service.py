"""MongoDB + JWT authentication service — replaces all Supabase Auth."""

import random
from datetime import UTC, datetime, timedelta

from bson import ObjectId
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
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service, unique_emails

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
    # RECRUITER INVITE ACCEPT — Step 1                                    #
    # ------------------------------------------------------------------ #

    async def recruiter_register(self, request) -> dict:
        """Recruiter invite accept → pending_users + SMTP OTP."""
        from app.services.invitation_service import InvitationService

        invitation_service = InvitationService()
        invitation = await invitation_service._get_valid_invitation(request.invitation_token)

        if invitation.get("kind") != "recruiter":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This invitation is not for a recruiter account.",
            )

        email = request.email.lower().strip()
        if email != invitation["email"].lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the email address that received this invitation.",
            )

        # Check no existing active accounts
        from app.services.people_history import (
            find_active_candidate,
            find_active_employee,
            find_active_user,
            prepare_email_for_reinvite,
        )

        await prepare_email_for_reinvite(email)

        if await find_active_user(email):
            raise HTTPException(status_code=409, detail="An account already exists for this email address.")
        if await find_active_candidate(email):
            raise HTTPException(status_code=409, detail="An account already exists for this email address.")
        if await find_active_employee(email):
            raise HTTPException(status_code=409, detail="An active employee already exists for this email address.")
        if await database.recruiters.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="An account already exists for this email address.")

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
                "role": "recruiter",
                "otp": otp,
                "otp_expires_at": otp_expires_at,
                "expires_at": pending_expires_at,
                "created_at": now,
                "extra_data": {
                    "invitation_token": invitation["token"],
                    "invitation_kind": "recruiter",
                    "job_title": invitation["job_title"],
                    "department": invitation["department"],
                    "office_location": invitation.get("office_location"),
                    "is_remote": invitation.get("is_remote"),
                    "organization_id": invitation.get("organization_id"),
                    "capabilities": invitation.get("capabilities") or {},
                },
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
            "role": "recruiter",
            "redirect_to": "/verify-email",
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

        extra = pending.get("extra_data") or {}

        # Recruiter invitation: create dual employee+recruiter profile, issue employee session
        if role == "recruiter" and extra.get("invitation_kind") == "recruiter":
            return await self._activate_invited_recruiter(pending, extra, email, now)

        # Create user credentials record
        user_doc = {
            "email": email,
            "password_hash": pending["password_hash"],
            "role": role,
            "status": "active",
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
                # Keep historical candidate cycles; never wipe prior declined/converted records.
                onboarding = profile_doc.get("onboarding") or {}
                onboarding["status"] = "in_progress"
                profile_doc["onboarding"] = onboarding
                profile_doc["history_bucket"] = "active"
                profile_doc["lifecycle_state"] = profile_doc.get("lifecycle_state") or "invited"
                profile_doc["cycle_group_key"] = profile_doc.get("cycle_group_key") or email
                # Link to prior candidate cycle if present.
                prior = await database.candidates.find_one(
                    {
                        "email": email,
                        "$or": [
                            {"history_bucket": "historical"},
                            {"status": {"$in": ["converted", "historical", "declined", "offer_declined"]}},
                            {"conversion_status": {"$in": ["converted", "offer_declined", "declined"]}},
                        ],
                    },
                    sort=[("created_at", -1)],
                )
                if prior:
                    profile_doc["previous_candidate_id"] = prior.get("user_id") or str(prior.get("_id"))
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

        # Candidate: mark invitation used, bind offer, notify recruiter, issue JWT
        invite_token = extra.get("invitation_token")
        if invite_token:
            await database.invitations.update_one(
                {"token": invite_token},
                {"$set": {"status": "used", "used_at": now, "updated_at": now}},
            )

        from app.services.offer_service import offer_service

        bound_offer = await offer_service.bind_to_candidate(
            user_id=user_id,
            email=email,
            invitation_token=invite_token,
            full_name=pending["full_name"],
        )

        recruiter_id = extra.get("recruiter_id")
        if recruiter_id:
            from app.services.dashboard_service import create_notification

            await create_notification(
                recipient_id=recruiter_id,
                recipient_role="recruiter",
                notif_type="candidate_registered",
                title="Candidate registered",
                message=(
                    f"{pending['full_name']} verified their email and can now review their offer letter."
                    if bound_offer
                    else f"{pending['full_name']} verified their email and started onboarding."
                ),
                link="/dashboard/recruiter/candidates",
                related_id=user_id,
            )

        access_token = create_access_token({"user_id": user_id, "email": email, "role": role})
        refresh_token_str = create_refresh_token({"user_id": user_id, "email": email, "role": role})
        await self._store_refresh_token(user_id, refresh_token_str)

        redirect_to = "/offer" if bound_offer else "/onboarding"
        return {
            "message": (
                "Your email has been verified. Review and sign your offer letter."
                if bound_offer
                else "Your email has been verified. Continue to onboarding."
            ),
            "already_verified": False,
            "role": role,
            "redirect_to": redirect_to,
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

    # Order used when the client does not specify a role on login: the first
    # active profile this account holds wins, so a candidate lands on the
    # candidate board, an employee on the employee board, and a recruiter-only
    # account on the recruiter dashboard.
    ROLE_DETECT_ORDER = ("candidate", "employee", "recruiter")

    async def login(self, request: LoginRequest) -> dict:
        """
        Authenticate with email + password. When the client does not specify
        a role (the public login screen no longer asks), the active role
        profile is auto-detected and the user is routed to the matching
        dashboard.
        Business rule: max 5 failed attempts, 15-minute lockout.
        """
        email = request.email.lower().strip()
        # Both the personal email and an assigned company email resolve to the
        # SAME account. The lockout counter and audit trail use the canonical
        # personal email so both login methods protect one account.
        account_email = await self._resolve_account_email(email) or email
        await self._check_account_lock(account_email)

        # Verify credentials against the users collection (canonical account).
        user_doc = await self._find_user_doc_by_login_email(email)
        if not user_doc or not verify_password(request.password, user_doc.get("password_hash", "")):
            await self._register_failed_login(account_email)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )
        if user_doc.get("status") == "archived":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is archived. Use a new invitation to rejoin as a candidate.",
            )

        await self._clear_failed_login(account_email)
        user_id = str(user_doc["_id"])
        # Use the canonical personal email for the token, audit trail, and all
        # downstream lookups — the company email is a login alias only.
        email = user_doc["email"]

        # Resolve the role profile. The public login screen no longer asks
        # for a role — it is auto-detected from the active profiles this
        # account holds. A recruiter-only account (no employee profile) lands
        # on the recruiter dashboard, and a dual-role account (employee AND
        # recruiter) lands on the employee dashboard first and can switch to
        # Recruiter from inside the app. An explicit role (legacy clients,
        # super admin portal) keeps the previous scoped behavior.
        if request.role is None:
            effective_role = await self._auto_detect_role(user_id)
            if effective_role is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No active account found for these credentials.",
                )
            profile = await self._resolve_role_profile(user_id, effective_role)
        else:
            effective_role = request.role
            profile = await self._resolve_role_profile(user_id, request.role)
            if not profile and request.role == "employee":
                profile = await self._resolve_role_profile(user_id, "recruiter")
                if profile:
                    effective_role = "recruiter"

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

        redirect_to = self.ROLE_REDIRECTS[effective_role]
        if effective_role == "candidate":
            from app.services.offer_service import offer_service

            has_signed = await offer_service.has_signed_offer(user_id, email)
            if not has_signed:
                redirect_to = "/offer"
            else:
                onboarding_status = (profile.get("onboarding") or {}).get("status")
                redirect_to = (
                    "/dashboard/candidate" if onboarding_status == "submitted" else "/onboarding"
                )
        if effective_role == "employee":
            redirect_to = "/dashboard/employee"

        available_roles = await self._available_switch_roles(user_id, effective_role)

        capabilities = None
        if effective_role == "recruiter":
            capabilities = await self._recruiter_capabilities(user_id, email)

        access_token = create_access_token({"user_id": user_id, "email": email, "role": effective_role})
        refresh_days = 30 if request.remember_me else 7
        refresh_token_str = create_refresh_token(
            {"user_id": user_id, "email": email, "role": effective_role},
            expires_days=refresh_days,
        )
        await self._store_refresh_token(user_id, refresh_token_str, remember_me=request.remember_me)

        await database.audit_logs.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "module": "authentication",
                "action": f"{effective_role}_login",
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
                "role": effective_role,
                "job_title": profile.get("job_title"),
                "department": profile.get("department"),
                "employee_id": profile.get("employee_id"),
                "profile_picture": profile.get("profile_picture"),
                "available_roles": available_roles,
                "capabilities": capabilities,
                "must_change_password": bool(user_doc.get("must_change_password")),
            },
            "session": {
                "access_token": access_token,
                "refresh_token": refresh_token_str,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
                "remember_me": request.remember_me,
            },
            "redirect_to": redirect_to,
        }

    # ------------------------------------------------------------------ #
    # ROLE SWITCH (dual employee + recruiter accounts)                    #
    # ------------------------------------------------------------------ #

    async def _recruiter_capabilities(self, user_id: str, email: str) -> dict:
        """Delegate map for a recruiter account. Legacy recruiters created
        before the capability system default to full access."""
        profile = await database.recruiters.find_one(
            {"$or": [{"user_id": user_id}, {"email": email.lower()}], "status": "active"}
        )
        caps = (profile or {}).get("capabilities")
        if caps:
            return caps
        return {
            "overview": True,
            "candidates": True,
            "invite": True,
            "employees": True,
            "talent": True,
            "learning": True,
            "assistant": True,
            "messages": True,
            "announcements": True,
            "it": True,
            "reporting": True,
            "profile": True,
        }

    async def _available_switch_roles(self, user_id: str, primary_role: str) -> list[str]:
        """Which of {employee, recruiter} this account has an active profile for.

        Only these two roles support switching today. The primary (currently
        active) role is always listed first.
        """
        if primary_role not in ("employee", "recruiter"):
            return [primary_role]

        found: list[str] = []
        for role_name in ("employee", "recruiter"):
            profile = await self._resolve_role_profile(user_id, role_name)
            if profile:
                found.append(role_name)

        if primary_role in found:
            found.remove(primary_role)
        return [primary_role, *found]

    async def switch_role(self, current_user: CurrentUser, target_role: str) -> dict:
        """Re-authenticate the current session under a different role the same
        account also holds (e.g. an employee who is also a recruiter). Issues
        a fresh token pair and rotates out the old refresh token so the
        session can't silently fall back to the previous role."""
        if target_role not in ("employee", "recruiter"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only Employee and Recruiter roles support switching.",
            )
        if target_role == current_user.role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"You are already signed in as {target_role.replace('_', ' ')}.",
            )

        profile = await self._resolve_role_profile(current_user.id, target_role)
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No active {target_role.replace('_', ' ')} account is linked to this login.",
            )

        # Preserve the "remember me" duration from the session being replaced.
        existing_token = await database.refresh_tokens.find_one({"user_id": current_user.id})
        remember_me = bool(existing_token.get("remember_me")) if existing_token else False
        refresh_days = 30 if remember_me else 7

        access_token = create_access_token(
            {"user_id": current_user.id, "email": current_user.email, "role": target_role}
        )
        refresh_token_str = create_refresh_token(
            {"user_id": current_user.id, "email": current_user.email, "role": target_role},
            expires_days=refresh_days,
        )

        # Rotate: invalidate the previous role's session, issue a fresh one.
        await database.refresh_tokens.delete_many({"user_id": current_user.id})
        await self._store_refresh_token(current_user.id, refresh_token_str, remember_me=remember_me)

        available_roles = await self._available_switch_roles(current_user.id, target_role)

        capabilities = None
        if target_role == "recruiter":
            capabilities = await self._recruiter_capabilities(current_user.id, current_user.email)

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "module": "authentication",
                "action": "role_switch",
                "detail": f"{current_user.role} -> {target_role}",
                "outcome": "success",
                "created_at": datetime.now(UTC),
            }
        )

        redirect_to = "/offer" if target_role == "candidate" else self.ROLE_REDIRECTS[target_role]

        return {
            "message": f"Switched to {target_role.replace('_', ' ').title()}.",
            "user": {
                "id": current_user.id,
                "full_name": profile["full_name"],
                "email": profile["email"],
                "phone": profile.get("phone"),
                "role": target_role,
                "job_title": profile.get("job_title"),
                "department": profile.get("department"),
                "employee_id": profile.get("employee_id"),
                "profile_picture": profile.get("profile_picture"),
                "available_roles": available_roles,
                "capabilities": capabilities,
            },
            "session": {
                "access_token": access_token,
                "refresh_token": refresh_token_str,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
                "remember_me": remember_me,
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
        remember_me = bool(stored.get("remember_me"))
        refresh_days = 30 if remember_me else 7

        new_access_token = create_access_token({"user_id": user_id, "email": email, "role": role})
        new_refresh_token = create_refresh_token(
            {"user_id": user_id, "email": email, "role": role},
            expires_days=refresh_days,
        )

        # Rotate: delete old, store new
        await database.refresh_tokens.delete_one({"token": refresh_token_str})
        await self._store_refresh_token(user_id, new_refresh_token, remember_me=remember_me)

        return {
            "message": "Session refreshed.",
            "session": {
                "access_token": new_access_token,
                "refresh_token": new_refresh_token,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
                "remember_me": remember_me,
            },
        }

    # ------------------------------------------------------------------ #
    # FORGOT PASSWORD                                                      #
    # ------------------------------------------------------------------ #

    async def forgot_password(self, email: str) -> dict:
        """Generate a password-reset OTP and send it by email.

        Works with either the personal email or an assigned company email —
        both resolve to the same account. The OTP is emailed to the personal
        email and, when assigned, the company email as well.
        """
        email = email.lower().strip()
        account_email = await self._resolve_account_email(email) or email
        user_doc = await self._find_user_doc_by_login_email(email)

        # Check if the user exists across all role collections
        user_exists = False
        if user_doc:
            for collection_name in ("recruiters", "candidates", "employees", "super_admins"):
                profile = await database[collection_name].find_one({"email": account_email})
                if profile and profile.get("status") == "active":
                    user_exists = True
                    await database.audit_logs.insert_one(
                        {
                            "user_id": profile.get("user_id"),
                            "email": account_email,
                            "role": profile.get("role"),
                            "module": "authentication",
                            "action": "password_reset_requested",
                            "outcome": "requested",
                            "created_at": datetime.now(UTC),
                        }
                    )
                    break

        # NOTE: Previously this endpoint always returned a generic message
        # regardless of whether the account existed, to avoid leaking
        # account existence (a common security best-practice). Per product
        # requirement, we now explicitly tell the user when no account
        # exists for the submitted email, so the frontend can show a
        # "no account found" notification instead of proceeding to the
        # reset-code screen.
        if not user_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account exists with this email address.",
            )

        now = datetime.now(UTC)

        # Simple resend cooldown: repeated requests inside the window skip
        # generating a new code so IT/attackers can't spam the inbox.
        existing = await database.otp_verifications.find_one(
            {"email": account_email, "purpose": "reset_password"},
            {"last_requested_at": 1},
        )
        if existing and existing.get("last_requested_at"):
            last = existing["last_requested_at"]
            if getattr(last, "tzinfo", None) is None:
                last = last.replace(tzinfo=UTC)
            if now - last < timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS):
                return {
                    "message": "A password reset code has been sent. Check your inbox and spam folder."
                }

        otp = _generate_otp()
        otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

        await database.otp_verifications.replace_one(
            {"email": account_email, "purpose": "reset_password"},
            {
                "email": account_email,
                "purpose": "reset_password",
                "otp": otp,
                "used": False,
                "attempts": 0,
                "expires_at": otp_expires_at,
                "last_requested_at": now,
                "created_at": now,
            },
            upsert=True,
        )

        try:
            for to_email in await self._notification_emails(account_email):
                email_service.send_forgot_password_otp(to_email, otp)
        except Exception:
            pass  # Best-effort; don't reveal failures

        return {
            "message": "A password reset code has been sent. Check your inbox and spam folder."
        }

    # ------------------------------------------------------------------ #
    # RESET PASSWORD                                                       #
    # ------------------------------------------------------------------ #

    async def reset_password(self, email: str, otp: str, password: str) -> dict:
        """Verify the reset OTP and update the user's password.

        The email may be the personal or the company email — both resolve to
        the same account, and the reset applies to that single account.
        """
        email = email.lower().strip()
        account_email = await self._resolve_account_email(email) or email

        otp_record = await database.otp_verifications.find_one(
            {"email": account_email, "purpose": "reset_password"}
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
            # Max 5 incorrect attempts — after that the code is invalidated
            # and the user must request a new one.
            new_attempts = (otp_record.get("attempts") or 0) + 1
            if new_attempts >= settings.OTP_MAX_ATTEMPTS:
                await database.otp_verifications.update_one(
                    {"_id": otp_record["_id"]},
                    {"$set": {"used": True, "attempts": new_attempts}},
                )
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many incorrect attempts. Please request a new code.",
                )
            await database.otp_verifications.update_one(
                {"_id": otp_record["_id"]},
                {"$set": {"attempts": new_attempts}},
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reset code. Please try again.",
            )

        # Update the password on the single canonical account
        new_hash = hash_password(password)
        result = await database.users.update_one(
            {"email": account_email},
            {"$set": {"password_hash": new_hash, "updated_at": datetime.now(UTC)}},
        )
        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found.",
            )

        # Invalidate the OTP and all existing refresh tokens
        await database.otp_verifications.update_one(
            {"email": account_email, "purpose": "reset_password"},
            {"$set": {"used": True}},
        )
        user_doc = await database.users.find_one({"email": account_email})
        if user_doc:
            await database.refresh_tokens.delete_many({"user_id": str(user_doc["_id"])})
            try:
                await create_notification(
                    recipient_id=str(user_doc["_id"]),
                    recipient_role=user_doc.get("role") or "employee",
                    notif_type="password_reset_completed",
                    title="Password reset completed",
                    message=(
                        "Your account password was reset. It now applies to both your "
                        "personal and company email sign-in."
                    ),
                    link="/login",
                )
            except Exception:
                pass
            try:
                for to_email in await self._notification_emails(account_email):
                    email_service.send_password_reset_completed(to_email, user_doc.get("full_name"))
            except Exception:
                pass  # Best-effort; don't reveal failures

        await database.audit_logs.insert_one(
            {
                "user_id": str(user_doc["_id"]) if user_doc else None,
                "email": account_email,
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
        """Allow authenticated users to change their own password.

        There is exactly ONE password for the account — it applies to both the
        personal email and the company email login.
        """
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
            {
                "$set": {
                    "password_hash": new_hash,
                    "must_change_password": False,
                    "updated_at": datetime.now(UTC),
                }
            },
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

        # Notify the user in-app and by email (personal + company email).
        try:
            await create_notification(
                recipient_id=current_user.id,
                recipient_role=current_user.role
                if current_user.role in ("employee", "recruiter", "candidate", "super_admin")
                else "employee",
                notif_type="password_changed",
                title="Password changed",
                message=(
                    "Your account password was updated. It applies to both your "
                    "personal and company email sign-in."
                ),
                link="/dashboard/employee/profile" if current_user.role == "employee" else None,
            )
        except Exception:
            pass  # Best-effort; the password change itself already succeeded
        try:
            for to_email in await self._notification_emails(current_user.email):
                email_service.send_password_changed_notification(to_email, current_user.full_name)
        except Exception:
            pass  # Best-effort

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

    async def _find_user_doc_by_login_email(self, email: str) -> dict | None:
        """Resolve the canonical users document from either the personal email
        or an employee's assigned company email.

        Both login emails map to the SAME account — a company email lookup
        follows the employee profile's user_id back to the existing user doc,
        so no second account is ever created.
        """
        email = (email or "").strip().lower()
        if not email:
            return None

        user_doc = await database.users.find_one({"email": email})
        if user_doc:
            return user_doc

        # Company-email alias login only works for active tenures: once an
        # employee is offboarded (history_bucket = historical, status
        # resigned/terminated/exited) the company email stops resolving, so
        # the mailbox cannot be reused to access their old account. The
        # personal-email login is governed by the user account itself.
        employee = await database.employees.find_one(
            {
                "company_email": email,
                "history_bucket": {"$ne": "historical"},
                "status": {"$nin": ["resigned", "terminated", "exited"]},
            },
            {"user_id": 1, "email": 1},
        )
        if not employee or not employee.get("user_id"):
            return None
        user_id = employee["user_id"]
        if ObjectId.is_valid(user_id):
            return await database.users.find_one({"_id": ObjectId(user_id)})
        return await database.users.find_one({"email": user_id})

    async def _resolve_account_email(self, email: str) -> str | None:
        """Return the canonical personal email for a login email (personal or
        company). None if the email matches no account."""
        user_doc = await self._find_user_doc_by_login_email(email)
        return user_doc["email"] if user_doc else None

    async def _notification_emails(self, account_email: str) -> list[str]:
        """Recipients for account emails: always the personal email, plus the
        company email when one has been assigned."""
        emails = [account_email]
        employee = await database.employees.find_one(
            {"email": (account_email or "").lower()},
            {"company_email": 1},
        )
        if employee and employee.get("company_email"):
            emails.append(employee["company_email"])
        return unique_emails(*emails)

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

    async def _auto_detect_role(self, user_id: str) -> str | None:
        """Return the first active role profile this account holds.

        Priority: candidate → employee → recruiter → super_admin. A converted
        candidate has a non-active ("converted") candidate profile, so they
        fall through to their active employee profile and land on the
        employee dashboard.
        """
        for role_name in self.ROLE_DETECT_ORDER:
            profile = await self._resolve_role_profile(user_id, role_name)
            if profile:
                return role_name
        return None

    async def _store_refresh_token(self, user_id: str, token: str, remember_me: bool = False) -> None:
        days = 30 if remember_me else 7
        await database.refresh_tokens.insert_one(
            {
                "user_id": user_id,
                "token": token,
                "remember_me": remember_me,
                "expires_at": datetime.now(UTC) + timedelta(days=days),
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

    async def _activate_invited_recruiter(self, pending: dict, extra: dict, email: str, now) -> dict:
        """Activate an invited recruiter — creates employee + recruiter profiles, issues employee session."""
        from bson import ObjectId

        # Create user credentials with "employee" as default role
        user_doc = {
            "email": email,
            "password_hash": pending["password_hash"],
            "role": "employee",
            "status": "active",
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

        # Generate employee ID
        from app.services.employee_service import EmployeeService
        emp_service = EmployeeService()
        emp_id_result = await emp_service.generate_employee_id(allocate=True)
        employee_id = emp_id_result["employee_id"]

        # Create employee profile
        employee_doc = {
            "user_id": user_id,
            "employee_id": employee_id,
            "full_name": pending["full_name"],
            "email": email,
            "phone": pending.get("phone"),
            "role": "employee",
            "status": "active",
            "job_title": extra.get("job_title"),
            "department": extra.get("department"),
            "office_location": extra.get("office_location"),
            "is_remote": bool(extra.get("is_remote")),
            "organization_id": extra.get("organization_id"),
            "start_date": extra.get("start_date"),
            "history_bucket": "active",
            "cycle_group_key": email,
            "onboarding": {},
            "profile_status": "complete",
            "profile_completed_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await database.employees.insert_one(employee_doc)

        # Create recruiter profile
        capabilities = extra.get("capabilities") or {}
        recruiter_doc = {
            "user_id": user_id,
            "full_name": pending["full_name"],
            "email": email,
            "phone": pending.get("phone"),
            "role": "recruiter",
            "status": "active",
            "job_title": extra.get("job_title"),
            "department": extra.get("department"),
            "office_location": extra.get("office_location"),
            "organization_id": extra.get("organization_id"),
            "capabilities": capabilities,
            "email_verified_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await database.recruiters.insert_one(recruiter_doc)

        # Mark invitation used
        invite_token = extra.get("invitation_token")
        if invite_token:
            await database.invitations.update_one(
                {"token": invite_token},
                {"$set": {"status": "used", "used_at": now, "updated_at": now}},
            )

        # Remove pending record
        await database.pending_users.delete_one({"email": email})

        # Audit log
        await self._create_audit_log(user_id, email, "recruiter_email_verified", "success")

        # Issue JWT with role "employee" (default dashboard)
        available_roles = await self._available_switch_roles(user_id, "employee")
        access_token = create_access_token({"user_id": user_id, "email": email, "role": "employee"})
        refresh_token_str = create_refresh_token({"user_id": user_id, "email": email, "role": "employee"})
        await self._store_refresh_token(user_id, refresh_token_str)

        return {
            "message": "Your email has been verified. Welcome to TalentAI!",
            "already_verified": False,
            "role": "employee",
            "redirect_to": "/dashboard/employee",
            "user": {
                "id": user_id,
                "full_name": pending["full_name"],
                "email": email,
                "phone": pending.get("phone"),
                "role": "employee",
                "job_title": extra.get("job_title"),
                "department": extra.get("department"),
                "employee_id": employee_id,
                "available_roles": available_roles,
                "capabilities": capabilities,
            },
            "session": {
                "access_token": access_token,
                "refresh_token": refresh_token_str,
                "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
                "token_type": "bearer",
            },
        }