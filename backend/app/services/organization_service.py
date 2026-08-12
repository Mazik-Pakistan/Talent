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
    "overview",
    "candidates",
    "invite",
    "employees",
    "talent",
    "learning",
    "org_config",
    "assistant",
    "messages",
    "announcements",
    "it",
    "reporting",
    "profile",
    "support",
]

DEFAULT_ORG_MODULES: dict[str, bool] = {key: True for key in ORG_MODULE_KEYS}

ORG_MODULE_LABELS = {
    "overview": "Overview dashboard",
    "candidates": "Candidates",
    "invite": "Invite & offer",
    "employees": "Employees",
    "talent": "Talent analytics",
    "learning": "Learning",
    "org_config": "Organization Setup",
    "assistant": "AI assistant",
    "messages": "Messages",
    "announcements": "Announcements",
    "it": "IT & support",
    "reporting": "Activity & reporting",
    "profile": "Profile",
    "support": "Support tickets",
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


def _ids(docs: list[dict], *keys: str) -> list[str]:
    out: list[str] = []
    for doc in docs:
        for key in keys:
            value = doc.get(key)
            if value:
                out.append(str(value))
    return list(dict.fromkeys(out))


async def purge_organization(organization_id: str) -> dict:
    """Permanently wipe an organization and all tenant data tied to it.

    Deletes recruiters, candidates, employees, invitations, auth users for those
    people, and related operational data (offers, IT, learning, messages, etc.).
    """
    if not ObjectId.is_valid(organization_id):
        raise ValueError("Invalid organization id.")

    org = await get_organization(organization_id)
    if not org:
        raise LookupError("Organization not found.")

    org_filter = {"organization_id": organization_id}

    recruiters = await database.recruiters.find(org_filter).to_list(length=None)
    recruiter_user_ids = _ids(recruiters, "user_id", "supabase_user_id")

    # Include legacy rows missing organization_id but owned by this org's recruiters.
    people_query: dict = {"$or": [org_filter]}
    if recruiter_user_ids:
        people_query["$or"].append({"recruiter_id": {"$in": recruiter_user_ids}})

    candidates = await database.candidates.find(people_query).to_list(length=None)
    employees = await database.employees.find(people_query).to_list(length=None)
    invitations = await database.invitations.find(people_query).to_list(length=None)

    candidate_user_ids = _ids(candidates, "user_id", "supabase_user_id")
    employee_user_ids = _ids(employees, "user_id", "supabase_user_id")
    employee_record_ids = _ids(employees, "employee_id") + [str(d["_id"]) for d in employees]
    candidate_record_ids = [str(d["_id"]) for d in candidates] + _ids(candidates, "candidate_id")

    all_user_ids = list(dict.fromkeys(recruiter_user_ids + candidate_user_ids + employee_user_ids))
    all_emails = _ids(recruiters, "email") + _ids(candidates, "email") + _ids(employees, "email") + _ids(
        invitations, "email"
    )
    all_emails = list(dict.fromkeys(e.lower() for e in all_emails if e))

    summary: dict[str, int] = {}

    async def _delete_many(collection_name: str, query: dict) -> None:
        if not query:
            return
        collection = getattr(database, collection_name, None)
        if collection is None:
            return
        result = await collection.delete_many(query)
        if result.deleted_count:
            summary[collection_name] = summary.get(collection_name, 0) + result.deleted_count

    # People / tenancy core (org-scoped + recruiter-owned legacy)
    await _delete_many("invitations", people_query)
    await _delete_many("candidates", people_query)
    await _delete_many("employees", people_query)
    await _delete_many("recruiters", org_filter)

    # Auth / session
    if all_user_ids:
        valid_oids = [ObjectId(i) for i in all_user_ids if ObjectId.is_valid(i)]
        if valid_oids:
            result = await database.users.delete_many({"_id": {"$in": valid_oids}})
            if result.deleted_count:
                summary["users"] = summary.get("users", 0) + result.deleted_count
        await _delete_many("refresh_tokens", {"user_id": {"$in": all_user_ids}})
        await _delete_many("agent_conversations", {"user_id": {"$in": all_user_ids}})
        await _delete_many("notifications", {"recipient_id": {"$in": all_user_ids}})
        await _delete_many("company_email_password_otps", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_enrollments", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_bookmarks", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_certificates", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_career_goals", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_ai_recommendations", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_skill_assessments", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_skill_gaps", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_role_matches", {"user_id": {"$in": all_user_ids}})
        await _delete_many("learning_recruiter_profile_cache", {"user_id": {"$in": all_user_ids}})
        await _delete_many("employee_skills", {"user_id": {"$in": all_user_ids}})
        await _delete_many("documents", {"owner_id": {"$in": all_user_ids}})
        await _delete_many("ai_coach_messages", {"user_id": {"$in": all_user_ids}})

    if all_emails:
        await _delete_many("pending_users", {"email": {"$in": all_emails}})
        await _delete_many("login_attempts", {"email": {"$in": all_emails}})
        result = await database.users.delete_many({"email": {"$in": all_emails}})
        if result.deleted_count:
            summary["users"] = summary.get("users", 0) + result.deleted_count

    # Recruiter-owned operational data
    if recruiter_user_ids:
        await _delete_many("announcements", {"created_by": {"$in": recruiter_user_ids}})
        await _delete_many("offer_letters", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("it_provisioning_batches", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("it_provisioning_requests", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("it_service_requests", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("it_kits", {"created_by": {"$in": recruiter_user_ids}})
        await _delete_many("hr_threads", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("learning_assignments", {"assigned_by_id": {"$in": recruiter_user_ids}})
        await _delete_many("learning_certificates", {"recruiter_id": {"$in": recruiter_user_ids}})
        await _delete_many("internal_opportunities", {"created_by": {"$in": recruiter_user_ids}})
        await _delete_many("audit_logs", {"recruiter_id": {"$in": recruiter_user_ids}})

    if candidate_record_ids:
        await _delete_many("offer_letters", {"candidate_id": {"$in": candidate_record_ids}})
        await _delete_many("it_provisioning_requests", {"candidate_id": {"$in": candidate_record_ids}})
        await _delete_many("documents", {"owner_id": {"$in": candidate_record_ids}})

    if employee_record_ids:
        await _delete_many("employee_career_events", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("learning_assignments", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("learning_enrollments", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("employee_skills", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("talent_competency_evaluations", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("talent_development_plans", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("internal_opportunity_applications", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("it_service_requests", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("hr_threads", {"employee_id": {"$in": employee_record_ids}})
        await _delete_many("documents", {"owner_id": {"$in": employee_record_ids}})

    if employee_user_ids:
        await _delete_many("hr_threads", {"employee_user_id": {"$in": employee_user_ids}})

    # Organization Framework — the org's single source of truth for structure.
    for collection_name in (
        "org_framework_departments",
        "org_framework_roles",
        "org_framework_skills",
        "org_framework_certifications",
        "org_framework_courses",
        "org_framework_roadmaps",
        "org_framework_promotion_rules",
        "org_framework_versions",
    ):
        await _delete_many(collection_name, org_filter)

    await _delete_many("career_tracks", org_filter)
    await _delete_many("career_levels", org_filter)
    await _delete_many("employee_career_assignments", org_filter)

    await _delete_many("learning_courses", org_filter)

    deleted = await delete_organization(organization_id)
    if not deleted:
        raise LookupError("Organization not found.")
    summary["organizations"] = 1

    return {
        "organization": org,
        "deleted": summary,
        "wiped": {
            "recruiters": len(recruiters),
            "candidates": len(candidates),
            "employees": len(employees),
            "invitations": len(invitations),
            "users": len(all_user_ids),
        },
    }


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
    """Mongo query fragment that scopes recruiter data within their organization.

    - super_admin: sees everything (empty filter)
    - recruiter bound to an organization: only rows of that organization
    - recruiter without an organization: only rows they personally created
    - other roles: no additional scoping (empty filter)
    """
    if user.role == "super_admin":
        return {}
    if user.role == "recruiter":
        if user.organization_id:
            return {"organization_id": user.organization_id}
        return {"recruiter_id": user.id}
    return {}


def recruiter_can_access(user: CurrentUser, record: dict) -> bool:
    """Unified recruiter record access within their organization.

    - super_admin: everything
    - recruiter bound to an organization: any record of that organization
    - recruiter without an organization: only records they personally created
    - other roles: False
    """
    if user.role == "super_admin":
        return True
    if user.role == "recruiter":
        if user.organization_id:
            return record.get("organization_id") == user.organization_id
        return record.get("recruiter_id") == user.id
    return False


def make_invitation_token() -> str:
    return token_urlsafe(32)
