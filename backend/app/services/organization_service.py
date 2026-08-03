"""Organization multi-tenancy service.

Super Admin (product owner) creates organizations and grants each one a set
of module capabilities. Recruiters are bound to an organization, and every
recruiter-scoped record (candidates, employees, offers, invitations) carries
an organization_id so data never leaks across companies.

Effective capability for a recruiter = organization's granted modules
intersected with the recruiter's own capabilities.
"""

from __future__ import annotations

from datetime import UTC, datetime
from secrets import token_urlsafe

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.database import database
from app.core.rbac import CurrentUser

# All module capability keys an organization can be granted.
ORG_MODULE_KEYS = [
    "recruitment",
    "invite",
    "employees",
    "documents",
    "learning",
    "announcements",
    "it",
    "messages",
    "reporting",
    "profile",
]

DEFAULT_ORG_MODULES: dict[str, bool] = {key: True for key in ORG_MODULE_KEYS}

ORG_MODULE_LABELS = {
    "recruitment": "Candidates & overview",
    "invite": "Invite & offer",
    "employees": "Employees",
    "documents": "Document review",
    "learning": "Learning",
    "announcements": "Announcements",
    "it": "IT & support",
    "messages": "Messages",
    "reporting": "Activity & reporting",
    "profile": "Profile",
}


def _clean(value: str | None) -> str:
    return " ".join(str(value or "").strip().split())


def _slugify(name: str) -> str:
    slug = name.lower().strip().replace(" ", "-").replace("_", "-")
    return "".join(ch for ch in slug if ch.isalnum() or ch == "-")[:60] or "org"


async def create_organization(
    *,
    name: str,
    modules: dict[str, bool] | None = None,
    contact_email: str | None = None,
    description: str | None = None,
) -> dict:
    now = datetime.now(UTC)
    merged_modules = {**DEFAULT_ORG_MODULES}
    if modules:
        unknown = set(modules.keys()) - set(ORG_MODULE_KEYS)
        if unknown:
            raise ValueError(f"Unknown organization modules: {', '.join(sorted(unknown))}")
        merged_modules.update(modules)

    doc = {
        "name": _clean(name),
        "slug": _slugify(name),
        "status": "active",
        "modules": merged_modules,
        "contact_email": _clean(contact_email) or None,
        "description": _clean(description) or None,
        "created_at": now,
        "updated_at": now,
    }
    result = await database.organizations.insert_one(doc)
    doc.pop("_id", None)  # strip ObjectId before returning to FastAPI
    doc["id"] = str(result.inserted_id)
    return doc


async def list_organizations(status: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    query = {}
    if status:
        query["status"] = status
    skip = (page - 1) * page_size
    cursor = database.organizations.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    docs = await cursor.to_list(page_size)
    total = await database.organizations.count_documents(query)
    orgs = [_serialize(d) for d in docs]
    return {"organizations": orgs, "total": total, "page": page, "page_size": page_size}


async def get_organization(organization_id: str) -> dict | None:
    if not ObjectId.is_valid(organization_id):
        return None
    doc = await database.organizations.find_one({"_id": ObjectId(organization_id)})
    return _serialize(doc) if doc else None


async def update_organization(organization_id: str, *, modules: dict[str, bool] | None = None, **fields) -> dict | None:
    if not ObjectId.is_valid(organization_id):
        return None
    updates: dict = {}
    if modules is not None:
        unknown = set(modules.keys()) - set(ORG_MODULE_KEYS)
        if unknown:
            raise ValueError(f"Unknown organization modules: {', '.join(sorted(unknown))}")
        existing = await database.organizations.find_one({"_id": ObjectId(organization_id)})
        existing_modules = (existing or {}).get("modules") or DEFAULT_ORG_MODULES
        merged = {**existing_modules, **modules}
        updates["modules"] = merged
    for key, value in fields.items():
        if key in ("name", "contact_email", "description"):
            updates[key] = _clean(value) or None
        elif key == "status" and value in ("active", "inactive"):
            updates[key] = value
    if not updates:
        return await get_organization(organization_id)
    updates["updated_at"] = datetime.now(UTC)
    await database.organizations.update_one(
        {"_id": ObjectId(organization_id)}, {"$set": updates}
    )
    return await get_organization(organization_id)


async def delete_organization(organization_id: str) -> bool:
    if not ObjectId.is_valid(organization_id):
        return False
    result = await database.organizations.delete_one({"_id": ObjectId(organization_id)})
    return result.deleted_count > 0


async def resolve_org_modules(organization_id: str | None) -> dict[str, bool]:
    """Return the granted module set for an organization (all-true default)."""
    if not organization_id:
        return dict(DEFAULT_ORG_MODULES)
    org = await get_organization(organization_id)
    if not org:
        return dict(DEFAULT_ORG_MODULES)
    return {**DEFAULT_ORG_MODULES, **(org.get("modules") or {})}


async def effective_capabilities(
    recruiter_capabilities: dict[str, bool] | None, organization_id: str | None
) -> dict[str, bool]:
    """Effective capability = organization's granted modules ∩ recruiter's own capabilities.

    Semantics (backward compatible):
    - Missing/empty personal capabilities (legacy recruiters) inherit the org's
      modules instead of being locked out.
    - A recruiter capability is only *disabled* when explicitly False.
    - An organization module is only *disabled* when explicitly False on the org.
    """
    org_modules = await resolve_org_modules(organization_id)
    base = recruiter_capabilities or {}
    result = dict(DEFAULT_ORG_MODULES)
    for key in ORG_MODULE_KEYS:
        if base.get(key, True) is False:
            result[key] = False
        if org_modules.get(key, True) is False:
            result[key] = False
    return result


def _serialize(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = str(doc.get("_id"))
    out.pop("_id", None)
    return out


async def create_default_organization_if_needed() -> None:
    """Ensure at least one organization exists so invites without an explicit
    org still bind to a real company."""
    count = await database.organizations.count_documents({})
    if count:
        return
    try:
        await create_organization(name="Default Organization")
    except DuplicateKeyError:
        # Another worker created it in the meantime — fine.
        return


def recruiter_scope(user: CurrentUser) -> dict:
    """Mongo query fragment that scopes recruiter data to their organization.

    - super_admin: sees everything (empty filter)
    - recruiter with organization_id: sees the whole org's data (multi-tenant)
    - recruiter without organization_id (legacy): falls back to their own rows
    """
    if user.role == "super_admin":
        return {}
    if user.role == "recruiter":
        if user.organization_id:
            return {"organization_id": user.organization_id}
        return {"recruiter_id": user.id}
    return {}


def make_invitation_token() -> str:
    return token_urlsafe(32)
