from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import require_permissions
from app.schemas.invitation import CreateInvitationRequest
from app.services.invitation_service import InvitationService

router = APIRouter(prefix="/api/invitations", tags=["Invitations"])
service = InvitationService()


@router.post("", status_code=201)
async def create_invitation(
    request: CreateInvitationRequest,
    current_user: Annotated[CurrentUser, Depends(require_permissions("recruitment.invite"))],
):
    """US-010 + US-012: only roles with recruitment.invite may create invitations."""
    return await service.create_invitation(request, current_user)


@router.get("/{token}")
async def get_invitation(token: str):
    """Public: validate invitation token for candidate registration."""
    return await service.get_invitation(token)
