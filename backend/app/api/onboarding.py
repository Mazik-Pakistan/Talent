from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import require_permissions
from app.schemas.invitation import OnboardingSaveRequest
from app.services.candidate_service import CandidateService

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])
service = CandidateService()


@router.get("")
async def get_onboarding(
    current_user: Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))],
):
    """US-012: personal onboarding for Candidate/Employee (and Super Admin via all perms)."""
    return await service.get_onboarding(current_user.access_token)


@router.put("")
async def save_onboarding(
    request: OnboardingSaveRequest,
    current_user: Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))],
):
    return await service.save_onboarding(current_user.access_token, request)
