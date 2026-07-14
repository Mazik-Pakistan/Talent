from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.invitation import CreateInvitationRequest
from app.services.invitation_service import InvitationService

router = APIRouter(prefix="/api/invitations", tags=["Invitations"])
service = InvitationService()


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return authorization.removeprefix("Bearer ").strip()


@router.post("", status_code=201)
async def create_invitation(
    request: CreateInvitationRequest,
    authorization: str | None = Header(default=None),
):
    """US-010 prerequisite: recruiter creates an invitation after offer acceptance."""
    access_token = _extract_bearer_token(authorization)
    return await service.create_invitation(request, access_token)


@router.get("/{token}")
async def get_invitation(token: str):
    """Validate invitation token for candidate registration."""
    return await service.get_invitation(token)
