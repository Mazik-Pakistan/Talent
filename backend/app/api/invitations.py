from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.rbac import CurrentUser
from app.core.security import require_permissions, require_capabilities
from app.schemas.invitation import CreateInvitationRequest
from app.services.bulk_invite_service import bulk_invite_service
from app.services.invitation_service import InvitationService
from app.services.spreadsheet_roster import build_xlsx_template_bytes

router = APIRouter(prefix="/api/invitations", tags=["Invitations"])
service = InvitationService()

# Use capability check for recruiters, permission check for super admin
RequireInvite = Annotated[CurrentUser, Depends(require_capabilities("invite"))]


class BulkInviteSendRequest(BaseModel):
    candidates: list[dict] = Field(default_factory=list, max_length=200)


@router.post("", status_code=201)
async def create_invitation(
    request: CreateInvitationRequest,
    current_user: RequireInvite,
):
    """US-010 + US-012: only roles with recruitment.invite may create invitations."""
    return await service.create_invitation(request, current_user)


@router.get("/bulk/template")
async def download_bulk_invite_template(current_user: RequireInvite):
    """Download an .xlsx template with required offer + invite columns."""
    _ = current_user
    content = build_xlsx_template_bytes()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="bulk-invite-template.xlsx"'},
    )


@router.post("/bulk/preview")
async def preview_bulk_invitations(
    current_user: RequireInvite,
    file: UploadFile = File(...),
):
    """Parse spreadsheet and attach person-history / conflict checks per row (no emails sent)."""
    return await bulk_invite_service.preview(file, current_user)


@router.post("/bulk/send")
async def send_bulk_invitations(
    request: BulkInviteSendRequest,
    current_user: RequireInvite,
):
    """Send offer invitations for reviewed roster rows (same flow as single invite)."""
    return await bulk_invite_service.send_rows(current_user, request.candidates)


@router.get("/{token}")
async def get_invitation(token: str):
    """Public: validate invitation token for candidate registration."""
    return await service.get_invitation(token)
