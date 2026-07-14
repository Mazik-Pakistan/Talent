from fastapi import APIRouter

from app.schemas.auth import RegisterRequest, VerifyEmailRequest
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
service = AuthService()


@router.post("/register", status_code=201)
async def register(request: RegisterRequest):
    return await service.register(request)


@router.post("/verify-email")
async def verify_email(request: VerifyEmailRequest):
    return await service.verify_email(request.access_token)
