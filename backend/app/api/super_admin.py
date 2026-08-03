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
            "organization_id": inv.get("organization_id"),
            "is_active": bool(active),
            "has_employee_profile": inv_email in employee_emails,
            "recruiter_id": str(active.get("_id")) if active else None,
        })

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
