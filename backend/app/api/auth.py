from fastapi import APIRouter

from app.schemas.auth import (
    RegisterRequest,
    VerifyEmailRequest,
    ResendVerificationRequest,
    LoginRequest,
    RefreshRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    BootstrapSuperAdminRequest,
)
from app.schemas.invitation import CandidateRegisterRequest
from app.services.auth_service import AuthService
from app.services.candidate_service import CandidateService

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
service = AuthService()
candidate_service = CandidateService()


@router.post("/register", status_code=201)
async def register(request: RegisterRequest):
    return await service.register(request)


@router.post("/candidate/register", status_code=201)
async def candidate_register(request: CandidateRegisterRequest):
    """US-010: Candidate registers via recruiter invitation link."""
    return await candidate_service.register(request)


@router.post("/bootstrap-super-admin", status_code=201)
async def bootstrap_super_admin(request: BootstrapSuperAdminRequest):
    """Create the first super admin when none exists yet."""
    return await service.bootstrap_super_admin(request)


@router.post("/verify-email")
async def verify_email(request: VerifyEmailRequest):
    return await service.verify_email(request.access_token)


# ----- US-003 -----
@router.post("/resend-verification")
async def resend_verification(request: ResendVerificationRequest):
    return await service.resend_verification(request.email)


# ----- US-004 / US-005 -----
@router.post("/login")
async def login(request: LoginRequest):
    return await service.login(request)


@router.post("/refresh")
async def refresh(request: RefreshRequest):
    return await service.refresh_token(request.refresh_token)


# ----- US-006 -----
@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    return await service.forgot_password(request.email)


@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    return await service.reset_password(request.access_token, request.refresh_token, request.password)