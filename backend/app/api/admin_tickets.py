from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile

from app.core.rbac import CurrentUser
from app.core.security import require_roles
from app.schemas.ticket import (
    TicketAssignRequest,
    TicketMergeRequest,
    TicketPriorityUpdateRequest,
    TicketReplyRequest,
    TicketStatusUpdateRequest,
    TicketUpdateRequest,
)
from app.services.ticket_service import ticket_service

router = APIRouter(prefix="/api/admin/tickets", tags=["Admin Support Tickets"])

RequireSuperAdmin = Annotated[CurrentUser, Depends(require_roles("super_admin"))]


@router.get("")
async def list_all_tickets(
    current_user: RequireSuperAdmin,
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    category: str | None = Query(default=None),
    assigned_to: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None),
    sort: str = Query(default="-created_at"),
):
    return await ticket_service.list_all_tickets(
        current_user,
        status=status,
        priority=priority,
        category=category,
        assigned_to=assigned_to,
        organization_id=organization_id,
        page=page,
        page_size=page_size,
        search=search,
        sort=sort,
    )


@router.get("/stats")
async def get_ticket_stats(current_user: RequireSuperAdmin):
    return await ticket_service.get_ticket_stats(current_user)


@router.get("/export")
async def export_tickets(
    current_user: RequireSuperAdmin,
    format: str = Query(default="csv"),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
):
    result = await ticket_service.export_tickets(current_user, format=format, status=status, priority=priority)
    return Response(
        content=result["content"],
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'},
    )


@router.get("/{ticket_id}")
async def get_ticket_admin(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.get_ticket_admin(current_user, ticket_id)


@router.patch("/{ticket_id}")
async def update_ticket(ticket_id: str, request: TicketUpdateRequest, current_user: RequireSuperAdmin):
    return await ticket_service.update_ticket(current_user, ticket_id, request, is_admin=True)


@router.post("/{ticket_id}/assign")
async def assign_ticket(ticket_id: str, request: TicketAssignRequest, current_user: RequireSuperAdmin):
    return await ticket_service.assign_ticket(current_user, ticket_id, request)


@router.patch("/{ticket_id}/status")
async def update_status(ticket_id: str, request: TicketStatusUpdateRequest, current_user: RequireSuperAdmin):
    return await ticket_service.update_status(current_user, ticket_id, request)


@router.patch("/{ticket_id}/priority")
async def update_priority(ticket_id: str, request: TicketPriorityUpdateRequest, current_user: RequireSuperAdmin):
    return await ticket_service.update_priority(current_user, ticket_id, request)


@router.post("/{ticket_id}/reply")
async def reply_to_ticket_admin(ticket_id: str, request: TicketReplyRequest, current_user: RequireSuperAdmin):
    return await ticket_service.reply_to_ticket_admin(current_user, ticket_id, request)


@router.post("/{ticket_id}/close")
async def close_ticket_admin(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.close_ticket_admin(current_user, ticket_id)


@router.post("/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.resolve_ticket(current_user, ticket_id)


@router.post("/{ticket_id}/reopen")
async def reopen_ticket(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.reopen_ticket(current_user, ticket_id)


@router.post("/{ticket_id}/delete")
async def delete_ticket(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.delete_ticket(current_user, ticket_id)


@router.post("/{ticket_id}/merge")
async def merge_tickets(ticket_id: str, request: TicketMergeRequest, current_user: RequireSuperAdmin):
    return await ticket_service.merge_tickets(current_user, ticket_id, request)


@router.post("/{ticket_id}/upload")
async def upload_ticket_attachment(ticket_id: str, current_user: RequireSuperAdmin, file: UploadFile = File(...)):
    content = await file.read()
    return await ticket_service.upload_attachment(
        current_user, ticket_id, filename=file.filename or "attachment", content=content, is_admin=True
    )


@router.get("/{ticket_id}/activity")
async def get_ticket_activity(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.get_activity(current_user, ticket_id)


@router.get("/{ticket_id}/audit")
async def get_ticket_audit(ticket_id: str, current_user: RequireSuperAdmin):
    return await ticket_service.get_audit_logs(current_user, ticket_id)
