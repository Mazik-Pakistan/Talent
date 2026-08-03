from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import require_capabilities, require_roles
from app.schemas.it_service_request import (
    ItServiceRequestCancelRequest,
    ItServiceRequestCreate,
    ItServiceRequestEmployeeCreate,
    ItServiceRequestFulfillRequest,
    ItServiceRequestSendRequest,
)
from app.services.it_service_request_service import it_service_request_service

router = APIRouter(prefix="/api/it-service-requests", tags=["IT Service Requests"])

RequireRecruiterWithIT = Annotated[CurrentUser, Depends(require_capabilities("it"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]


@router.get("/officers/overview")
async def it_officers_overview(current_user: RequireRecruiterWithIT):
    """Every IT officer this recruiter has worked with + the people they provisioned."""
    return await it_service_request_service.officers_overview(current_user)


@router.get("")
async def list_it_service_requests(current_user: RequireRecruiterWithIT, status: str | None = None):
    return await it_service_request_service.list_recruiter(current_user, status)


@router.post("")
async def create_it_service_request(request: ItServiceRequestCreate, current_user: RequireRecruiterWithIT):
    return await it_service_request_service.create_for_employee(current_user, request)


@router.post("/send")
async def send_it_service_request(request: ItServiceRequestSendRequest, current_user: RequireRecruiterWithIT):
    return await it_service_request_service.send_to_it(current_user, request)


@router.post("/{request_id}/cancel")
async def cancel_it_service_request(
    request_id: str, request: ItServiceRequestCancelRequest, current_user: RequireRecruiterWithIT
):
    return await it_service_request_service.cancel(current_user, request_id, request.reason)


@router.get("/me")
async def list_my_it_service_requests(current_user: RequireEmployee):
    return await it_service_request_service.list_employee(current_user)


@router.post("/me")
async def create_my_it_service_request(request: ItServiceRequestEmployeeCreate, current_user: RequireEmployee):
    return await it_service_request_service.create_employee_draft(current_user, request)


@router.post("/me/{request_id}/close")
async def close_my_it_service_request(request_id: str, current_user: RequireEmployee):
    """Employee confirms IT resolved the issue and closes the ticket."""
    return await it_service_request_service.close_by_employee(current_user, request_id)


@router.get("/public/{token}")
async def get_it_service_request_public(token: str):
    return await it_service_request_service.get_public(token)


@router.post("/public/{token}/fulfill")
async def fulfill_it_service_request_public(token: str, request: ItServiceRequestFulfillRequest):
    return await it_service_request_service.fulfill_public(token, request)
