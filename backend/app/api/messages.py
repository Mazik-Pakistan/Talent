"""Employee ↔ recruiter messaging API."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.core.rbac import CurrentUser
from app.core.security import RequireAny, RequireEmployee, RequireRecruiter, require_capabilities, require_roles
from app.services.message_service import message_service

router = APIRouter(prefix="/api/messages", tags=["Messages"])

RequireRecruiterWithMessages = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("messages")),
]


@router.get("")
async def list_threads(current_user: RequireAny):
    if current_user.role in ("recruiter", "super_admin"):
        # Check capability for recruiters
        if current_user.role == "recruiter" and not current_user.has_capability("messages"):
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to messaging features."
            )
        return await message_service.list_threads_for_recruiter(current_user)
    return await message_service.list_threads_for_employee(current_user)


@router.get("/{thread_id}")
async def get_thread(thread_id: str, current_user: RequireAny):
    if current_user.role in ("recruiter", "super_admin"):
        if current_user.role == "recruiter" and not current_user.has_capability("messages"):
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to messaging features."
            )
    return await message_service.get_thread(current_user, thread_id)


@router.post("", status_code=201)
async def employee_send_message(current_user: RequireEmployee, payload: dict = Body(...)):
    """Employee starts or replies to an HR conversation."""
    body = payload if isinstance(payload, dict) else {}
    return await message_service.employee_send(
        current_user,
        body=body.get("body") or "",
        subject=body.get("subject"),
        thread_id=body.get("thread_id"),
    )


@router.post("/start", status_code=201)
async def recruiter_start_message(current_user: RequireRecruiterWithMessages, payload: dict = Body(...)):
    """Recruiter starts (or continues) a conversation with an employee."""
    body = payload if isinstance(payload, dict) else {}
    return await message_service.recruiter_start(
        current_user,
        employee_id=body.get("employee_id") or "",
        body=body.get("body") or "",
        subject=body.get("subject"),
    )


@router.post("/{thread_id}/reply", status_code=201)
async def recruiter_reply(thread_id: str, current_user: RequireRecruiterWithMessages, payload: dict = Body(...)):
    body = payload if isinstance(payload, dict) else {}
    return await message_service.recruiter_reply(current_user, thread_id, body=body.get("body") or "")


@router.post("/{thread_id}/close")
async def close_thread(thread_id: str, current_user: RequireAny):
    if current_user.role in ("recruiter", "super_admin"):
        if current_user.role == "recruiter" and not current_user.has_capability("messages"):
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to messaging features."
            )
    return await message_service.close_thread(current_user, thread_id)
