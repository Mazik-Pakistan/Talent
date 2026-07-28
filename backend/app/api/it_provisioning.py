from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import require_roles
from app.schemas.it_provisioning import (
    BulkRemindItProvisioningRequest,
    BulkSendItProvisioningRequest,
    ItProvisioningSubmitRequest,
    RemindItProvisioningRequest,
    RevealCompanyEmailPasswordRequest,
    SendItProvisioningRequest,
)
from app.services.it_provisioning_service import it_provisioning_service

router = APIRouter(prefix="/api/it-provisioning", tags=["IT Provisioning"])

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]


@router.post("/send")
async def send_it_provisioning(request: SendItProvisioningRequest, current_user: RequireRecruiter):
    """Recruiter emails IT a public form link to assign company email + assets before activation."""
    return await it_provisioning_service.send_request(current_user, request)


@router.post("/remind")
async def remind_it_provisioning(request: RemindItProvisioningRequest, current_user: RequireRecruiter):
    """Follow-up email to IT while provisioning is still pending."""
    return await it_provisioning_service.remind(current_user, request)


@router.post("/bulk-send")
async def bulk_send_it_provisioning(request: BulkSendItProvisioningRequest, current_user: RequireRecruiter):
    """Send IT provisioning emails for many signed offers at once."""
    return await it_provisioning_service.bulk_send(current_user, request)


@router.post("/bulk-remind")
async def bulk_remind_it_provisioning(request: BulkRemindItProvisioningRequest, current_user: RequireRecruiter):
    """Follow up IT for many pending provisioning requests at once."""
    return await it_provisioning_service.bulk_remind(current_user, request)


@router.get("/{token}")
async def get_it_provisioning_public(token: str):
    """Public: load employee context for the IT form."""
    return await it_provisioning_service.get_public(token)


@router.post("/{token}/submit")
async def submit_it_provisioning_public(token: str, request: ItProvisioningSubmitRequest):
    """Public: IT submits company email, password, assets, and licenses."""
    return await it_provisioning_service.submit_public(token, request)
