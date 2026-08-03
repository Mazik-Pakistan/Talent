from typing import Annotated, Literal
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import get_current_user, require_roles
from app.services.email_service import email_service
from app.services.people_history import (
    find_active_user,
    find_active_employee,
    prepare_email_for_reinvite,
)

router = APIRouter(prefix="/api/super-admin", tags=["Super Admin"])

RequireSuperAdmin = Annotated[CurrentUser, Depends(require_roles("super_admin"))]

DEFAULT_RECRUITER_CAPABILITIES = {
    "overview": True,
    "candidates": True,
    "invite": True,
    "employees": True,
    "talent": True,
    "learning": True,
    "assistant": True,
    "messages": True,
    "announcements": True,
    "it": True,
    "reporting": True,
    "profile": True,
}

ALL_CAPABILITY_KEYS = list(DEFAULT_RECRUITER_CAPABILITIES.keys())


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()
    return str(value)


async def _recruiter_capabilities_for(user_id: str, email: str) -> dict:
    """Capabilities for a recruiter account, defaulting to full access for
    legacy recruiters that predate the capability system."""
    profile = await database.recruiters.find_one(
        {"$or": [{"user_id": user_id}, {"email": email.lower()}], "status": "active"}
    )
    if profile:
        return profile.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES
    return dict(DEFAULT_RECRUITER_CAPABILITIES)


def require_recruiter_capability(capability: str):
    """Dependency — super_admin always passes; recruiters need the capability.

    Legacy recruiters without a stored capabilities map default to full access
    so nothing breaks until a super admin explicitly revokes a toggle.
    """

    async def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role == "super_admin":
            return user
        if user.role == "recruiter":
            caps = await _recruiter_capabilities_for(user.id, user.email)
            if caps.get(capability, True):
                return user
        await database.audit_logs.insert_one(
            {
                "user_id": user.id,
                "email": user.email,
                "role": user.role,
                "module": "rbac",
                "action": "recruiter_capability_denied",
                "capability": capability,
                "outcome": "denied",
                "created_at": datetime.now(UTC),
            }
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource.",
        )

    return dependency


class InviteRecruiterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    job_title: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)
    is_remote: bool = False
    capabilities: dict[str, bool] | None = None
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


class UpdateRecruiterRequest(BaseModel):
    job_title: str | None = Field(default=None, min_length=2, max_length=120)
    department: str | None = Field(default=None, min_length=2, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)
    status: Literal["active", "inactive"] | None = None

    @field_validator("job_title", "department")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None

    @field_validator("office_location")
    @classmethod
    def normalize_office_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        return cleaned or None


