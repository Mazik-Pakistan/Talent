from typing import Annotated, Literal
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import (
    get_current_user,
    hash_password,
    require_permissions,
    require_roles,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.organization_service import (
    ORG_MODULE_KEYS,
    create_organization,
    get_organization,
    list_organizations,
    purge_organization,
    resolve_org_modules,
    update_organization,
)
from app.services.people_history import (
    find_active_user,
    find_active_candidate,
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


async def _clamp_capabilities_to_org(
    capabilities: dict[str, bool],
    organization_id: str | None,
) -> dict[str, bool]:
    """Force any module the organization did not purchase to False."""
    org_modules = await resolve_org_modules(organization_id)
    clamped = {**DEFAULT_RECRUITER_CAPABILITIES, **(capabilities or {})}
    for key in ALL_CAPABILITY_KEYS:
        if org_modules.get(key, True) is False:
            clamped[key] = False
    return clamped


def require_recruiter_capability(capability: str):
    """Compatibility dependency — uses CurrentUser.has_capability (org ∩ personal)."""

    async def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role == "super_admin":
            return user
        if user.role == "recruiter" and user.has_capability(capability):
            return user
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
    capabilities: dict[str, bool] | None = None  # overrides defaults
    organization_id: str | None = None  # bind recruiter to an organization (multi-tenant)
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


class BulkUpdateCapabilitiesRequest(BaseModel):
    invitation_ids: list[str] = Field(min_length=1, max_length=200)
    capabilities: dict[str, bool]

    @model_validator(mode="after")
    def validate_keys(self):
        unknown = set(self.capabilities.keys()) - set(ALL_CAPABILITY_KEYS)
        if unknown:
            raise ValueError(f"Unknown capabilities: {', '.join(sorted(unknown))}")
        if not self.invitation_ids:
            raise ValueError("At least one invitation ID is required.")
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


class CreateOrganizationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    modules: dict[str, bool] | None = None
    contact_email: EmailStr | None = None
    description: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return " ".join(value.split())


class UpdateOrganizationRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    modules: dict[str, bool] | None = None
    contact_email: EmailStr | None = None
    description: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, pattern="^(active|inactive)$")

    @model_validator(mode="after")
    def validate_modules(self):
        if self.modules is not None:
            unknown = set(self.modules.keys()) - set(ORG_MODULE_KEYS)
            if unknown:
                raise ValueError(f"Unknown organization modules: {', '.join(sorted(unknown))}")
        return self


# Reusable capability templates for common recruiter roles.
CAPABILITY_TEMPLATES: dict[str, dict[str, bool]] = {
    "standard_recruiter": {
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
    },
    "hiring_only": {
        "overview": True,
        "candidates": True,
        "invite": True,
        "employees": False,
        "talent": False,
        "learning": False,
        "assistant": True,
        "messages": False,
        "announcements": False,
        "it": False,
        "reporting": False,
        "profile": True,
    },
    "people_ops": {
        "overview": True,
        "candidates": False,
        "invite": False,
        "employees": True,
        "talent": True,
        "learning": True,
        "assistant": True,
        "messages": True,
        "announcements": True,
        "it": False,
        "reporting": True,
        "profile": True,
    },
    "it_admin": {
        "overview": True,
        "candidates": False,
        "invite": False,
        "employees": True,
        "talent": False,
        "learning": False,
        "assistant": False,
        "messages": True,
        "announcements": True,
        "it": True,
        "reporting": True,
        "profile": True,
    },
    "viewer": {
        "overview": True,
        "candidates": True,
        "invite": False,
        "employees": True,
        "talent": True,
        "learning": False,
        "assistant": False,
        "messages": False,
        "announcements": False,
        "it": False,
        "reporting": True,
        "profile": True,
    },
}


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

    # Resolve organization binding (multi-tenancy). Explicit org must exist;
    # otherwise fall back to the default organization.
    organization_id = request.organization_id
    if organization_id:
        org = await get_organization(organization_id)
        if not org:
            raise HTTPException(status_code=400, detail="Organization not found.")
        organization_id = org["id"]
    else:
        first_org = await list_organizations(page=1, page_size=1)
        organizations = first_org.get("organizations") or []
        if not organizations:
            await create_organization(name="Default Organization")
            first_org = await list_organizations(page=1, page_size=1)
            organizations = first_org.get("organizations") or []
        organization_id = organizations[0]["id"] if organizations else None

    capabilities = {**DEFAULT_RECRUITER_CAPABILITIES}
    if request.capabilities:
        capabilities.update(request.capabilities)
    capabilities = await _clamp_capabilities_to_org(capabilities, organization_id)

    invitation = {
        "token": token,
        "email": email,
        "full_name": request.full_name,
        "job_title": request.job_title,
        "department": request.department,
        "office_location": request.office_location,
        "is_remote": request.is_remote,
        "organization_id": organization_id,
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

    # Get all recruiters first (not just invitations)
    recruiter_query = {}
    if status_filter and status_filter != "pending":
        recruiter_query["status"] = status_filter
    
    all_recruiters = await database.recruiters.find(recruiter_query).sort("created_at", -1).to_list(1000)
    
    # Get all invitations
    inv_query = {"kind": "recruiter"}
    if status_filter:
        inv_query["status"] = status_filter
    invitations = await database.invitations.find(inv_query).to_list(1000)
    
    # Create maps for easy lookup
    invitation_map = {inv.get("email", "").lower(): inv for inv in invitations}
    
    # Get employees who are also recruiters (dual role)
    employee_emails = set()
    for r in all_recruiters:
        emp = await database.employees.find_one({"user_id": r.get("user_id"), "status": "active"}, {"email": 1})
        if emp:
            employee_emails.add(emp.get("email", "").lower())

    # Combine all recruiters (both with and without invitations)
    all_entries = {}
    
    # Add all recruiters from recruiters collection
    for recruiter in all_recruiters:
        email = recruiter.get("email", "").lower()
        if not email:
            continue
            
        inv = invitation_map.get(email)
        all_entries[email] = {
            "id": str(recruiter.get("_id")),
            "token": inv.get("token") if inv else None,
            "email": email,
            "full_name": recruiter.get("full_name") or (inv.get("full_name") if inv else ""),
            "job_title": recruiter.get("job_title") or (inv.get("job_title") if inv else ""),
            "department": recruiter.get("department") or (inv.get("department") if inv else ""),
            "office_location": recruiter.get("office_location") or (inv.get("office_location") if inv else ""),
            "status": recruiter.get("status"),
            "created_at": recruiter["created_at"].isoformat() if recruiter.get("created_at") else None,
            "expires_at": inv["expires_at"].isoformat() if inv and inv.get("expires_at") else None,
            "used_at": inv.get("used_at").isoformat() if inv and inv.get("used_at") else None,
            "capabilities": recruiter.get("capabilities") or (inv.get("capabilities") if inv else DEFAULT_RECRUITER_CAPABILITIES),
            "organization_id": recruiter.get("organization_id") or (inv.get("organization_id") if inv else None),
            "is_active": recruiter.get("status") == "active",
            "has_employee_profile": email in employee_emails,
            "recruiter_id": str(recruiter.get("_id")),
        }
    
    # Add pending invitations that don't have recruiter profiles yet
    for inv in invitations:
        email = inv.get("email", "").lower()
        if not email or email in all_entries:
            continue
            
        all_entries[email] = {
            "id": str(inv.get("_id")),
            "token": inv.get("token"),
            "email": email,
            "full_name": inv.get("full_name"),
            "job_title": inv.get("job_title"),
            "department": inv.get("department"),
            "office_location": inv.get("office_location"),
            "status": inv.get("status"),
            "created_at": inv["created_at"].isoformat() if inv.get("created_at") else None,
            "expires_at": inv["expires_at"].isoformat() if inv.get("expires_at") else None,
            "used_at": inv.get("used_at").isoformat() if inv.get("used_at") else None,
            "capabilities": inv.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES,
            "organization_id": inv.get("organization_id"),
            "is_active": False,
            "has_employee_profile": email in employee_emails,
            "recruiter_id": None,
        }
    
    # Convert to list and sort by created_at (most recent first)
    results = list(all_entries.values())
    results.sort(key=lambda x: x.get("created_at") or "1900-01-01T00:00:00", reverse=True)
    
    # Apply pagination
    total = len(results)
    results = results[skip:skip + page_size]

    return {"recruiters": results, "total": total, "page": page, "page_size": page_size}


@router.put("/recruiters/{recruiter_id}/capabilities")
async def update_recruiter_capabilities(
    recruiter_id: str,
    request: UpdateCapabilitiesRequest,
    current_user: RequireSuperAdmin,
):
    """Update capabilities for any recruiter entity — profile or invitation."""
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
    organization_id = (profile or inv or {}).get("organization_id")
    updated = await _clamp_capabilities_to_org(updated, organization_id)

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


async def _find_recruiter_entity(recruiter_id: str) -> tuple[dict | None, dict | None]:
    """Resolve a recruiter entity id to (recruiter_profile, invitation)."""
    if not ObjectId.is_valid(recruiter_id):
        return None, None
    oid = ObjectId(recruiter_id)
    profile = await database.recruiters.find_one({"_id": oid})
    if profile:
        inv = await database.invitations.find_one(
            {"kind": "recruiter", "email": (profile.get("email") or "").lower()}
        )
        return profile, inv
    inv = await database.invitations.find_one({"_id": oid, "kind": "recruiter"})
    return None, inv


@router.put("/recruiters/{recruiter_id}")
async def update_recruiter(
    recruiter_id: str,
    request: UpdateRecruiterRequest,
    current_user: RequireSuperAdmin,
):
    """Edit a recruiter's role details and activate/deactivate the account."""
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
        if profile.get("user_id") and (
            request.job_title is not None
            or request.department is not None
            or request.office_location is not None
        ):
            emp = await database.employees.find_one({"user_id": profile["user_id"]})
            if emp:
                emp_updates = {
                    k: v
                    for k, v in {
                        "job_title": request.job_title,
                        "department": request.department,
                        "office_location": request.office_location,
                    }.items()
                    if v is not None
                }
                if emp_updates:
                    await database.employees.update_one(
                        {"_id": emp["_id"]},
                        {"$set": {**emp_updates, "updated_at": now}},
                    )
    elif inv and updates:
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


@router.post("/recruiters/bulk-capabilities")
async def bulk_update_recruiter_capabilities(
    request: BulkUpdateCapabilitiesRequest,
    current_user: RequireSuperAdmin,
):
    """Apply a capability set to many recruiter invitations (and their active profiles) at once."""
    now = datetime.now(UTC)
    valid_ids = [i for i in request.invitation_ids if ObjectId.is_valid(i)]
    if not valid_ids:
        raise HTTPException(status_code=400, detail="No valid invitation IDs provided.")

    object_ids = [ObjectId(i) for i in valid_ids]
    invitations = await database.invitations.find(
        {"_id": {"$in": object_ids}, "kind": "recruiter"}
    ).to_list(len(valid_ids))

    updated_count = 0
    for inv in invitations:
        existing = inv.get("capabilities") or DEFAULT_RECRUITER_CAPABILITIES
        merged = {**existing, **request.capabilities}
        merged = await _clamp_capabilities_to_org(merged, inv.get("organization_id"))
        await database.invitations.update_one(
            {"_id": inv["_id"]},
            {"$set": {"capabilities": merged, "updated_at": now}},
        )
        # Sync active recruiter profiles too
        email = inv.get("email", "").lower()
        recruiter_profile = await database.recruiters.find_one({"email": email, "status": "active"})
        if recruiter_profile:
            await database.recruiters.update_one(
                {"_id": recruiter_profile["_id"]},
                {"$set": {"capabilities": merged, "updated_at": now}},
            )
        updated_count += 1

    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": current_user.email,
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiter_capabilities_bulk_updated",
        "outcome": "success",
        "detail": f"{updated_count} recruiter(s) updated",
        "created_at": now,
    })

    return {
        "message": f"Capabilities updated for {updated_count} recruiter(s).",
        "updated_count": updated_count,
    }


