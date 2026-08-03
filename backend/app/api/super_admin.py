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
    """List every recruiter document in Mongo (any status), enriched with
    invitation info (if any) and the employees each recruiter manages."""
    skip = (page - 1) * page_size

    r_query = {}
    if status_filter:
        r_query["status"] = status_filter
    all_recruiters = await database.recruiters.find(r_query).sort("created_at", -1).to_list(5000)
    total = len(all_recruiters)
    page_recruiters = all_recruiters[skip: skip + page_size]

    emails = [r.get("email", "").lower() for r in page_recruiters]
    user_ids = [r.get("user_id") for r in page_recruiters if r.get("user_id")]

    # Latest invitation per email (for token/expiry/office_location display only).
    invitations = await database.invitations.find(
        {"kind": "recruiter", "email": {"$in": emails}}
    ).sort("created_at", -1).to_list(len(emails) or 1)
    invitations_by_email: dict[str, dict] = {}
    for inv in invitations:
        invitations_by_email.setdefault(inv.get("email", "").lower(), inv)  # keep newest only

    # Bulk-fetch (single query each, no N+1): recruiters' own employee profiles
    # (dual role) + employees each recruiter manages/onboarded.
    self_profiles = await database.employees.find(
        {"user_id": {"$in": user_ids}, "status": "active"}, {"user_id": 1, "email": 1}
    ).to_list(len(user_ids) or 1)
    employee_emails = {e.get("email", "").lower() for e in self_profiles}

    managed_employees = await database.employees.find(
        {"recruiter_id": {"$in": user_ids}, "status": "active"},
        {"recruiter_id": 1, "full_name": 1, "email": 1, "job_title": 1, "department": 1},
    ).to_list(2000)
    employees_by_recruiter: dict[str, list[dict]] = {}
    for emp in managed_employees:
        employees_by_recruiter.setdefault(emp.get("recruiter_id"), []).append({
            "id": str(emp.get("_id")),
            "full_name": emp.get("full_name"),
            "email": emp.get("email"),
            "job_title": emp.get("job_title"),
            "department": emp.get("department"),
        })

    results = []
    for r in page_recruiters:
        email = r.get("email", "").lower()
        inv = invitations_by_email.get(email)
        managed = employees_by_recruiter.get(r.get("user_id"), [])
        created_at = r.get("created_at") or (inv or {}).get("created_at")
        results.append({
            "id": str(r.get("_id")),
            "token": (inv or {}).get("token"),
            "email": email,
            "full_name": r.get("full_name") or (inv or {}).get("full_name"),
            "job_title": r.get("job_title") or (inv or {}).get("job_title"),
            "department": r.get("department") or (inv or {}).get("department"),
            "office_location": r.get("office_location") or (inv or {}).get("office_location"),
            "status": r.get("status"),
            "created_at": created_at.isoformat() if created_at else None,
            "expires_at": inv["expires_at"].isoformat() if inv and inv.get("expires_at") else None,
            "used_at": inv.get("used_at").isoformat() if inv and inv.get("used_at") else None,
            "capabilities": r.get("capabilities") or (inv or {}).get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES,
            "is_active": r.get("status") == "active",
            "has_employee_profile": email in employee_emails,
            "recruiter_id": str(r.get("_id")),
            "employees": managed,
            "employee_count": len(managed),
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
    if inv and inv.get("kind") != "recruiter":
        inv = None

    if not inv:
        # Legacy/directly-created recruiter with no invitation row — update
        # the recruiter profile directly instead.
        recruiter_profile = await database.recruiters.find_one({"_id": ObjectId(invitation_id)})
        if not recruiter_profile:
            raise HTTPException(status_code=404, detail="Recruiter not found.")
        now = datetime.now(UTC)
        existing = recruiter_profile.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES
        updated = {**existing, **request.capabilities}
        await database.recruiters.update_one(
            {"_id": recruiter_profile["_id"]},
            {"$set": {"capabilities": updated, "updated_at": now}},
        )
        return {"message": "Capabilities updated.", "capabilities": updated}

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