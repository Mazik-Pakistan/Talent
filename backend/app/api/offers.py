from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.rbac import CurrentUser
from app.core.security import RequireRecruiter, require_roles, require_capabilities
from app.schemas.offer import (
    NegotiationRespondRequest,
    OfferApproveRequest,
    OfferCreateRequest,
    OfferDeclineRequest,
    OfferEditResendRequest,
    OfferExtendValidityRequest,
    OfferNegotiateRequest,
    OfferSignRequest,
)
from app.services.offer_service import offer_service
from app.services import storage_service

router = APIRouter(prefix="/api/offers", tags=["Offers"])

# Note: this role set ("candidate", "super_admin") is specific to offers and
# differs from the "onboarding.self"-permission-based RequireCandidate used
# in employees.py, so it stays local rather than being centralized.
RequireCandidate = Annotated[CurrentUser, Depends(require_roles("candidate", "super_admin"))]
RequireRecruiterWithInvite = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("invite")),
]


@router.post("", status_code=201)
async def create_offer(payload: OfferCreateRequest, current_user: RequireRecruiterWithInvite):
    """Resend / legacy: send offer to an existing candidate account."""
    return await offer_service.create_and_send(current_user, payload)


@router.get("/me")
async def get_my_offer(current_user: RequireCandidate):
    """Candidate's most recent offer letter (auto-marks as viewed)."""
    return await offer_service.get_mine(current_user)


@router.get("/negotiations/pending")
async def list_pending_negotiations(current_user: RequireRecruiterWithInvite):
    return await offer_service.list_pending_negotiations(current_user)


@router.get("/awaiting-response")
async def list_awaiting_offer_response(current_user: RequireRecruiterWithInvite):
    return await offer_service.list_awaiting_offer_response(current_user)


@router.get("/candidate/{candidate_id}")
async def list_offers_for_candidate(candidate_id: str, current_user: RequireRecruiterWithInvite):
    return await offer_service.list_for_candidate(current_user, candidate_id)


@router.post("/{offer_id}/sign")
async def sign_offer(offer_id: str, payload: OfferSignRequest, current_user: RequireCandidate):
    """Candidate digitally signs the offer letter (pad or uploaded signature)."""
    return await offer_service.sign(current_user, offer_id, payload)


@router.post("/{offer_id}/signature-upload")
async def upload_offer_signature(
    offer_id: str,
    current_user: RequireCandidate,
    file: UploadFile = File(...),
):
    """Upload a signature image/PDF; returns a URL to pass into /sign."""
    offer = await offer_service._find(offer_id)
    offer_service._assert_owner(current_user, offer)
    content = await file.read()
    if not content:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Empty file.")
    filename = file.filename or "signature.png"
    stored = await storage_service.save_file(current_user.id, "signatures", filename, content)
    return {
        "message": "Signature uploaded.",
        "signature_upload_url": stored.get("file_url"),
        "object_path": stored.get("object_path"),
    }


@router.post("/{offer_id}/decline")
async def decline_offer(offer_id: str, payload: OfferDeclineRequest, current_user: RequireCandidate):
    return await offer_service.decline(current_user, offer_id, payload)


@router.post("/{offer_id}/negotiate")
async def negotiate_offer(offer_id: str, payload: OfferNegotiateRequest, current_user: RequireCandidate):
    return await offer_service.negotiate(current_user, offer_id, payload)


@router.post("/{offer_id}/negotiation/accept")
async def accept_negotiation(
    offer_id: str, payload: NegotiationRespondRequest, current_user: RequireRecruiterWithInvite
):
    return await offer_service.accept_negotiation(current_user, offer_id, payload)


@router.post("/{offer_id}/negotiation/reject")
async def reject_negotiation(
    offer_id: str, payload: NegotiationRespondRequest, current_user: RequireRecruiterWithInvite
):
    return await offer_service.reject_negotiation(current_user, offer_id, payload)


@router.post("/{offer_id}/negotiation/counter")
async def counter_negotiation(
    offer_id: str, payload: NegotiationRespondRequest, current_user: RequireRecruiterWithInvite
):
    return await offer_service.counter_negotiation(current_user, offer_id, payload)


@router.post("/{offer_id}/edit-and-resend")
async def edit_and_resend_offer(
    offer_id: str, payload: OfferEditResendRequest, current_user: RequireRecruiterWithInvite
):
    """Edit offer letter terms after clarification and resend as a new version."""
    return await offer_service.edit_and_resend(current_user, offer_id, payload)


@router.post("/{offer_id}/approve")
async def approve_offer(offer_id: str, payload: OfferApproveRequest, current_user: RequireRecruiterWithInvite):
    """Activate employee after signed offer + docs + IT provisioning."""
    return await offer_service.approve(current_user, offer_id, payload)


@router.post("/{offer_id}/extend-validity")
async def extend_offer_validity(
    offer_id: str, payload: OfferExtendValidityRequest, current_user: RequireRecruiterWithInvite
):
    """Extend an expired unsigned offer for a specific candidate."""
    return await offer_service.extend_validity(current_user, offer_id, payload)