@router.post("/recruiters/invite", status_code=201)
async def invite_recruiter(request: InviteRecruiterRequest, current_user: RequireSuperAdmin):
    """Invite a recruiter — creates invitation + sends email with invite link."""
    email = request.email.lower().strip()

    if await find_active_user(email):
        raise HTTPException(status_code=409, detail="An account already exists for this email address.")
    if await find_active_employee(email):
        raise HTTPException(status_code=409, detail="An active employee already exists for this email address.")
    if await database.recruiters.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A recruiter account already exists for this email address.")
    if await database.pending_users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A pending registration already exists for this email address.")

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
    q: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    """List EVERY recruiter as an independent entity — active profiles and
    pending invitations are merged by email into one row per recruiter."""
    profiles = await database.recruiters.find({}).to_list(1000)
    invitations = await database.invitations.find({"kind": "recruiter"}).to_list(1000)

    user_ids = [p.get("user_id") for p in profiles if p.get("user_id")]
    employees = []
    if user_ids:
        employees = await database.employees.find({"user_id": {"$in": user_ids}}).to_list(1000)
    emp_by_user = {e.get("user_id"): e for e in employees}

    inv_by_email: dict[str, dict] = {}
    for inv in invitations:
        email = (inv.get("email") or "").lower()
        current = inv_by_email.get(email)
        if current is None:
            inv_by_email[email] = inv
        else:
            cur_created = current.get("created_at")
            new_created = inv.get("created_at")
            if cur_created is None or (new_created is not None and new_created > cur_created):
                inv_by_email[email] = inv

    entities: list[dict] = []
    seen: set[str] = set()

    for p in profiles:
        email = (p.get("email") or "").lower()
        if not email:
            continue
        seen.add(email)
        inv = inv_by_email.get(email)
        emp = emp_by_user.get(p.get("user_id"))
        profile_status = p.get("status")
        is_active = profile_status == "active"
        entities.append({
            "id": str(p.get("_id")),
            "source": "profile",
            "invitation_id": str(inv.get("_id")) if inv else None,
            "email": email,
            "full_name": p.get("full_name"),
            "job_title": p.get("job_title"),
            "department": p.get("department"),
            "office_location": p.get("office_location"),
            "status": "active" if is_active else "inactive",
            "is_active": is_active,
            "capabilities": p.get("capabilities") or (inv or {}).get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES,
            "created_at": _iso(p.get("created_at")),
            "expires_at": _iso(inv.get("expires_at")) if inv else None,
            "used_at": _iso(inv.get("used_at")) if inv else None,
            "employee_id": emp.get("employee_id") if emp else None,
            "has_employee_profile": bool(emp),
            "user_id": p.get("user_id"),
        })

    for email, inv in inv_by_email.items():
        if email in seen:
            continue
        seen.add(email)
        entities.append({
            "id": str(inv.get("_id")),
            "source": "invitation",
            "invitation_id": str(inv.get("_id")),
            "email": email,
            "full_name": inv.get("full_name"),
            "job_title": inv.get("job_title"),
            "department": inv.get("department"),
            "office_location": inv.get("office_location"),
            "status": inv.get("status") or "pending",
            "is_active": False,
            "capabilities": inv.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES,
            "created_at": _iso(inv.get("created_at")),
            "expires_at": _iso(inv.get("expires_at")),
            "used_at": _iso(inv.get("used_at")),
            "employee_id": None,
            "has_employee_profile": False,
            "user_id": None,
        })

    if q:
        needle = q.strip().lower()
        entities = [
            e for e in entities
            if needle in e["email"].lower()
            or needle in (e["full_name"] or "").lower()
            or needle in (e["department"] or "").lower()
            or needle in (e["job_title"] or "").lower()
        ]
    if status_filter:
        entities = [e for e in entities if e["status"] == status_filter]

    entities.sort(key=lambda e: e["created_at"] or "", reverse=True)
    total = len(entities)
    start = (page - 1) * page_size

    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": current_user.email,
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiters_listed",
        "outcome": "success",
        "created_at": datetime.now(UTC),
    })

    return {
        "recruiters": entities[start : start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def _find_recruiter_entity(recruiter_id: str) -> tuple[dict | None, dict | None]:
    """Resolve a recruiter entity id to (recruiter_profile, invitation)."""
    if not ObjectId.is_valid(recruiter_id):
        return None, None
    oid = ObjectId(recruiter_id)
    profile = await database.recruiters.find_one({"_id": oid})
    inv = None
    if profile:
        inv = await database.invitations.find_one(
            {"kind": "recruiter", "email": (profile.get("email") or "").lower()}
        )
        return profile, inv
    inv = await database.invitations.find_one({"_id": oid, "kind": "recruiter"})
    return None, inv


@router.put("/recruiters/{recruiter_id}/capabilities")
async def update_recruiter_capabilities(
    recruiter_id: str,
    request: UpdateCapabilitiesRequest,
    current_user: RequireSuperAdmin,
):
    """Update capabilities for any recruiter entity — an active recruiter
    profile or a pending invitation. Applied to both when both exist."""
    profile, inv = await _find_recruiter_entity(recruiter_id)
    if profile is None and inv is None:
        raise HTTPException(status_code=404, detail="Recruiter not found.")

    now = datetime.now(UTC)
    base = {}
    if profile:
        base = profile.get("capabilities") or {}
    if inv:
        base = base or inv.get("capabilities") or {}
    base = base or DEFAULT_RECRUITER_CAPABILITIES
    updated = {**base, **request.capabilities}

    email = (profile or inv).get("email", "").lower()
    if profile:
        await database.recruiters.update_one(
            {"_id": profile["_id"]},
            {"$set": {"capabilities": updated, "updated_at": now}},
        )
    if inv:
        await database.invitations.update_one(
            {"_id": inv["_id"]},
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


@router.put("/recruiters/{recruiter_id}")
async def update_recruiter(
    recruiter_id: str,
    request: UpdateRecruiterRequest,
    current_user: RequireSuperAdmin,
):
    """Edit a recruiter's role details (job title, department, location) and
    activate/deactivate the recruiter account."""
    profile, inv = await _find_recruiter_entity(recruiter_id)
    if profile is None and inv is None:
        raise HTTPException(status_code=404, detail="Recruiter not found.")

    now = datetime.now(UTC)
    updates: dict = {}
    if request.job_title is not None:
        updates["job_title"] = request.job_title
    if request.department is not None:
        updates["department"] = request.department
    if request.office_location is not None:
        updates["office_location"] = request.office_location
    if request.status is not None:
        updates["status"] = request.status

    if profile:
        if updates:
            await database.recruiters.update_one(
                {"_id": profile["_id"]},
                {"$set": {**updates, "updated_at": now}},
            )
        # Keep the linked employee profile (dual role) in sync.
        if profile.get("user_id") and (
            request.job_title is not None or request.department is not None or request.office_location is not None
        ):
            emp = await database.employees.find_one({"user_id": profile["user_id"]})
            if emp:
                emp_updates = {
                    k: v for k, v in {
                        "job_title": request.job_title,
                        "department": request.department,
                        "office_location": request.office_location,
                    }.items() if v is not None
                }
                if emp_updates:
                    await database.employees.update_one(
                        {"_id": emp["_id"]},
                        {"$set": {**emp_updates, "updated_at": now}},
                    )
    elif inv:
        if updates:
            await database.invitations.update_one(
                {"_id": inv["_id"]},
                {"$set": {**updates, "updated_at": now}},
            )

    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": (profile or inv).get("email", "").lower(),
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiter_updated",
        "outcome": "success",
        "detail": str(updates) if updates else "no_changes",
        "created_at": now,
    })

    return {"message": "Recruiter updated.", "updated": updates}
