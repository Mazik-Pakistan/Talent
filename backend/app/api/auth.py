from fastapi import APIRouter
from app.schemas.auth import RegisterRequest
from app.services.auth_service import AuthService

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

service = AuthService()


@router.post("/register")
def register(request: RegisterRequest):

    result = service.register(request)

    return {
        "message": "Registration Successful. Please verify your email.",
        "data": result.user
    }


@router.get("/verify-status")
def verify_status(token: str):

    user = service.verify_status(token)

    return user