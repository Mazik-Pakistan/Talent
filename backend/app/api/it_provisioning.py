from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import RequireEmployee, RequireRecruiter, require_capabilities
from app.schemas.it_provisioning import (
    BulkRemindItProvisioningRequest,
    BulkSendItProvisioningRequest,
    ItKitCreateRequest,
    ItKitUpdateRequest,
    ItProvisioningBatchSubmitRequest,
    ItProvisioningSubmitRequest,
    RemindItProvisioningRequest,
    RevealCompanyEmailPasswordRequest,
    SendItProvisioningRequest,
)
from app.services.it_provisioning_service import it_provisioning_service
from app.services.it_kit_service import it_kit_service

router = APIRouter(prefix="/api/it-provisioning", tags=["IT Provisioning"])

RequireRecruiterWithIT = Annotated[CurrentUser, Depends(require_capabilities("it"))]


@router.get("/kits")
async def list_it_kits(current_user: RequireRecruiterWithIT):
    """Reusable standard IT setups (assets + licenses) for provisioning."""
    return await it_kit_service.list_kits(current_user)


@router.post("/kits")
async def create_it_kit(request: ItKitCreateRequest, current_user: RequireRecruiterWithIT):
    return await it_kit_service.create_kit(current_user, request)


@router.patch("/kits/{kit_id}")
async def update_it_kit(kit_id: str, request: ItKitUpdateRequest, current_user: RequireRecruiterWithIT):
    return await it_kit_service.update_kit(current_user, kit_id, request)


@router.delete("/kits/{kit_id}")
async def delete_it_kit(kit_id: str, current_user: RequireRecruiterWithIT):
    return await it_kit_service.delete_kit(current_user, kit_id)


@router.post("/send")
async def send_it_provisioning(request: SendItProvisioningRequest, current_user: RequireRecruiterWithIT):
    """Recruiter emails IT a public form link to assign company email + assets before activation."""
    return await it_provisioning_service.send_request(current_user, request)


@router.post("/remind")
async def remind_it_provisioning(request: RemindItProvisioningRequest, current_user: RequireRecruiterWithIT):
    """Follow-up email to IT while provisioning is still pending."""
    return await it_provisioning_service.remind(current_user, request)


@router.post("/bulk-send")
async def bulk_send_it_provisioning(request: BulkSendItProvisioningRequest, current_user: RequireRecruiterWithIT):
    """Send IT provisioning emails for many signed offers at once."""
    return await it_provisioning_service.bulk_send(current_user, request)


@router.post("/bulk-remind")
async def bulk_remind_it_provisioning(request: BulkRemindItProvisioningRequest, current_user: RequireRecruiterWithIT):
    """Follow up IT for many pending provisioning requests at once."""
    return await it_provisioning_service.bulk_remind(current_user, request)


@router.get("/batch/{token}")
async def get_it_provisioning_batch_public(token: str):
    """Public: load the bulk IT form (roster + available kits)."""
    return await it_provisioning_service.get_batch_public(token)


@router.post("/batch/{token}/submit")
async def submit_it_provisioning_batch_public(token: str, request: ItProvisioningBatchSubmitRequest):
    """Public: IT provisions the whole batch in one submit."""
    return await it_provisioning_service.submit_batch_public(token, request)


@router.get("/candidate/{candidate_id}")
async def get_it_provisioning_for_candidate(candidate_id: str, current_user: RequireRecruiter):
    """Recruiter: provisioning history for one candidate (officer, status, submitted details)."""
    return await it_provisioning_service.get_for_candidate(candidate_id)


@router.get("/{token}")
async def get_it_provisioning_public(token: str):
    """Public: load employee context for the IT form."""
    return await it_provisioning_service.get_public(token)


@router.post("/{token}/submit")
async def submit_it_provisioning_public(token: str, request: ItProvisioningSubmitRequest):
    """Public: IT submits company email, assets, and licenses."""
    return await it_provisioning_service.submit_public(token, request)


@router.post("/{token}/edit")
async def edit_it_provisioning_public(token: str, request: ItProvisioningSubmitRequest):
    """Public: IT corrects a submitted provisioning request before activation."""
    return await it_provisioning_service.edit_public(token, request)


@router.post("/{token}/reset-password")
async def reset_it_provisioning_password_public(token: str):
    """Public: IT resets the linked employee's account password via the provisioning link."""
    return await it_provisioning_service.reset_password_public(token)
