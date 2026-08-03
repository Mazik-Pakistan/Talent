from typing import Annotated
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import (
    hash_password,
    require_permissions,
    require_roles,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.people_history import (
    find_active_user,
    find_active_candidate,
    find_active_employee,
    prepare_email_for_reinvite,
)

router = APIRouter(prefix="/api/super-admin", tags=["Super Admin"])

RequireSuperAdmin = Annotated[CurrentUser, Depends(require_roles("super_admin"))]

DEFAULT_RECRUITER_CAPABILITIES = {
    "recruitment": True,
    "invite": True,
    "employees": True,
    "documents": True,
    "learning": True,
    "announcements": True,
    "it": True,
    "messages": True,
    "reporting": True,
    "profile": True,
}

ALL_CAPABILITY_KEYS = list(DEFAULT_RECRUITER_CAPABILITIES.keys())


class InviteRecruiterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    job_title: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)
    is_remote: bool = False
    capabilities: dict[str, bool] | None = None  # overrides defaults
    expires_in_days: int = Field(default=365, ge=1, le=365)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.lower().strip()

    @field_validator("full_name", "job_title", "department")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(value.split())


class UpdateCapabilitiesRequest(BaseModel):
    capabilities: dict[str, bool]

    @model_validator(mode="after")
    def validate_keys(self):
        unknown = set(self.capabilities.keys()) - set(ALL_CAPABILITY_KEYS)
        if unknown:
            raise ValueError(f"Unknown capabilities: {', '.join(sorted(unknown))}")
        return self


@router.post("/recruiters/invite", status_code=201)
async def invite_recruiter(request: InviteRecruiterRequest, current_user: RequireSuperAdmin):
    """Invite a recruiter — creates invitation + sends email with invite link."""
    email = request.email.lower().strip()

    # Check no existing active accounts
    if await find_active_user(email):
        raise HTTPException(status_code=409, detail="An account already exists for this email address.")
    if await find_active_employee(email):
        raise HTTPException(status_code=409, detail="An active employee already exists for this email address.")
    if await database.recruiters.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A recruiter account already exists for this email address.")
    if await database.pending_users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A pending registration already exists for this email address.")

    # Prepare email for reinvite if needed
    await prepare_email_for_reinvite(email)

    now = datetime.now(UTC)
    token = token_urlsafe(32)
    expires_at = now + timedelta(days=request.expires_in_days)

    capabilities = {**DEFAULT_RECRUITER_CAPABILITIES}
    if request.capabilities:
        capabilities.update(request.capabilities)

    invitation = {
        "token": token,
        "email": email,
        "full_name": request.full_name,
        "job_title": request.job_title,
        "department": request.department,
        "office_location": request.office_location,
        "is_remote": request.is_remote,
        "recruiter_id": current_user.id,
        "recruiter_email": current_user.email,
        "created_by_role": "super_admin",
        "kind": "recruiter",
        "capabilities": capabilities,
        "status": "pending",
        "expires_at": expires_at,
        "used_at": None,
        "created_at": now,
        "updated_at": now,
        "has_offer": False,
    }
    await database.invitations.insert_one(invitation)

    invite_link = f"{(settings.FRONTEND_URL or settings.frontend_base_url).rstrip('/')}/invite/{token}"
    expires_display = expires_at.strftime("%B %d, %Y at %H:%M UTC")

    email_sent = False
    email_error = None
    try:
        email_service.send_recruiter_invitation_email(
            to_email=email,
            full_name=request.full_name,
            job_title=request.job_title,
            department=request.department,
            invite_link=invite_link,
            expires_at=expires_display,
        )
        email_sent = True
    except Exception as exc:
        email_error = str(exc)

    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": email,
        "role": "super_admin",
        "module": "recruitment",
        "action": "recruiter_invitation_created",
        "outcome": "success" if email_sent else "partial",
        "created_at": now,
    })

    message = (
        f"Recruiter invitation sent to {email}."
        if email_sent
        else f"Recruiter invitation created for {email}, but the email could not be sent."
    )

    return {
        "message": message,
        "email_sent": email_sent,
        "email_error": email_error,
        "invitation": {
            "token": token,
            "email": email,
            "full_name": request.full_name,
            "job_title": request.job_title,
            "department": request.department,
            "status": "pending",
            "expires_at": expires_at.isoformat(),
            "invite_link": invite_link,
            "capabilities": capabilities,
        },
    }


