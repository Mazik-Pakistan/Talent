"""Organization Framework Service — multi-tenant career structure management.

Manages departments, roles, skills, certifications, courses, learning roadmaps,
and promotion rules scoped to an organization.  Every collection is keyed by
``organization_id`` so data never leaks across tenants.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from app.core.database import database


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(UTC)


def _oid_filter(organization_id: str) -> dict:
    return {"organization_id": organization_id}


def _doc_id(organization_id: str, name: str) -> str:
    return f"{organization_id}:{name}"


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Departments
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_departments(organization_id: str) -> list[dict]:
    docs = await database.org_framework_departments.find(
        _oid_filter(organization_id), {"_id": 0}
    ).sort("name", 1).to_list(1000)
    return docs


async def get_department(organization_id: str, name: str) -> dict | None:
    return await database.org_framework_departments.find_one(
        {"organization_id": organization_id, "name": name},
        {"_id": 0},
    )


async def create_department(organization_id: str, data: dict) -> dict:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Department name is required.")
    existing = await get_department(organization_id, name)
    if existing:
        raise ValueError(f'Department "{name}" already exists.')
    now = _now()
    doc = {
        "organization_id": organization_id,
        "name": name,
        "description": (data.get("description") or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_departments.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_department(organization_id: str, name: str, data: dict) -> dict:
    dept = await get_department(organization_id, name)
    if not dept:
        raise ValueError(f'Department "{name}" not found.')
    update: dict[str, Any] = {"updated_at": _now()}
    if "name" in data and data["name"].strip() and data["name"].strip() != name:
        new_name = data["name"].strip()
        dup = await get_department(organization_id, new_name)
        if dup:
            raise ValueError(f'Department "{new_name}" already exists.')
        update["name"] = new_name
        # Cascade rename in roles
        await database.org_framework_roles.update_many(
            {"organization_id": organization_id, "department": name},
            {"$set": {"department": new_name, "updated_at": _now()}},
        )
    if "description" in data:
        update["description"] = data["description"].strip()
    await database.org_framework_departments.update_one(
        {"organization_id": organization_id, "name": name},
        {"$set": update},
    )
    return await get_department(organization_id, update.get("name", name))


async def delete_department(organization_id: str, name: str) -> bool:
    result = await database.org_framework_departments.delete_one(
        {"organization_id": organization_id, "name": name},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Roles
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_roles(organization_id: str, department: str | None = None) -> list[dict]:
    q: dict = _oid_filter(organization_id)
    if department:
        q["department"] = department
    docs = await database.org_framework_roles.find(q, {"_id": 0}).sort(
        [("department", 1), ("level_number", 1)]
    ).to_list(5000)
    return docs


async def get_role(organization_id: str, role_id: str) -> dict | None:
    return await database.org_framework_roles.find_one(
        {"organization_id": organization_id, "role_id": role_id},
        {"_id": 0},
    )


async def get_role_by_name(organization_id: str, name: str, department: str | None = None) -> dict | None:
    q: dict = {"organization_id": organization_id, "name": name}
    if department:
        q["department"] = department
    return await database.org_framework_roles.find_one(q, {"_id": 0})


async def create_role(organization_id: str, data: dict) -> dict:
    name = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip()
    if not name or not department:
        raise ValueError("Role name and department are required.")
    existing = await get_role_by_name(organization_id, name, department)
    if existing:
        raise ValueError(f'Role "{name}" already exists in {department}.')
    now = _now()
    role_id = f"{organization_id}:{department}:{name}"
    doc = {
        "organization_id": organization_id,
        "role_id": role_id,
        "name": name,
        "department": department,
        "next_role": (data.get("next_role") or "").strip() or None,
        "level_number": data.get("level_number") or 1,
        "description": (data.get("description") or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_roles.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_role(organization_id: str, role_id: str, data: dict) -> dict:
    role = await get_role(organization_id, role_id)
    if not role:
        raise ValueError(f"Role not found.")
    update: dict[str, Any] = {"updated_at": _now()}
    for field in ("name", "department", "next_role", "level_number", "description"):
        if field in data:
            val = data[field]
            if isinstance(val, str):
                val = val.strip()
            if field in ("name", "department") and not val:
                raise ValueError(f"{field} cannot be empty.")
            update[field] = val
    await database.org_framework_roles.update_one(
        {"organization_id": organization_id, "role_id": role_id},
        {"$set": update},
    )
    return await get_role(organization_id, role_id)


async def delete_role(organization_id: str, role_id: str) -> bool:
    result = await database.org_framework_roles.delete_one(
        {"organization_id": organization_id, "role_id": role_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Skills (per role)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_skills(organization_id: str, role_id: str | None = None, role_name: str | None = None) -> list[dict]:
    q: dict = _oid_filter(organization_id)
    if role_id:
        q["role_id"] = role_id
    elif role_name:
        q["role_name"] = role_name
    docs = await database.org_framework_skills.find(q, {"_id": 0}).to_list(10000)
    return docs


async def create_skill(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    skill_name = (data.get("skill_name") or "").strip()
    if not role_name or not skill_name:
        raise ValueError("Role and skill name are required.")
    now = _now()
    skill_id = f"{organization_id}:{role_name}:{skill_name}"
    doc = {
        "organization_id": organization_id,
        "skill_id": skill_id,
        "role_name": role_name,
        "skill_name": skill_name,
        "proficiency": (data.get("proficiency") or "Intermediate").strip(),
        "weight": data.get("weight") or 20,
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_skills.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_skill(organization_id: str, skill_id: str, data: dict) -> dict:
    update: dict[str, Any] = {"updated_at": _now()}
    for field in ("proficiency", "weight", "skill_name"):
        if field in data:
            update[field] = data[field]
    await database.org_framework_skills.update_one(
        {"organization_id": organization_id, "skill_id": skill_id},
        {"$set": update},
    )
    doc = await database.org_framework_skills.find_one(
        {"organization_id": organization_id, "skill_id": skill_id},
        {"_id": 0},
    )
    if not doc:
        raise ValueError("Skill not found.")
    return doc


async def delete_skill(organization_id: str, skill_id: str) -> bool:
    result = await database.org_framework_skills.delete_one(
        {"organization_id": organization_id, "skill_id": skill_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Certifications (per role)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_certifications(organization_id: str, role_name: str | None = None) -> list[dict]:
    q: dict = _oid_filter(organization_id)
    if role_name:
        q["role_name"] = role_name
    docs = await database.org_framework_certifications.find(q, {"_id": 0}).to_list(5000)
    return docs


async def create_certification(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    cert_name = (data.get("certification_name") or "").strip()
    if not role_name or not cert_name:
        raise ValueError("Role and certification name are required.")
    now = _now()
    cert_id = f"{organization_id}:{role_name}:{cert_name}"
    doc = {
        "organization_id": organization_id,
        "cert_id": cert_id,
        "role_name": role_name,
        "certification_name": cert_name,
        "mandatory": bool(data.get("mandatory", True)),
        "expiration_months": data.get("expiration_months"),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_certifications.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_certification(organization_id: str, cert_id: str, data: dict) -> dict:
    update: dict[str, Any] = {"updated_at": _now()}
    for field in ("certification_name", "mandatory", "expiration_months"):
        if field in data:
            update[field] = data[field]
    result = await database.org_framework_certifications.update_one(
        {"organization_id": organization_id, "cert_id": cert_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise ValueError("Certification not found.")
    doc = await database.org_framework_certifications.find_one(
        {"organization_id": organization_id, "cert_id": cert_id},
        {"_id": 0},
    )
    return doc


async def delete_certification(organization_id: str, cert_id: str) -> bool:
    result = await database.org_framework_certifications.delete_one(
        {"organization_id": organization_id, "cert_id": cert_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Course Catalog (organization-wide, reusable)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_courses(organization_id: str) -> list[dict]:
    docs = await database.org_framework_courses.find(
        _oid_filter(organization_id), {"_id": 0}
    ).sort("name", 1).to_list(10000)
    return docs


async def get_course(organization_id: str, course_id: str) -> dict | None:
    return await database.org_framework_courses.find_one(
        {"organization_id": organization_id, "course_id": course_id},
        {"_id": 0},
    )


async def create_course(organization_id: str, data: dict) -> dict:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Course name is required.")
    now = _now()
    course_id = data.get("course_id") or f"ORG-{now.strftime('%Y%m%d%H%M%S')}-{name[:20].upper().replace(' ', '-')}"
    doc = {
        "organization_id": organization_id,
        "course_id": course_id,
        "name": name,
        "provider": (data.get("provider") or "").strip(),
        "category": (data.get("category") or "").strip(),
        "duration_hours": data.get("duration_hours"),
        "difficulty": (data.get("difficulty") or "Beginner").strip(),
        "url": (data.get("url") or "").strip() or None,
        "description": (data.get("description") or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_courses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_course(organization_id: str, course_id: str, data: dict) -> dict:
    update: dict[str, Any] = {"updated_at": _now()}
    for field in ("name", "provider", "category", "duration_hours", "difficulty", "url", "description"):
        if field in data:
            val = data[field]
            if isinstance(val, str):
                val = val.strip() or None
            update[field] = val
    result = await database.org_framework_courses.update_one(
        {"organization_id": organization_id, "course_id": course_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise ValueError("Course not found.")
    return await get_course(organization_id, course_id)


async def delete_course(organization_id: str, course_id: str) -> bool:
    result = await database.org_framework_courses.delete_one(
        {"organization_id": organization_id, "course_id": course_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Learning Roadmap (per role)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_roadmaps(organization_id: str, role_name: str | None = None) -> list[dict]:
    q: dict = _oid_filter(organization_id)
    if role_name:
        q["role_name"] = role_name
    docs = await database.org_framework_roadmaps.find(q, {"_id": 0}).sort(
        [("role_name", 1), ("order", 1)]
    ).to_list(10000)
    return docs


async def create_roadmap(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    course_id = (data.get("course_id") or "").strip()
    if not role_name or not course_id:
        raise ValueError("Role and course are required.")
    now = _now()
    existing = await database.org_framework_roadmaps.find(
        {"organization_id": organization_id, "role_name": role_name}
    ).to_list(10000)
    order = data.get("order") or (len(existing) + 1)
    roadmap_id = f"{organization_id}:{role_name}:{course_id}:{now.strftime('%Y%m%d%H%M%S%f')}"
    doc = {
        "organization_id": organization_id,
        "roadmap_id": roadmap_id,
        "role_name": role_name,
        "course_id": course_id,
        "course_name": (data.get("course_name") or "").strip() or course_id,
        "mandatory": bool(data.get("mandatory", True)),
        "order": order,
        "prerequisite_course_id": data.get("prerequisite_course_id"),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_roadmaps.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_roadmap(organization_id: str, roadmap_id: str, data: dict) -> dict:
    update: dict[str, Any] = {"updated_at": _now()}
    for field in ("mandatory", "order", "prerequisite_course_id"):
        if field in data:
            update[field] = data[field]
    result = await database.org_framework_roadmaps.update_one(
        {"organization_id": organization_id, "roadmap_id": roadmap_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise ValueError("Roadmap entry not found.")
    doc = await database.org_framework_roadmaps.find_one(
        {"organization_id": organization_id, "roadmap_id": roadmap_id},
        {"_id": 0},
    )
    return doc


async def delete_roadmap(organization_id: str, roadmap_id: str) -> bool:
    result = await database.org_framework_roadmaps.delete_one(
        {"organization_id": organization_id, "roadmap_id": roadmap_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Promotion Rules (per role)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def list_promotion_rules(organization_id: str) -> list[dict]:
    docs = await database.org_framework_promotion_rules.find(
        _oid_filter(organization_id), {"_id": 0}
    ).sort("role_name", 1).to_list(5000)
    return docs


async def get_promotion_rule(organization_id: str, role_name: str) -> dict | None:
    return await database.org_framework_promotion_rules.find_one(
        {"organization_id": organization_id, "role_name": role_name},
        {"_id": 0},
    )


async def upsert_promotion_rule(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    if not role_name:
        raise ValueError("Role name is required.")
    now = _now()
    doc = {
        "organization_id": organization_id,
        "role_name": role_name,
        "min_experience_months": data.get("min_experience_months") or 0,
        "required_readiness_pct": data.get("required_readiness_pct") or 80,
        "manager_approval_required": bool(data.get("manager_approval_required", True)),
        "min_skills_completed_pct": data.get("min_skills_completed_pct") or 100,
        "min_certs_completed": data.get("min_certs_completed") or 0,
        "updated_at": now,
    }
    await database.org_framework_promotion_rules.update_one(
        {"organization_id": organization_id, "role_name": role_name},
        {"$set": doc},
        upsert=True,
    )
    return doc


async def delete_promotion_rule(organization_id: str, role_name: str) -> bool:
    result = await database.org_framework_promotion_rules.delete_one(
        {"organization_id": organization_id, "role_name": role_name},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Dashboard Summary
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def get_framework_summary(organization_id: str) -> dict:
    """Aggregate counts across all framework collections."""
    departments = await database.org_framework_departments.count_documents(_oid_filter(organization_id))
    roles = await database.org_framework_roles.count_documents(_oid_filter(organization_id))
    skills = await database.org_framework_skills.count_documents(_oid_filter(organization_id))
    certifications = await database.org_framework_certifications.count_documents(_oid_filter(organization_id))
    courses = await database.org_framework_courses.count_documents(_oid_filter(organization_id))
    roadmaps = await database.org_framework_roadmaps.count_documents(_oid_filter(organization_id))
    promotion_rules = await database.org_framework_promotion_rules.count_documents(_oid_filter(organization_id))

    # Employees in this org
    try:
        employees = await database.employees.count_documents(
            {"organization_id": organization_id, "status": "active"} if organization_id else {"status": "active"}
        )
    except Exception:
        employees = 0

    # Recently updated across all collections
    recent: list[dict] = []
    for coll_name in ("org_framework_roles", "org_framework_courses", "org_framework_departments"):
        try:
            cursor = database[coll_name].find(
                _oid_filter(organization_id)
            ).sort("updated_at", -1).limit(5)
            async for doc in cursor:
                recent.append({
                    "type": coll_name.replace("org_framework_", "").rstrip("s"),
                    "name": doc.get("name") or doc.get("role_name") or doc.get("certification_name") or "?",
                    "updated_at": doc.get("updated_at"),
                })
        except Exception:
            pass
    recent.sort(key=lambda r: r.get("updated_at") or _now(), reverse=True)

    return {
        "departments": departments,
        "roles": roles,
        "skills": skills,
        "certifications": certifications,
        "courses": courses,
        "roadmaps": roadmaps,
        "promotion_rules": promotion_rules,
        "employees": employees,
        "recent_updates": recent[:10],
    }


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Version History
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def create_version_snapshot(organization_id: str, label: str) -> dict:
    now = _now()
    version_id = f"v{now.strftime('%Y%m%d%H%M%S')}"
    snapshot: dict[str, Any] = {
        "organization_id": organization_id,
        "version_id": version_id,
        "label": label,
        "created_at": now,
        "counts": {
            "departments": await database.org_framework_departments.count_documents(_oid_filter(organization_id)),
            "roles": await database.org_framework_roles.count_documents(_oid_filter(organization_id)),
            "skills": await database.org_framework_skills.count_documents(_oid_filter(organization_id)),
            "certifications": await database.org_framework_certifications.count_documents(_oid_filter(organization_id)),
            "courses": await database.org_framework_courses.count_documents(_oid_filter(organization_id)),
        },
    }
    await database.org_framework_versions.insert_one(snapshot)
    return {k: v for k, v in snapshot.items() if k != "_id"}


async def list_versions(organization_id: str) -> list[dict]:
    docs = await database.org_framework_versions.find(
        _oid_filter(organization_id), {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return docs

# ------------------------------------------------------------------------------- //
#   Excel Export / Import
# ------------------------------------------------------------------------------- //

def _style_sheet_header(ws, headers) -> None:
    fill = PatternFill("solid", fgColor="1F3D5C")
    font = Font(color="FFFFFF", bold=True, size=11)
    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.fill = fill
        cell.font = font


def _append_rows(ws, rows) -> None:
    for row in rows:
        ws.append(row)


async def build_export_workbook(organization_id: str) -> BytesIO:
    """Build an XLSX workbook containing the full organization framework."""
    [departments, roles, skills, certifications, courses, roadmaps, rules] = await asyncio.gather(
        list_departments(organization_id),
        list_roles(organization_id),
        list_skills(organization_id),
        list_certifications(organization_id),
        list_courses(organization_id),
        list_roadmaps(organization_id),
        list_promotion_rules(organization_id),
    )

    wb = Workbook()
    wb.remove(wb.active)

    # Sheet 1: Departments
    ws = wb.create_sheet("Departments")
    headers = ["Department Name", "Description"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[d["name"], d.get("description", "")] for d in departments])
    for col in ("A", "B"):
        ws.column_dimensions[col].width = 30

    # Sheet 2: Career Roles
    ws = wb.create_sheet("Career Roles")
    headers = ["Department", "Current Role", "Next Role", "Career Level", "Description"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[r["department"], r["name"], r.get("next_role") or "", r["level_number"], r.get("description", "")] for r in roles])
    for col, width in (("A", 24), ("B", 30), ("C", 30), ("D", 12), ("E", 40)):
        ws.column_dimensions[col].width = width

    # Sheet 3: Skills
    ws = wb.create_sheet("Skills")
    headers = ["Role", "Skill", "Required Proficiency", "Weight"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[s["role_name"], s["skill_name"], s["proficiency"], s["weight"]] for s in skills])
    for col, width in (("A", 30), ("B", 30), ("C", 20), ("D", 10)):
        ws.column_dimensions[col].width = width

    # Sheet 4: Certifications
    ws = wb.create_sheet("Certifications")
    headers = ["Role", "Certification", "Mandatory", "Expiration (months)"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[c["role_name"], c["certification_name"], "Yes" if c.get("mandatory") else "No", c.get("expiration_months") or ""] for c in certifications])
    for col, width in (("A", 30), ("B", 24), ("C", 12), ("D", 18)):
        ws.column_dimensions[col].width = width

    # Sheet 5: Course Catalog
    ws = wb.create_sheet("Course Catalog")
    headers = ["Course ID", "Course Name", "Provider", "Category", "Duration (hours)", "Difficulty", "Provider URL", "Description"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[c["course_id"], c["name"], c.get("provider", ""), c.get("category", ""), c.get("duration_hours") or "", c.get("difficulty", ""), c.get("url") or "", c.get("description", "")] for c in courses])
    for col, width in (("A", 14), ("B", 30), ("C", 24), ("D", 18), ("E", 16), ("F", 14), ("G", 30), ("H", 40)):
        ws.column_dimensions[col].width = width

    # Sheet 6: Learning Roadmap
    ws = wb.create_sheet("Learning Roadmap")
    headers = ["Role", "Course ID", "Mandatory", "Recommended Order"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[r["role_name"], r["course_id"], "Yes" if r.get("mandatory") else "No", r.get("order") or ""] for r in roadmaps])
    for col, width in (("A", 30), ("B", 14), ("C", 12), ("D", 16)):
        ws.column_dimensions[col].width = width

    # Sheet 7: Promotion Rules
    ws = wb.create_sheet("Promotion Rules")
    headers = ["Role", "Minimum Experience (Months)", "Required Readiness %", "Manager Approval Required", "Minimum Skills Completed %", "Minimum Certifications Completed"]
    _style_sheet_header(ws, headers)
    _append_rows(ws, [[r["role_name"], r.get("min_experience_months", 0), r.get("required_readiness_pct", 80), "Yes" if r.get("manager_approval_required") else "No", r.get("min_skills_completed_pct", 100), r.get("min_certs_completed", 0)] for r in rules])
    for col, width in (("A", 30), ("B", 24), ("C", 20), ("D", 24), ("E", 26), ("F", 28)):
        ws.column_dimensions[col].width = width

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _parse_bool(value) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in ("yes", "true", "1", "y")


def parse_import_workbook(file_bytes: bytes) -> dict:
    """Parse an uploaded workbook into structured framework data."""
    wb = load_workbook(BytesIO(file_bytes), data_only=True)

    def sheet_rows(name: str):
        if name not in wb.sheetnames:
            return []
        rows = list(wb[name].iter_rows(values_only=True))
        return [r for r in rows[1:] if any(c is not None and str(c).strip() for c in r)]

    data: dict[str, Any] = {}

    # Departments
    depts = []
    for row in sheet_rows("Departments"):
        depts.append({"name": str(row[0]).strip(), "description": str(row[1]).strip() if len(row) > 1 and row[1] else ""})
    data["departments"] = [d for d in depts if d["name"]]

    # Career Roles
    roles = []
    for row in sheet_rows("Career Roles"):
        if len(row) < 2:
            continue
        roles.append({
            "department": str(row[0]).strip(),
            "name": str(row[1]).strip(),
            "next_role": str(row[2]).strip() if len(row) > 2 and row[2] else "",
            "level_number": int(row[3]) if len(row) > 3 and row[3] not in (None, "") else 1,
            "description": str(row[4]).strip() if len(row) > 4 and row[4] else "",
        })
    data["roles"] = [r for r in roles if r["name"] and r["department"]]

    # Skills
    skills = []
    for row in sheet_rows("Skills"):
        if len(row) < 2:
            continue
        skills.append({
            "role_name": str(row[0]).strip(),
            "skill_name": str(row[1]).strip(),
            "proficiency": str(row[2]).strip() if len(row) > 2 and row[2] else "Intermediate",
            "weight": int(row[3]) if len(row) > 3 and row[3] not in (None, "") else 20,
        })
    data["skills"] = [s for s in skills if s["role_name"] and s["skill_name"]]

    # Certifications
    certs = []
    for row in sheet_rows("Certifications"):
        if len(row) < 2:
            continue
        certs.append({
            "role_name": str(row[0]).strip(),
            "certification_name": str(row[1]).strip(),
            "mandatory": _parse_bool(row[2]) if len(row) > 2 else True,
            "expiration_months": int(row[3]) if len(row) > 3 and row[3] not in (None, "") else None,
        })
    data["certifications"] = [c for c in certs if c["role_name"] and c["certification_name"]]

    # Course Catalog
    courses = []
    for row in sheet_rows("Course Catalog"):
        if len(row) < 2 or not row[1]:
            continue
        courses.append({
            "course_id": str(row[0]).strip() if row[0] else f"ORG-{len(courses) + 1}",
            "name": str(row[1]).strip(),
            "provider": str(row[2]).strip() if len(row) > 2 and row[2] else "",
            "category": str(row[3]).strip() if len(row) > 3 and row[3] else "",
            "duration_hours": int(row[4]) if len(row) > 4 and row[4] not in (None, "") else None,
            "difficulty": str(row[5]).strip() if len(row) > 5 and row[5] else "Beginner",
            "url": str(row[6]).strip() if len(row) > 6 and row[6] else "",
            "description": str(row[7]).strip() if len(row) > 7 and row[7] else "",
        })
    data["courses"] = courses

    # Learning Roadmap
    roadmaps = []
    for row in sheet_rows("Learning Roadmap"):
        if len(row) < 2:
            continue
        roadmaps.append({
            "role_name": str(row[0]).strip(),
            "course_id": str(row[1]).strip(),
            "mandatory": _parse_bool(row[2]) if len(row) > 2 else True,
            "order": int(row[3]) if len(row) > 3 and row[3] not in (None, "") else None,
        })
    data["roadmaps"] = [r for r in roadmaps if r["role_name"] and r["course_id"]]

    # Promotion Rules
    rules = []
    for row in sheet_rows("Promotion Rules"):
        if not row or not row[0]:
            continue
        rules.append({
            "role_name": str(row[0]).strip(),
            "min_experience_months": int(row[1]) if len(row) > 1 and row[1] not in (None, "") else 0,
            "required_readiness_pct": int(row[2]) if len(row) > 2 and row[2] not in (None, "") else 80,
            "manager_approval_required": _parse_bool(row[3]) if len(row) > 3 else True,
            "min_skills_completed_pct": int(row[4]) if len(row) > 4 and row[4] not in (None, "") else 100,
            "min_certs_completed": int(row[5]) if len(row) > 5 and row[5] not in (None, "") else 0,
        })
    data["promotion_rules"] = rules

    return data


def validate_import_data(data: dict) -> dict:
    """Validate imported data and return a report of issues."""
    errors: list[str] = []
    warnings: list[str] = []

    dept_names = [d["name"].lower() for d in data["departments"]]
    dup_depts = {n for n in dept_names if dept_names.count(n) > 1}
    if dup_depts:
        errors.append(f"Duplicate departments: {', '.join(sorted(dup_depts))}")

    roles = data["roles"]
    role_names = [r["name"].lower() for r in roles]
    dup_roles = {r for r in role_names if role_names.count(r) > 1}
    if dup_roles:
        errors.append(f"Duplicate roles: {', '.join(sorted(dup_roles))}")

    # Circular hierarchy detection via DFS
    role_to_next: dict[str, str] = {}
    for r in roles:
        role_to_next[r["name"].lower()] = (r.get("next_role") or "").lower()

    def has_cycle(start: str) -> bool:
        visited = set()
        node = start
        while node:
            if node in visited:
                return True
            visited.add(node)
            node = role_to_next.get(node)
        return False

    for r in roles:
        if has_cycle(r["name"].lower()):
            errors.append(f"Circular promotion hierarchy detected involving role: {r['name']}")
            break

    course_ids = {c["course_id"] for c in data["courses"]}
    skill_role_names = {s["role_name"].lower() for s in data["skills"]}
    cert_role_names = {c["role_name"].lower() for c in data["certifications"]}
    roadmap_role_names = {r["role_name"].lower() for r in data["roadmaps"]}
    roadmap_course_ids = {r["course_id"] for r in data["roadmaps"]}
    rule_role_names = {r["role_name"].lower() for r in data["promotion_rules"]}

    if not roles:
        warnings.append("No roles found in workbook.")

    for r in roles:
        if r["department"].lower() not in dept_names:
            warnings.append(f"Role '{r['name']}' references missing department '{r['department']}'.")

    missing_courses = roadmap_course_ids - course_ids
    if missing_courses:
        errors.append(f"Learning roadmap references missing course IDs: {', '.join(sorted(missing_courses))}")

    for role in set(roadmap_role_names) - set(role_names):
        warnings.append(f"Roadmap references role not defined: {role}")

    for role in set(skill_role_names) - set(role_names):
        warnings.append(f"Skills reference role not defined: {role}")
    for role in set(cert_role_names) - set(role_names):
        warnings.append(f"Certifications reference role not defined: {role}")
    for role in set(rule_role_names) - set(role_names):
        warnings.append(f"Promotion rules reference role not defined: {role}")

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {k: len(v) for k, v in data.items()},
    }


async def apply_import_data(organization_id: str, data: dict) -> dict:
    """Apply validated import data — clears existing framework and imports fresh."""
    report = validate_import_data(data)
    if not report["valid"]:
        raise ValueError("Import contains validation errors: " + "; ".join(report["errors"]))

    oid = _oid_filter(organization_id)
    for coll in (
        database.org_framework_departments,
        database.org_framework_roles,
        database.org_framework_skills,
        database.org_framework_certifications,
        database.org_framework_courses,
        database.org_framework_roadmaps,
        database.org_framework_promotion_rules,
    ):
        await coll.delete_many(oid)

    now = _now()
    for d in data["departments"]:
        await database.org_framework_departments.insert_one({
            "organization_id": organization_id, **d, "created_at": now, "updated_at": now,
        })

    role_ids: dict[str, str] = {}
    for r in data["roles"]:
        role_id = f"{organization_id}:{r['department']}:{r['name']}"
        role_ids[r["name"].lower()] = role_id
        await database.org_framework_roles.insert_one({
            "organization_id": organization_id, "role_id": role_id, **r,
            "next_role": r.get("next_role") or None,
            "created_at": now, "updated_at": now,
        })

    for s in data["skills"]:
        skill_id = f"{organization_id}:{s['role_name']}:{s['skill_name']}"
        await database.org_framework_skills.insert_one({**s, "organization_id": organization_id, "skill_id": skill_id, "created_at": now, "updated_at": now})

    for c in data["certifications"]:
        cert_id = f"{organization_id}:{c['role_name']}:{c['certification_name']}"
        await database.org_framework_certifications.insert_one({**c, "organization_id": organization_id, "cert_id": cert_id, "created_at": now, "updated_at": now})

    for c in data["courses"]:
        course = {k: v for k, v in c.items() if k in (
            "course_id", "name", "provider", "category", "duration_hours", "difficulty", "url", "description")}
        await database.org_framework_courses.insert_one({**course, "organization_id": organization_id, "created_at": now, "updated_at": now})

    for r in data["roadmaps"]:
        roadmap_id = f"{organization_id}:{r['role_name']}:{r['course_id']}:{now.microsecond}"
        course = await database.org_framework_courses.find_one({"organization_id": organization_id, "course_id": r["course_id"]})
        await database.org_framework_roadmaps.insert_one({
            "organization_id": organization_id,
            "roadmap_id": roadmap_id,
            "role_name": r["role_name"],
            "course_id": r["course_id"],
            "course_name": course["name"] if course else r["course_id"],
            "mandatory": r.get("mandatory", True),
            "order": r.get("order") or 1,
            "prerequisite_course_id": None,
            "created_at": now, "updated_at": now,
        })

    for r in data["promotion_rules"]:
        await database.org_framework_promotion_rules.insert_one({**r, "organization_id": organization_id, "updated_at": now})

    await create_version_snapshot(organization_id, "Excel Import")
    return report["counts"]
