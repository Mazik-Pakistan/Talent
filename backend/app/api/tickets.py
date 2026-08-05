from fastapi import APIRouter, File, Query, UploadFile

from app.core.security import RequireRecruiter
from app.schemas.ticket import TicketCreateRequest, TicketReplyRequest, TicketUpdateRequest
from app.services.ticket_service import ticket_service

router = APIRouter(prefix="/api/tickets", tags=["Support Tickets"])


@router.post("", status_code=201)
async def create_ticket(request: TicketCreateRequest, current_user: RequireRecruiter):
    return await ticket_service.create_ticket(current_user, request)


@router.get("")
async def list_my_tickets(
    current_user: RequireRecruiter,
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    category: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None),
):
    return await ticket_service.list_my_tickets(
        current_user,
        status=status,
        priority=priority,
        category=category,
        page=page,
        page_size=page_size,
        search=search,
    )


@router.get("/stats/my")
async def my_ticket_stats(current_user: RequireRecruiter):
    return await ticket_service.my_ticket_stats(current_user)


@router.get("/{ticket_id}")
async def get_ticket(ticket_id: str, current_user: RequireRecruiter):
    return await ticket_service.get_ticket(current_user, ticket_id)


@router.patch("/{ticket_id}")
async def update_ticket(ticket_id: str, request: TicketUpdateRequest, current_user: RequireRecruiter):
    return await ticket_service.update_ticket(current_user, ticket_id, request)


@router.post("/{ticket_id}/reply")
async def reply_to_ticket(ticket_id: str, request: TicketReplyRequest, current_user: RequireRecruiter):
    return await ticket_service.reply_to_ticket(current_user, ticket_id, request)


@router.post("/{ticket_id}/close")
async def close_ticket(ticket_id: str, current_user: RequireRecruiter):
    return await ticket_service.close_ticket(current_user, ticket_id)


@router.post("/{ticket_id}/upload")
async def upload_ticket_attachment(ticket_id: str, current_user: RequireRecruiter, file: UploadFile = File(...)):
    content = await file.read()
    return await ticket_service.upload_attachment(
        current_user, ticket_id, filename=file.filename or "attachment", content=content
    )