@router.get("/recruiters")
async def list_recruiters(
    current_user: RequireSuperAdmin,
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    """List all recruiter invitations (pending, used, expired) and active recruiter profiles."""
    skip = (page - 1) * page_size

    # Get invitations
    query = {"kind": "recruiter"}
    if status_filter:
        query["status"] = status_filter
    invitations = await database.invitations.find(query).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    total = await database.invitations.count_documents(query)

    # Get active recruiter profiles
    active_recruiters = await database.recruiters.find({"status": "active"}).to_list(200)
    active_map = {r.get("email", "").lower(): r for r in active_recruiters}

    # Get employees who are also recruiters (dual role)
    employee_emails = set()
    for r in active_recruiters:
        emp = await database.employees.find_one({"user_id": r.get("user_id"), "status": "active"}, {"email": 1})
        if emp:
            employee_emails.add(emp.get("email", "").lower())

    results = []
    for inv in invitations:
        inv_email = inv.get("email", "").lower()
        active = active_map.get(inv_email)
        results.append({
            "id": str(inv.get("_id")),
            "token": inv.get("token"),
            "email": inv_email,
            "full_name": inv.get("full_name"),
            "job_title": inv.get("job_title"),
            "department": inv.get("department"),
            "office_location": inv.get("office_location"),
            "status": inv.get("status"),
            "created_at": inv["created_at"].isoformat() if inv.get("created_at") else None,
            "expires_at": inv["expires_at"].isoformat() if inv.get("expires_at") else None,
            "used_at": inv.get("used_at").isoformat() if inv.get("used_at") else None,
            "capabilities": inv.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES,
            "is_active": bool(active),
            "has_employee_profile": inv_email in employee_emails,
            "recruiter_id": active.get("_id") if active else None,
        })

    return {"recruiters": results, "total": total, "page": page, "page_size": page_size}


@router.put("/recruiters/{invitation_id}/capabilities")
async def update_recruiter_capabilities(
    invitation_id: str,
    request: UpdateCapabilitiesRequest,
    current_user: RequireSuperAdmin,
):
    """Update capabilities for a recruiter invitation. Also updates active recruiter profile if exists."""
    from bson import ObjectId

    if not ObjectId.is_valid(invitation_id):
        raise HTTPException(status_code=400, detail="Invalid invitation ID.")

    inv = await database.invitations.find_one({"_id": ObjectId(invitation_id)})
    if not inv or inv.get("kind") != "recruiter":
        raise HTTPException(status_code=404, detail="Recruiter invitation not found.")

    now = datetime.now(UTC)
    # Merge: keep existing capabilities, update only provided keys
    existing = inv.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES
    updated = {**existing, **request.capabilities}

    await database.invitations.update_one(
        {"_id": ObjectId(invitation_id)},
        {"$set": {"capabilities": updated, "updated_at": now}},
    )

    # Also update the recruiter profile if they've already registered
    email = inv.get("email", "").lower()
    recruiter_profile = await database.recruiters.find_one({"email": email, "status": "active"})
    if recruiter_profile:
        await database.recruiters.update_one(
            {"_id": recruiter_profile["_id"]},
            {"$set": {"capabilities": updated, "updated_at": now}},
        )

    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": email,
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiter_capabilities_updated",
        "outcome": "success",
        "created_at": now,
    })

    return {"message": "Capabilities updated.", "capabilities": updated}
