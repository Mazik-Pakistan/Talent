from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser
from app.core.security import require_roles
from app.schemas.offer import OfferApproveRequest, OfferCreateRequest, OfferDeclineRequest, OfferSignRequest
from app.services.offer_service import offer_service

router = APIRouter(prefix="/api/offers", tags=["Offers"])

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireCandidate = Annotated[CurrentUser, Depends(require_roles("candidate", "super_admin"))]


@router.post("", status_code=201)
async def create_offer(payload: OfferCreateRequest, current_user: RequireRecruiter):
    """Recruiter reviews a candidate's submitted intake and sends the offer letter."""
    return await offer_service.create_and_send(current_user, payload)


@router.get("/me")
async def get_my_offer(current_user: RequireCandidate):
    """Candidate's most recent offer letter (auto-marks as viewed)."""
    return await offer_service.get_mine(current_user)


@router.get("/candidate/{candidate_id}")
async def list_offers_for_candidate(candidate_id: str, current_user: RequireRecruiter):
    return await offer_service.list_for_candidate(current_user, candidate_id)


@router.post("/{offer_id}/sign")
async def sign_offer(offer_id: str, payload: OfferSignRequest, current_user: RequireCandidate):
    """Candidate digitally signs the offer letter."""
    return await offer_service.sign(current_user, offer_id, payload)


@router.post("/{offer_id}/decline")
async def decline_offer(offer_id: str, payload: OfferDeclineRequest, current_user: RequireCandidate):
    return await offer_service.decline(current_user, offer_id, payload)


@router.post("/{offer_id}/approve")
async def approve_offer(offer_id: str, payload: OfferApproveRequest, current_user: RequireRecruiter):
    """Recruiter/HR approves the signed offer — activates the employee and issues the Employee ID."""
    return await offer_service.approve(current_user, offer_id, payload)
