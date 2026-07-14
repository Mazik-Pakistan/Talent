from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.invitation import OnboardingSaveRequest
from app.services.candidate_service import CandidateService

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])
service = CandidateService()


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return authorization.removeprefix("Bearer ").strip()


@router.get("")
async def get_onboarding(authorization: str | None = Header(default=None)):
    access_token = _extract_bearer_token(authorization)
    return await service.get_onboarding(access_token)


@router.put("")
async def save_onboarding(
    request: OnboardingSaveRequest,
    authorization: str | None = Header(default=None),
):
    access_token = _extract_bearer_token(authorization)
    return await service.save_onboarding(access_token, request)