@router.get("/capability-templates")
async def get_capability_templates(current_user: RequireSuperAdmin):
    """List predefined capability templates for quick recruiter role assignment."""
    return {
        "templates": CAPABILITY_TEMPLATES,
        "capabilities": ALL_CAPABILITY_KEYS,
        "labels": {
            "overview": "Overview dashboard",
            "candidates": "Candidates",
            "invite": "Invite & offer",
            "employees": "Employees",
            "talent": "Talent analytics",
            "learning": "Learning",
            "assistant": "AI assistant",
            "messages": "Messages",
            "announcements": "Announcements",
            "it": "IT & support",
            "reporting": "Activity & reporting",
            "profile": "Profile",
        },
    }


# ── Organization management (multi-tenancy) ────────────────────────────────

@router.get("/organizations")
async def list_orgs(
    current_user: RequireSuperAdmin,
    status: str | None = Query(default=None, pattern="^(active|inactive)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    """List all organizations (companies) the product has been sold to."""
    result = await list_organizations(status=status, page=page, page_size=page_size)
    result["modules"] = ORG_MODULE_KEYS
    result["labels"] = {
        "overview": "Overview dashboard",
        "candidates": "Candidates",
        "invite": "Invite & offer",
        "employees": "Employees",
        "talent": "Talent analytics",
        "learning": "Learning",
        "assistant": "AI assistant",
        "messages": "Messages",
        "announcements": "Announcements",
        "it": "IT & support",
        "reporting": "Activity & reporting",
        "profile": "Profile",
    }
    return result


@router.post("/organizations", status_code=201)
async def create_org(request: CreateOrganizationRequest, current_user: RequireSuperAdmin):
    """Create a new organization and grant it a module set."""
    try:
        org = await create_organization(
            name=request.name,
            modules=request.modules,
            contact_email=str(request.contact_email) if request.contact_email else None,
            description=request.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=f"An organization named '{request.name}' already exists.",
        )
    return {"message": "Organization created.", "organization": org}


@router.get("/organizations/{organization_id}")
async def get_org(organization_id: str, current_user: RequireSuperAdmin):
    org = await get_organization(organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {"organization": org}


@router.put("/organizations/{organization_id}")
async def update_org(
    organization_id: str,
    request: UpdateOrganizationRequest,
    current_user: RequireSuperAdmin,
):
    """Update organization details and/or its granted module set."""
    updates = {}
    if request.name:
        updates["name"] = request.name
    if request.modules is not None:
        updates["modules"] = request.modules
    if request.contact_email is not None:
        updates["contact_email"] = str(request.contact_email)
    if request.description is not None:
        updates["description"] = request.description
    if request.status:
        updates["status"] = request.status
    try:
        org = await update_organization(organization_id, **updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=f"An organization named '{request.name}' already exists.",
        )
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {"message": "Organization updated.", "organization": org}


@router.delete("/organizations/{organization_id}")
async def delete_org(organization_id: str, current_user: RequireSuperAdmin):
    """Permanently delete an organization and wipe all of its tenant data.

    Removes recruiters, candidates, employees, invitations, login accounts for
    those people, and related operational records (offers, IT, learning,
    messages, documents, etc.). This cannot be undone.
    """
    try:
        result = await purge_organization(organization_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Organization not found.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    wiped = result["wiped"]
    org_name = (result.get("organization") or {}).get("name") or organization_id
    now = datetime.now(UTC)
    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": current_user.email,
        "role": "super_admin",
        "module": "organizations",
        "action": "organization_purged",
        "outcome": "success",
        "detail": (
            f'Deleted "{org_name}" and wiped {wiped.get("recruiters", 0)} recruiter(s), '
            f'{wiped.get("candidates", 0)} candidate(s), {wiped.get("employees", 0)} employee(s), '
            f'{wiped.get("invitations", 0)} invitation(s).'
        ),
        "created_at": now,
    })

    return {
        "message": (
            f'Organization "{org_name}" deleted. All recruiters, candidates, employees, '
            "invitations, and related data for this organization were permanently wiped."
        ),
        "wiped": wiped,
        "deleted_collections": result.get("deleted") or {},
    }


@router.delete("/recruiters/{recruiter_id}")
async def delete_recruiter(recruiter_id: str, current_user: RequireSuperAdmin):
    """Permanently delete a recruiter and all associated data."""
    profile, inv = await _find_recruiter_entity(recruiter_id)
    if profile is None and inv is None:
        raise HTTPException(status_code=404, detail="Recruiter not found.")

    now = datetime.now(UTC)
    email = (profile or inv).get("email", "").lower()

    # Recruiter-owned records are linked by the recruiter's USER id, not the
    # profile _id (see purge_organization for the same convention).
    user_id = profile.get("user_id") if profile else None

    deleted_items = []

    # Delete recruiter profile
    if profile:
        await database.recruiters.delete_one({"_id": profile["_id"]})
        deleted_items.append("recruiter_profile")

    # Delete invitation
    if inv:
        await database.invitations.delete_one({"_id": inv["_id"]})
        deleted_items.append("invitation")

    # Delete user account if it exists (guard against non-ObjectId values)
    if user_id and ObjectId.is_valid(user_id):
        user_result = await database.users.delete_one({"_id": ObjectId(user_id)})
        if user_result.deleted_count > 0:
            deleted_items.append("user_account")

        # Clean up user-related data
        await database.refresh_tokens.delete_many({"user_id": user_id})
        await database.notifications.delete_many({"recipient_id": user_id})
        await database.agent_conversations.delete_many({"user_id": user_id})
        deleted_items.append("user_data")

    # Clean up recruiter-owned data (linked by user_id)
    if user_id:
        # Detach people the recruiter was managing
        await database.candidates.update_many(
            {"recruiter_id": user_id}, {"$unset": {"recruiter_id": ""}}
        )
        await database.employees.update_many(
            {"recruiter_id": user_id}, {"$unset": {"recruiter_id": ""}}
        )
        # Remove recruiter-created content
        await database.announcements.delete_many({"created_by": user_id})
        await database.offer_letters.delete_many({"recruiter_id": user_id})
        await database.audit_logs.delete_many({"recruiter_id": user_id})
        await database.it_provisioning_batches.delete_many({"recruiter_id": user_id})
        await database.it_provisioning_requests.delete_many({"recruiter_id": user_id})
        await database.it_service_requests.delete_many({"recruiter_id": user_id})
        await database.hr_threads.delete_many({"recruiter_id": user_id})
        await database.recruiter_kb_roles.delete_many({"recruiter_id": user_id})
        await database.recruiter_kb_certifications.delete_many({"recruiter_id": user_id})
        await database.recruiter_kb_meta.delete_many({"recruiter_id": user_id})

        deleted_items.append("recruiter_data")

    # Audit log
    await database.audit_logs.insert_one({
        "user_id": current_user.id,
        "email": current_user.email,
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiter_deleted",
        "outcome": "success",
        "detail": f"Deleted recruiter {email} and associated data: {', '.join(deleted_items)}",
        "created_at": now,
    })

    return {
        "message": f"Recruiter {email} has been permanently deleted.",
        "deleted_items": deleted_items,
    }


def _serialize_doc(doc: dict | None) -> dict | None:
    """Convert ObjectIds/datetimes in a Mongo doc to JSON-safe values."""
    if not doc:
        return doc
    out = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            out[key] = str(value)
        elif isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value
    out["id"] = str(doc["_id"])
    out.pop("_id", None)
    return out


@router.get("/recruiters/{recruiter_id}")
async def get_recruiter_details(recruiter_id: str, current_user: RequireSuperAdmin):
    """Get detailed information about a specific recruiter."""
    profile, inv = await _find_recruiter_entity(recruiter_id)
    if profile is None and inv is None:
        raise HTTPException(status_code=404, detail="Recruiter not found.")

    user_id = profile.get("user_id") if profile else None

    # Get employee profile if exists (dual role)
    employee = None
    if user_id:
        employee = await database.employees.find_one({"user_id": user_id})

    # Get user account info
    user = None
    if user_id and ObjectId.is_valid(user_id):
        user = await database.users.find_one({"_id": ObjectId(user_id)})

    # Get statistics (recruiter-owned records are keyed by user_id)
    stats = {"candidates_managed": 0, "employees_managed": 0, "offers_created": 0, "invitations_sent": 0}
    if user_id:
        stats = {
            "candidates_managed": await database.candidates.count_documents({"recruiter_id": user_id}),
            "employees_managed": await database.employees.count_documents({"recruiter_id": user_id}),
            "offers_created": await database.offer_letters.count_documents({"recruiter_id": user_id}),
            "invitations_sent": await database.invitations.count_documents(
                {"recruiter_id": user_id, "kind": "recruiter"}
            ),
        }

    return {
        "recruiter": {
            "id": recruiter_id,
            "profile": _serialize_doc(profile),
            "invitation": _serialize_doc(inv),
            "employee_profile": _serialize_doc(employee),
            "user_account": _serialize_doc(user),
            "statistics": stats,
        }
    }
