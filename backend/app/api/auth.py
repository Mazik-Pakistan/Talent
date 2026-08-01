from fastapi import APIRouter

from app.core.security import RequireUser
from app.schemas.auth import (
    BootstrapSuperAdminRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResendOTPRequest,
    ResetPasswordRequest,
    SwitchRoleRequest,
    VerifyEmailRequest,
    VerifyOTPRequest,
)
from app.schemas.invitation import CandidateRegisterRequest
from app.services.auth_service import AuthService
from app.services.candidate_service import CandidateService

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
service = AuthService()
candidate_service = CandidateService()


# ---------- Signup ----------

@router.post("/register", status_code=201)
async def register(request: RegisterRequest):
    """Step 1: Register recruiter — stores pending user and sends OTP email."""
    return await service.register(request)


@router.post("/candidate/register", status_code=201)
async def candidate_register(request: CandidateRegisterRequest):
    """US-010: Candidate registers via recruiter invitation link — sends OTP email."""
    return await candidate_service.register(request)


@router.post("/switch-role")
async def switch_role(request: SwitchRoleRequest, current_user: RequireUser):
    """Dual-role accounts only (e.g. an employee who is also a recruiter):
    re-authenticate the current session under the other role, without
    re-entering credentials."""
    return await service.switch_role(current_user, request.role)


@router.post("/bootstrap-super-admin", status_code=201)
async def bootstrap_super_admin(request: BootstrapSuperAdminRequest):
    """Create the first super admin when none exists yet — sends OTP email."""
    return await service.bootstrap_super_admin(request)


# ---------- OTP Verification ----------

@router.post("/verify-otp")
async def verify_otp(request: VerifyOTPRequest):
    """Step 2: Submit 6-digit OTP to activate the account."""
    return await service.verify_otp(request.email, request.otp)


@router.post("/verify-email")
async def verify_email(request: VerifyEmailRequest):
    """
    Backward-compatible endpoint:
    - New flow: accepts {email, otp}
    - Legacy flow: accepts {access_token} (no longer used, returns helpful error)
    """
    if request.email and request.otp:
        return await service.verify_otp(request.email, request.otp)
    # Legacy token-based flow is no longer supported
    from fastapi import HTTPException, status
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Please provide email and otp to verify your account.",
    )


@router.post("/resend-otp")
async def resend_otp(request: ResendOTPRequest):
    """Resend a fresh OTP to the pending user's email."""
    return await service.resend_otp(request.email)


@router.post("/resend-verification")
async def resend_verification(request: ResendOTPRequest):
    """Backward-compatible alias for resend-otp."""
    return await service.resend_otp(request.email)


# ---------- Login ----------

@router.post("/login")
async def login(request: LoginRequest):
    return await service.login(request)


@router.post("/refresh")
async def refresh(request: RefreshRequest):
    return await service.refresh_token(request.refresh_token)


# ---------- Forgot / Reset Password ----------

@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    return await service.forgot_password(request.email)


@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    """Verify OTP and set a new password in one step."""
    return await service.reset_password(request.email, request.otp, request.password)


# ---------- Change Password (authenticated) ----------

@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, current_user: RequireUser):
    return await service.change_password(
        current_user, request.current_password, request.new_password
    )


# ---------- Logout ----------

@router.post("/logout")
async def logout(current_user: RequireUser):
    """Destroy the session server-side, revoke refresh tokens, and audit."""
    return await service.logout(current_user)