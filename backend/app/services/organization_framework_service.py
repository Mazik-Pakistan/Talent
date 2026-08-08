"""Organization Framework Service — multi-tenant career structure management.

Manages departments, roles, skills, certifications, courses, learning roadmaps,
and promotion rules scoped to an organization.  Every collection is keyed by
``organization_id`` so data never leaks across tenants.
"""

from __future__ import annotations

import asyncio
import re
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
    # Cascade-delete roles in the department and their dependents so no
    # orphaned framework records remain.
    roles = await database.org_framework_roles.find(
        {"organization_id": organization_id, "department": name}, {"_id": 0, "name": 1}
    ).to_list(10000)
    role_names = [r["name"] for r in roles]
    if role_names:
        await database.org_framework_skills.delete_many(
            {"organization_id": organization_id, "role_name": {"$in": role_names}},
        )
        await database.org_framework_certifications.delete_many(
            {"organization_id": organization_id, "role_name": {"$in": role_names}},
        )
        await database.org_framework_roadmaps.delete_many(
            {"organization_id": organization_id, "role_name": {"$in": role_names}},
        )
        await database.org_framework_promotion_rules.delete_many(
            {"organization_id": organization_id, "role_name": {"$in": role_names}},
        )
    await database.org_framework_roles.delete_many(
        {"organization_id": organization_id, "department": name},
    )
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
    dept = await get_department(organization_id, department)
    if not dept:
        raise ValueError(f'Department "{department}" does not exist in the organization framework.')
    existing = await get_role_by_name(organization_id, name, department)
    if existing:
        raise ValueError(f'Role "{name}" already exists in {department}.')
    next_role = (data.get("next_role") or "").strip() or None
    if next_role and next_role == name:
        raise ValueError("A role cannot be its own next role.")
    try:
        level_number = int(float(str(data.get("level_number") or 1)))
    except (TypeError, ValueError):
        raise ValueError("Career level must be a positive whole number.")
    if level_number < 1:
        raise ValueError("Career level must be a positive whole number.")
    now = _now()
    role_id = f"{organization_id}:{department}:{name}"
    doc = {
        "organization_id": organization_id,
        "role_id": role_id,
        "name": name,
        "department": department,
        "next_role": next_role,
        "level_number": level_number,
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

    new_name = update.get("name", role["name"])
    new_department = update.get("department", role["department"])
    if new_name != role["name"]:
        dup = await get_role_by_name(organization_id, new_name, new_department)
        if dup and dup.get("role_id") != role_id:
            raise ValueError(f'Role "{new_name}" already exists in this department.')

    if new_department != role["department"]:
        dept = await get_department(organization_id, new_department)
        if not dept:
            raise ValueError(f'Department "{new_department}" does not exist in the organization framework.')
        dup = await get_role_by_name(organization_id, new_name, new_department)
        if dup and dup.get("role_id") != role_id:
            raise ValueError(f'Role "{new_name}" already exists in department "{new_department}".')

    if "level_number" in update:
        try:
            level_number = int(float(str(update["level_number"])))
        except (TypeError, ValueError):
            raise ValueError("Career level must be a positive whole number.")
        if level_number < 1:
            raise ValueError("Career level must be a positive whole number.")
        update["level_number"] = level_number

    next_role = update.get("next_role", role.get("next_role"))
    if next_role and next_role == new_name:
        raise ValueError("A role cannot be its own next role.")
    else:
        update["next_role"] = next_role or None

    await database.org_framework_roles.update_one(
        {"organization_id": organization_id, "role_id": role_id},
        {"$set": update},
    )

    # Cascade a rename to dependents that reference the role by name.
    if new_name != role["name"]:
        now = _now()
        for coll, field in (
            (database.org_framework_skills, "role_name"),
            (database.org_framework_certifications, "role_name"),
            (database.org_framework_roadmaps, "role_name"),
            (database.org_framework_promotion_rules, "role_name"),
        ):
            await coll.update_many(
                {"organization_id": organization_id, field: role["name"]},
                {"$set": {field: new_name, "updated_at": now}},
            )
        # Fix other roles whose next_role pointed at the renamed role.
        await database.org_framework_roles.update_many(
            {"organization_id": organization_id, "next_role": role["name"]},
            {"$set": {"next_role": new_name, "updated_at": now}},
        )
    # Cascade a department change to the role's dependents.
    if update.get("department") and update["department"] != role["department"]:
        # Roles are keyed by (department, name); a department move re-keys the role.
        await database.org_framework_roles.update_one(
            {"organization_id": organization_id, "role_id": role_id},
            {"$set": {"role_id": f"{organization_id}:{update['department']}:{new_name}"}},
        )
        role_id = f"{organization_id}:{update['department']}:{new_name}"
    return await get_role(organization_id, role_id)


async def delete_role(organization_id: str, role_id: str) -> bool:
    role = await get_role(organization_id, role_id)
    if not role:
        return False
    # Remove dependents that reference the role so no orphans remain.
    await database.org_framework_skills.delete_many(
        {"organization_id": organization_id, "role_name": role["name"]},
    )
    await database.org_framework_certifications.delete_many(
        {"organization_id": organization_id, "role_name": role["name"]},
    )
    await database.org_framework_roadmaps.delete_many(
        {"organization_id": organization_id, "role_name": role["name"]},
    )
    await database.org_framework_promotion_rules.delete_many(
        {"organization_id": organization_id, "role_name": role["name"]},
    )
    result = await database.org_framework_roles.delete_one(
        {"organization_id": organization_id, "role_id": role_id},
    )
    return result.deleted_count > 0


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Skills (per role)
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

PROFICIENCY_LEVELS = ("Beginner", "Intermediate", "Advanced", "Expert")


async def list_skills(organization_id: str, role_id: str | None = None, role_name: str | None = None) -> list[dict]:
    q: dict = _oid_filter(organization_id)
    if role_id:
        q["role_id"] = role_id
    elif role_name:
        q["role_name"] = role_name
    docs = await database.org_framework_skills.find(q, {"_id": 0}).to_list(10000)

    try:
        emp_filter = {"organization_id": organization_id, "status": "active"} if organization_id else {"status": "active"}
        emp_ids = await database.employees.find(
            emp_filter, {"_id": 0, "employee_id": 1}
        ).to_list(length=50000)
        id_set = [e["employee_id"] for e in emp_ids if e.get("employee_id")]
        if id_set:
            pipeline = [
                {"$match": {"employee_id": {"$in": id_set}}},
                {"$group": {
                    "_id": "$skill_name",
                    "proficiency": {"$first": "$proficiency"},
                    "employee_count": {"$sum": 1},
                }},
                {"$sort": {"_id": 1}},
            ]
            results = await database.employee_skills.aggregate(pipeline).to_list(length=10000)
            existing_names = {d["skill_name"] for d in docs}
            for r in results:
                name = r.get("_id") or ""
                if name and name not in existing_names:
                    docs.append({
                        "skill_id": f"EMP-{organization_id}:{name}",
                        "role_name": "Employee Skills",
                        "skill_name": name,
                        "proficiency": r.get("proficiency") or "Intermediate",
                        "weight": 20,
                        "source": "employee_skills",
                        "employee_count": r.get("employee_count", 0),
                    })
                    existing_names.add(name)
    except Exception:
        pass

    return docs


def _validate_proficiency(value) -> str:
    proficiency = (value or "Intermediate").strip().title()
    if proficiency not in PROFICIENCY_LEVELS:
        raise ValueError(
            f'Invalid proficiency "{value}". Must be one of: {", ".join(PROFICIENCY_LEVELS)}.'
        )
    return proficiency


def _validate_weight(value) -> int:
    try:
        weight = int(float(str(value)))
    except (TypeError, ValueError):
        raise ValueError("Weight must be a whole number between 1 and 100.")
    if weight < 1 or weight > 100:
        raise ValueError("Weight must be a whole number between 1 and 100.")
    return weight


async def create_skill(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    skill_name = (data.get("skill_name") or "").strip()
    if not role_name or not skill_name:
        raise ValueError("Role and skill name are required.")
    role = await get_role_by_name(organization_id, role_name)
    if not role:
        raise ValueError(f'Role "{role_name}" does not exist in the organization framework.')
    proficiency = _validate_proficiency(data.get("proficiency"))
    weight = _validate_weight(data.get("weight") if data.get("weight") is not None else 20)
    now = _now()
    skill_id = f"{organization_id}:{role_name}:{skill_name}"
    existing = await database.org_framework_skills.find_one(
        {"organization_id": organization_id, "skill_id": skill_id},
        {"_id": 0},
    )
    if existing:
        raise ValueError(f'Skill "{skill_name}" already exists for role "{role_name}".')
    doc = {
        "organization_id": organization_id,
        "skill_id": skill_id,
        "role_name": role_name,
        "skill_name": skill_name,
        "proficiency": proficiency,
        "weight": weight,
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_skills.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_skill(organization_id: str, skill_id: str, data: dict) -> dict:
    existing = await database.org_framework_skills.find_one(
        {"organization_id": organization_id, "skill_id": skill_id},
        {"_id": 0},
    )
    if not existing:
        raise ValueError("Skill not found.")
    update: dict[str, Any] = {"updated_at": _now()}
    if "proficiency" in data:
        update["proficiency"] = _validate_proficiency(data["proficiency"])
    if "weight" in data:
        update["weight"] = _validate_weight(data["weight"])
    if "skill_name" in data and (data["skill_name"] or "").strip():
        new_name = data["skill_name"].strip()
        if new_name != existing["skill_name"]:
            new_id = f"{organization_id}:{existing['role_name']}:{new_name}"
            dup = await database.org_framework_skills.find_one(
                {"organization_id": organization_id, "skill_id": new_id},
                {"_id": 0},
            )
            if dup:
                raise ValueError(
                    f'Skill "{new_name}" already exists for role "{existing["role_name"]}".'
                )
            update["skill_id"] = new_id
            update["skill_name"] = new_name
    if not update:
        return existing
    await database.org_framework_skills.update_one(
        {"organization_id": organization_id, "skill_id": skill_id},
        {"$set": update},
    )
    doc = await database.org_framework_skills.find_one(
        {"organization_id": organization_id, "skill_id": update.get("skill_id", skill_id)},
        {"_id": 0},
    )
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

    try:
        emp_filter = {"organization_id": organization_id, "status": "active"} if organization_id else {"status": "active"}
        emp_ids = await database.employees.find(
            emp_filter, {"_id": 0, "employee_id": 1}
        ).to_list(length=50000)
        id_set = [e["employee_id"] for e in emp_ids if e.get("employee_id")]
        if id_set:
            pipeline = [
                {"$match": {"employee_id": {"$in": id_set}, "verification_status": "verified"}},
                {"$group": {
                    "_id": "$course_title",
                    "employee_count": {"$sum": 1},
                }},
                {"$sort": {"_id": 1}},
            ]
            results = await database.learning_certificates.aggregate(pipeline).to_list(length=10000)
            existing_names = {d["certification_name"] for d in docs}
            for r in results:
                name = r.get("_id") or ""
                if name and name not in existing_names:
                    docs.append({
                        "cert_id": f"EMP-{organization_id}:{name}",
                        "role_name": "Employee Certifications",
                        "certification_name": name,
                        "mandatory": False,
                        "source": "learning_certificates",
                        "employee_count": r.get("employee_count", 0),
                    })
                    existing_names.add(name)
    except Exception:
        pass

    return docs


async def create_certification(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    cert_name = (data.get("certification_name") or "").strip()
    if not role_name or not cert_name:
        raise ValueError("Role and certification name are required.")
    role = await get_role_by_name(organization_id, role_name)
    if not role:
        raise ValueError(f'Role "{role_name}" does not exist in the organization framework.')
    expiration_months = data.get("expiration_months")
    if expiration_months not in (None, ""):
        try:
            expiration_months = int(float(str(expiration_months)))
        except (TypeError, ValueError):
            raise ValueError("Expiration must be a positive number of months.")
        if expiration_months < 1:
            raise ValueError("Expiration must be a positive number of months.")
    now = _now()
    cert_id = f"{organization_id}:{role_name}:{cert_name}"
    existing = await database.org_framework_certifications.find_one(
        {"organization_id": organization_id, "cert_id": cert_id},
        {"_id": 0},
    )
    if existing:
        raise ValueError(f'Certification "{cert_name}" already exists for role "{role_name}".')
    doc = {
        "organization_id": organization_id,
        "cert_id": cert_id,
        "role_name": role_name,
        "certification_name": cert_name,
        "mandatory": bool(data.get("mandatory", True)),
        "expiration_months": expiration_months,
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_certifications.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def update_certification(organization_id: str, cert_id: str, data: dict) -> dict:
    existing = await database.org_framework_certifications.find_one(
        {"organization_id": organization_id, "cert_id": cert_id},
        {"_id": 0},
    )
    if not existing:
        raise ValueError("Certification not found.")
    update: dict[str, Any] = {"updated_at": _now()}
    if "mandatory" in data:
        update["mandatory"] = bool(data["mandatory"])
    if "expiration_months" in data:
        value = data["expiration_months"]
        if value in (None, ""):
            update["expiration_months"] = None
        else:
            try:
                months = int(float(str(value)))
            except (TypeError, ValueError):
                raise ValueError("Expiration must be a positive number of months.")
            if months < 1:
                raise ValueError("Expiration must be a positive number of months.")
            update["expiration_months"] = months
    if "certification_name" in data and (data["certification_name"] or "").strip():
        new_name = data["certification_name"].strip()
        if new_name != existing["certification_name"]:
            new_id = f"{organization_id}:{existing['role_name']}:{new_name}"
            dup = await database.org_framework_certifications.find_one(
                {"organization_id": organization_id, "cert_id": new_id},
                {"_id": 0},
            )
            if dup:
                raise ValueError(
                    f'Certification "{new_name}" already exists for role "{existing["role_name"]}".'
                )
            update["cert_id"] = new_id
            update["certification_name"] = new_name
    if not update:
        return existing
    result = await database.org_framework_certifications.update_one(
        {"organization_id": organization_id, "cert_id": cert_id},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise ValueError("Certification not found.")
    doc = await database.org_framework_certifications.find_one(
        {"organization_id": organization_id, "cert_id": update.get("cert_id", cert_id)},
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
    oid_filter = _oid_filter(organization_id)
    framework_docs = await database.org_framework_courses.find(
        oid_filter, {"_id": 0}
    ).sort("name", 1).to_list(10000)

    learning_query = {
        "$or": [{"organization_id": organization_id}, {"organization_id": {"$exists": False}}]
    }
    learning_docs = await database.learning_courses.find(
        learning_query
    ).sort("title", 1).to_list(10000)

    seen = {c["course_id"] for c in framework_docs}
    for ld in learning_docs:
        link_id = ld.get("org_framework_course_id") or ""
        if link_id and link_id in seen:
            continue
        synthetic_id = link_id or f"LC-{str(ld.get('_id', ''))}"
        framework_docs.append({
            "organization_id": organization_id,
            "course_id": synthetic_id,
            "name": ld.get("title") or "",
            "provider": ld.get("provider") or "",
            "category": ld.get("category") or ld.get("designation") or "",
            "duration_hours": round((ld.get("duration_minutes") or 0) / 60, 1) if ld.get("duration_minutes") else None,
            "difficulty": ld.get("difficulty") or "Beginner",
            "url": ld.get("url"),
            "description": ld.get("description") or "",
            "source": "learning_courses",
        })
        seen.add(synthetic_id)
    return framework_docs


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
    try:
        from app.services.course_sync_service import sync_to_learning
        await sync_to_learning(organization_id, doc)
    except Exception:
        pass
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
    try:
        from app.services.course_sync_service import sync_to_learning
        updated = await get_course(organization_id, course_id)
        await sync_to_learning(organization_id, updated)
    except Exception:
        pass
    return await get_course(organization_id, course_id)


async def delete_course(organization_id: str, course_id: str) -> bool:
    # Remove roadmap entries referencing the course so no orphans remain.
    await database.org_framework_roadmaps.delete_many(
        {"organization_id": organization_id, "course_id": course_id},
    )
    try:
        from app.services.course_sync_service import sync_delete_from_learning
        await sync_delete_from_learning(organization_id, course_id)
    except Exception:
        pass
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

    try:
        level_query = {"$or": [{"organization_id": organization_id}, {"organization_id": {"$exists": False}}]}
        if role_name:
            level_query = {"$and": [level_query, {"role_title": {"$regex": f"^{re.escape(role_name.strip())}$", "$options": "i"}}]}
        levels = await database.career_levels.find(
            level_query, {"_id": 0, "role_title": 1, "learning_path": 1}
        ).to_list(length=10000)

        seen = {(d.get("role_name"), d.get("course_id")) for d in docs}
        for level in levels:
            role = level.get("role_title") or ""
            if not role:
                continue
            for course in level.get("learning_path") or []:
                title = course.get("course_title") or ""
                if not title:
                    continue
                row_key = (role, title)
                if row_key in seen:
                    continue
                seen.add(row_key)
                docs.append({
                    "role_name": role,
                    "course_id": course.get("course_uid") or title,
                    "course_name": title,
                    "order": course.get("order") or 1,
                    "source": "career_levels",
                })
    except Exception:
        pass

    return docs


async def create_roadmap(organization_id: str, data: dict) -> dict:
    role_name = (data.get("role_name") or "").strip()
    course_id = (data.get("course_id") or "").strip()
    if not role_name or not course_id:
        raise ValueError("Role and course are required.")
    role = await get_role_by_name(organization_id, role_name)
    if not role:
        raise ValueError(f'Role "{role_name}" does not exist in the organization framework.')
    course = await get_course(organization_id, course_id)
    if not course:
        raise ValueError(f'Course "{course_id}" does not exist in the organization framework course catalog.')
    existing = await database.org_framework_roadmaps.find_one(
        {"organization_id": organization_id, "role_name": role_name, "course_id": course_id},
        {"_id": 0},
    )
    if existing:
        raise ValueError(f'Course "{course_id}" is already on the roadmap for role "{role_name}".')
    now = _now()
    roadmap_rows = await database.org_framework_roadmaps.find(
        {"organization_id": organization_id, "role_name": role_name}
    ).to_list(10000)
    order = data.get("order") or (len(roadmap_rows) + 1)
    roadmap_id = f"{organization_id}:{role_name}:{course_id}:{now.strftime('%Y%m%d%H%M%S%f')}"
    doc = {
        "organization_id": organization_id,
        "roadmap_id": roadmap_id,
        "role_name": role_name,
        "course_id": course_id,
        "course_name": (data.get("course_name") or "").strip() or course["name"],
        "mandatory": bool(data.get("mandatory", True)),
        "order": order,
        "prerequisite_course_id": data.get("prerequisite_course_id"),
        "created_at": now,
        "updated_at": now,
    }
    await database.org_framework_roadmaps.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def reorder_roadmap(organization_id: str, role_name: str, ordered_ids: list[str]) -> list[dict]:
    """Set the recommended order for a role's roadmap entries.

    ``ordered_ids`` must contain exactly the roadmap entries that belong to the
    role (in the new order); any entry missing from the list is appended after
    them in its previous relative order.
    """
    role_name = (role_name or "").strip()
    if not role_name:
        raise ValueError("Role name is required.")
    rows = await database.org_framework_roadmaps.find(
        {"organization_id": organization_id, "role_name": role_name}
    ).to_list(10000)
    by_id = {r["roadmap_id"]: r for r in rows}
    unknown = [rid for rid in ordered_ids if rid not in by_id]
    if unknown:
        raise ValueError(
            f"Roadmap entries {unknown} do not belong to role '{role_name}'."
        )
    now = _now()
    ordered = [rid for rid in ordered_ids if rid in by_id]
    remaining = sorted(
        (r for rid, r in by_id.items() if rid not in ordered),
        key=lambda r: (r.get("order") is None, r.get("order") or 0),
    )
    position = 1
    for rid in ordered + [r["roadmap_id"] for r in remaining]:
        await database.org_framework_roadmaps.update_one(
            {"organization_id": organization_id, "roadmap_id": rid},
            {"$set": {"order": position, "updated_at": now}},
        )
        position += 1
    return await list_roadmaps(organization_id, role_name)


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
    role = await get_role_by_name(organization_id, role_name)
    if not role:
        raise ValueError(f'Role "{role_name}" does not exist in the organization framework.')

    def _percent(value, field: str, default: int) -> int:
        if value is None or value == "":
            return default
        try:
            number = int(float(str(value)))
        except (TypeError, ValueError):
            raise ValueError(f"{field} must be a whole number between 0 and 100.")
        if number < 0 or number > 100:
            raise ValueError(f"{field} must be a whole number between 0 and 100.")
        return number

    def _count(value, field: str, default: int) -> int:
        if value is None or value == "":
            return default
        try:
            number = int(float(str(value)))
        except (TypeError, ValueError):
            raise ValueError(f"{field} must be a non-negative whole number.")
        if number < 0:
            raise ValueError(f"{field} must be a non-negative whole number.")
        return number

    now = _now()
    doc = {
        "organization_id": organization_id,
        "role_name": role_name,
        "min_experience_months": _count(data.get("min_experience_months"), "Minimum experience (months)", 0),
        "required_readiness_pct": _percent(data.get("required_readiness_pct"), "Required readiness %", 80),
        "manager_approval_required": bool(data.get("manager_approval_required", True)),
        "min_skills_completed_pct": _percent(data.get("min_skills_completed_pct"), "Minimum skills completed %", 100),
        "min_certs_completed": _count(data.get("min_certs_completed"), "Minimum certifications completed", 0),
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
    skills_framework = await database.org_framework_skills.count_documents(_oid_filter(organization_id))
    certifications_framework = await database.org_framework_certifications.count_documents(_oid_filter(organization_id))
    courses_framework = await database.org_framework_courses.count_documents(_oid_filter(organization_id))
    learning_query = {
        "$or": [{"organization_id": organization_id}, {"organization_id": {"$exists": False}}]
    }
    courses_learning = await database.learning_courses.count_documents(learning_query)
    courses = courses_framework + courses_learning
    roadmaps = len(await list_roadmaps(organization_id))
    promotion_rules = await database.org_framework_promotion_rules.count_documents(_oid_filter(organization_id))

    # Employees in this org
    try:
        emp_filter = {"organization_id": organization_id, "status": "active"} if organization_id else {"status": "active"}
        employees = await database.employees.count_documents(emp_filter)
    except Exception:
        employees = 0

    # Unique skills & certifications from the Learning module (employee skills + certs)
    try:
        emp_ids = await database.employees.find(
            emp_filter, {"_id": 0, "employee_id": 1}
        ).to_list(length=50000)
        id_set = [e["employee_id"] for e in emp_ids if e.get("employee_id")]
        if id_set:
            skills_pipeline = [
                {"$match": {"employee_id": {"$in": id_set}}},
                {"$group": {"_id": "$skill_name"}},
                {"$count": "total"},
            ]
            result = await database.employee_skills.aggregate(skills_pipeline).to_list(1)
            skills_learning = result[0]["total"] if result else 0

            certs_pipeline = [
                {"$match": {"employee_id": {"$in": id_set}, "verification_status": "verified"}},
                {"$group": {"_id": "$course_title"}},
                {"$count": "total"},
            ]
            result = await database.learning_certificates.aggregate(certs_pipeline).to_list(1)
            certs_learning = result[0]["total"] if result else 0
        else:
            skills_learning = 0
            certs_learning = 0
    except Exception:
        skills_learning = 0
        certs_learning = 0

    skills = skills_framework + skills_learning
    certifications = certifications_framework + certs_learning

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


async def get_org_structure_options(organization_id: str) -> dict:
    """Compact, org-scoped option sets for every module's dropdowns.

    Single source of truth for departments, roles, skills, certifications and
    courses so recruiter, candidate and employee UIs (and their AI assistants)
    never need independent or hardcoded lists.
    """
    [departments, roles, skills, certifications, courses] = await asyncio.gather(
        list_departments(organization_id),
        list_roles(organization_id),
        list_skills(organization_id),
        list_certifications(organization_id),
        list_courses(organization_id),
    )
    return {
        "departments": [d["name"] for d in departments if d.get("name")],
        "roles": [
            {"name": r["name"], "department": r["department"], "next_role": r.get("next_role")}
            for r in roles
            if r.get("name")
        ],
        "skills": sorted({s.get("skill_name") for s in skills if s.get("skill_name")}),
        "certifications": sorted(
            {c.get("certification_name") for c in certifications if c.get("certification_name")}
        ),
        "courses": [
            {"course_id": c["course_id"], "name": c["name"], "provider": c.get("provider"), "category": c.get("category")}
            for c in courses
            if c.get("name")
        ],
    }


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Seed from existing records
# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //

async def seed_framework_from_existing(organization_id: str) -> dict:
    """Bootstrap the org framework from records the org already owns.

    Reads department/job_title values from the org's employees, candidates and
    recruiters (READ-ONLY — those people records are never modified, deleted or
    re-tagged) and writes only into the org_framework_* collections so existing
    people keep their current values everywhere.

    Idempotent: existing framework entries are never duplicated or overwritten,
    so re-running after manual edits only adds what is still missing.
    """
    now = _now()

    async def _distinct_pairs(collection: str) -> set[tuple[str, str]]:
        docs = await database[collection].find(
            {"organization_id": organization_id},
            {"_id": 0, "department": 1, "job_title": 1},
        ).to_list(100000)
        pairs: set[tuple[str, str]] = set()
        for d in docs:
            dept = (d.get("department") or "").strip()
            title = (d.get("job_title") or "").strip()
            if dept and title:
                pairs.add((dept, title))
        return pairs

    pairs: set[tuple[str, str]] = set()
    for coll in ("employees", "candidates", "recruiters"):
        try:
            pairs.update(await _distinct_pairs(coll))
        except Exception:
            continue

    existing_departments = {d["name"] for d in await list_departments(organization_id)}
    existing_roles = {
        (r["department"], r["name"]) for r in await list_roles(organization_id)
    }

    created_departments: list[str] = []
    for dept, _title in pairs:
        if dept in existing_departments:
            continue
        await database.org_framework_departments.insert_one({
            "organization_id": organization_id,
            "name": dept,
            "description": "",
            "created_at": now,
            "updated_at": now,
        })
        existing_departments.add(dept)
        created_departments.append(dept)

    role_docs: list[dict] = []
    created_roles: list[str] = []
    for dept, title in pairs:
        if (dept, title) in existing_roles:
            continue
        role_docs.append({
            "organization_id": organization_id,
            "role_id": f"{organization_id}:{dept}:{title}",
            "name": title,
            "department": dept,
            "next_role": None,
            "level_number": 1,
            "description": "",
            "created_at": now,
            "updated_at": now,
        })
        existing_roles.add((dept, title))
        created_roles.append(title)
    if role_docs:
        await database.org_framework_roles.insert_many(role_docs)

    if created_departments or created_roles:
        await create_version_snapshot(organization_id, "Seeded from existing records")

    return {
        "departments_created": created_departments,
        "roles_created": created_roles,
        "departments_total": len(existing_departments),
        "roles_total": len(existing_roles),
    }


# ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝ //
#   Dashboard Summary
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


def _parse_int(value, default):
    if value is None:
        return default
    try:
        return int(float(str(value).strip()))
    except (ValueError, TypeError):
        return default


def _clean_str(value) -> str:
    return str(value).strip() if value is not None else ""


# Expected sheets and header columns — must mirror the exported template so an
# uploaded workbook that is not the Organization Framework template is rejected
# with an exact location instead of silently mis-parsing.
SHEET_SCHEMA: dict[str, list[str]] = {
    "Departments": ["Department Name", "Description"],
    "Career Roles": ["Department", "Current Role", "Next Role", "Career Level", "Description"],
    "Skills": ["Role", "Skill", "Required Proficiency", "Weight"],
    "Certifications": ["Role", "Certification", "Mandatory", "Expiration (months)"],
    "Course Catalog": [
        "Course ID", "Course Name", "Provider", "Category",
        "Duration (hours)", "Difficulty", "Provider URL", "Description",
    ],
    "Learning Roadmap": ["Role", "Course ID", "Mandatory", "Recommended Order"],
    "Promotion Rules": [
        "Role", "Minimum Experience (Months)", "Required Readiness %",
        "Manager Approval Required", "Minimum Skills Completed %", "Minimum Certifications Completed",
    ],
}


def parse_import_workbook(file_bytes: bytes) -> dict:
    """Parse an uploaded workbook into structured framework data.

    Every parsed record carries a ``_row`` key (1-based Excel data row) and the
    sheet name is implied by its list, so validation can report exact locations.
    Sheet presence/header problems are collected under ``_sheet_issues`` and
    surfaced as validation errors.
    """
    wb = load_workbook(BytesIO(file_bytes), data_only=True)

    def sheet_rows(name: str):
        if name not in wb.sheetnames:
            return []
        rows = list(wb[name].iter_rows(values_only=True))
        out = []
        for idx, row in enumerate(rows[1:], start=2):
            if any(c is not None and str(c).strip() for c in row):
                out.append((idx, row))
        return out

    def normalize_header(value) -> str:
        return _clean_str(value).strip().lower().replace(" ", "").replace("(", "").replace(")", "").replace("%", "")

    sheet_issues: list[dict[str, Any]] = []
    for sheet_name, expected in SHEET_SCHEMA.items():
        if sheet_name not in wb.sheetnames:
            sheet_issues.append({
                "sheet": sheet_name,
                "row": 1,
                "column": "-",
                "reason": f"Required sheet '{sheet_name}' is missing from the workbook.",
            })
            continue
        ws = wb[sheet_name]
        header_row = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))
        headers = header_row[0] if header_row else ()
        expected_norm = [normalize_header(h) for h in expected]
        actual_norm = [normalize_header(h) for h in headers if h is not None]
        for idx, exp in enumerate(expected_norm):
            if idx >= len(actual_norm) or actual_norm[idx] != exp:
                sheet_issues.append({
                    "sheet": sheet_name,
                    "row": 1,
                    "column": expected[idx],
                    "reason": f"Column {idx + 1} must be '{expected[idx]}' (found '{headers[idx] if idx < len(headers) else '(missing)'}').",
                })
                break

    data: dict[str, Any] = {"_sheet_issues": sheet_issues}

    # Departments
    depts = []
    for row_num, row in sheet_rows("Departments"):
        name = _clean_str(row[0])
        if not name:
            continue
        depts.append({
            "_row": row_num,
            "name": name,
            "description": _clean_str(row[1]) if len(row) > 1 else "",
        })
    data["departments"] = depts

    # Career Roles
    roles = []
    for row_num, row in sheet_rows("Career Roles"):
        if len(row) < 2:
            continue
        name = _clean_str(row[1])
        department = _clean_str(row[0])
        if not name or not department:
            continue
        roles.append({
            "_row": row_num,
            "department": department,
            "name": name,
            "next_role": _clean_str(row[2]) if len(row) > 2 else "",
            "level_number": _parse_int(row[3], 1) if len(row) > 3 else 1,
            "description": _clean_str(row[4]) if len(row) > 4 else "",
        })
    data["roles"] = roles

    # Skills
    skills = []
    for row_num, row in sheet_rows("Skills"):
        if len(row) < 2:
            continue
        role_name = _clean_str(row[0])
        skill_name = _clean_str(row[1])
        if not role_name or not skill_name:
            continue
        skills.append({
            "_row": row_num,
            "role_name": role_name,
            "skill_name": skill_name,
            "proficiency": _clean_str(row[2]) if len(row) > 2 else "Intermediate",
            "weight": _parse_int(row[3], 20) if len(row) > 3 else 20,
        })
    data["skills"] = skills

    # Certifications
    certs = []
    for row_num, row in sheet_rows("Certifications"):
        if len(row) < 2:
            continue
        role_name = _clean_str(row[0])
        cert_name = _clean_str(row[1])
        if not role_name or not cert_name:
            continue
        certs.append({
            "_row": row_num,
            "role_name": role_name,
            "certification_name": cert_name,
            "mandatory": _parse_bool(row[2]) if len(row) > 2 else True,
            "expiration_months": _parse_int(row[3], None) if len(row) > 3 else None,
        })
    data["certifications"] = certs

    # Course Catalog (framework courses only — never the learning provider catalog)
    courses = []
    for row_num, row in sheet_rows("Course Catalog"):
        if len(row) < 2 or not row[1]:
            continue
        course_id = _clean_str(row[0]) or f"ORG-{len(courses) + 1}"
        courses.append({
            "_row": row_num,
            "course_id": course_id,
            "name": _clean_str(row[1]),
            "provider": _clean_str(row[2]) if len(row) > 2 else "",
            "category": _clean_str(row[3]) if len(row) > 3 else "",
            "duration_hours": _parse_int(row[4], None) if len(row) > 4 else None,
            "difficulty": _clean_str(row[5]) if len(row) > 5 else "Beginner",
            "url": _clean_str(row[6]) if len(row) > 6 else "",
            "description": _clean_str(row[7]) if len(row) > 7 else "",
        })
    data["courses"] = courses

    # Learning Roadmap
    roadmaps = []
    for row_num, row in sheet_rows("Learning Roadmap"):
        if len(row) < 2:
            continue
        role_name = _clean_str(row[0])
        course_id = _clean_str(row[1])
        if not role_name or not course_id:
            continue
        roadmaps.append({
            "_row": row_num,
            "role_name": role_name,
            "course_id": course_id,
            "mandatory": _parse_bool(row[2]) if len(row) > 2 else True,
            "order": _parse_int(row[3], None) if len(row) > 3 else None,
        })
    data["roadmaps"] = roadmaps

    # Promotion Rules
    rules = []
    for row_num, row in sheet_rows("Promotion Rules"):
        if not row or not row[0]:
            continue
        role_name = _clean_str(row[0])
        if not role_name:
            continue
        rules.append({
            "_row": row_num,
            "role_name": role_name,
            "min_experience_months": _parse_int(row[1], 0) if len(row) > 1 else 0,
            "required_readiness_pct": _parse_int(row[2], 80) if len(row) > 2 else 80,
            "manager_approval_required": _parse_bool(row[3]) if len(row) > 3 else True,
            "min_skills_completed_pct": _parse_int(row[4], 100) if len(row) > 4 else 100,
            "min_certs_completed": _parse_int(row[5], 0) if len(row) > 5 else 0,
        })
    data["promotion_rules"] = rules

    return data


def validate_import_data(data: dict) -> dict:
    """Validate imported data and return a report of issues.

    The report keeps the legacy ``errors``/``warnings`` string lists and adds a
    structured ``details`` list — ``{sheet, row, column, reason}`` — so the UI
    can show the exact location of every problem.
    """
    errors: list[str] = []
    warnings: list[str] = []
    details: list[dict[str, Any]] = []

    def _err(sheet: str, row: Any, column: str, reason: str) -> None:
        errors.append(f"{sheet} row {row}, column '{column}': {reason}")
        details.append({"sheet": sheet, "row": row, "column": column, "reason": reason})

    def _warn(sheet: str, row: Any, column: str, reason: str) -> None:
        warnings.append(f"{sheet} row {row}, column '{column}': {reason}")

    # Sheet presence / header problems captured while parsing.
    for issue in data.get("_sheet_issues") or []:
        _err(issue.get("sheet", "?"), issue.get("row", 1), issue.get("column", "-"),
             issue.get("reason", "Invalid workbook structure."))

    # ── Departments ────────────────────────────────────────────────────────────
    dept_lookup: dict[str, str] = {}  # lower name -> first name
    for d in data["departments"]:
        key = d["name"].lower()
        if key in dept_lookup:
            _err("Departments", d.get("_row"), "Department Name",
                 f"Duplicate department '{d['name']}' (already defined on row {dept_lookup[key]}).")
        else:
            dept_lookup[key] = d.get("_row")

    # ── Career Roles ───────────────────────────────────────────────────────────
    role_keys: dict[tuple[str, str], int] = {}  # (dept.lower, role.lower) -> row
    role_names_by_dept: dict[str, list[str]] = {}
    for r in data["roles"]:
        if not r["name"]:
            _err("Career Roles", r.get("_row"), "Current Role", "Role name is required.")
            continue
        if not r["department"]:
            _err("Career Roles", r.get("_row"), "Department", "Department is required.")
            continue
        key = (r["department"].lower(), r["name"].lower())
        if key in role_keys:
            _err("Career Roles", r.get("_row"), "Current Role",
                 f"Duplicate role '{r['name']}' in department '{r['department']}' (already defined on row {role_keys[key]}).")
            continue
        role_keys[key] = r.get("_row")
        role_names_by_dept.setdefault(r["department"].lower(), []).append(r["name"])
        if r["department"].lower() not in dept_lookup:
            _err("Career Roles", r.get("_row"), "Department",
                 f"Role '{r['name']}' references department '{r['department']}' which is not defined on the Departments sheet.")
        if not isinstance(r.get("level_number"), int) or r.get("level_number", 0) < 1:
            _err("Career Roles", r.get("_row"), "Career Level", "Career level must be a positive whole number.")

    # Roles are referenced from Skills / Certifications / Roadmaps / Promotion
    # rules by name alone (the same name may exist in several departments), so
    # the referential checks below use the set of all defined role names.
    all_role_names = {key[1] for key in role_keys}

    # Circular next-role detection (within each department)
    for r in data["roles"]:
        next_role = (r.get("next_role") or "").strip().lower()
        if not next_role:
            continue
        if next_role == r["name"].lower():
            _err("Career Roles", r.get("_row"), "Next Role",
                 f"Role '{r['name']}' cannot be its own next role.")
            continue
        if next_role not in [rn.lower() for rn in role_names_by_dept.get(r["department"].lower(), [])]:
            _warn("Career Roles", r.get("_row"), "Next Role",
                  f"Next role '{r.get('next_role')}' is not defined for department '{r['department']}'.")
        # cycle check
        visited: set[str] = set()
        node = r["name"].lower()
        dept = r["department"].lower()
        while node:
            if node in visited:
                _err("Career Roles", r.get("_row"), "Next Role",
                     f"Circular promotion chain detected involving role '{r['name']}'.")
                break
            visited.add(node)
            node = next(
                (
                    (rr.get("next_role") or "").lower()
                    for rr in data["roles"]
                    if rr["department"].lower() == dept and rr["name"].lower() == node
                ),
                "",
            )

    # ── Skills ─────────────────────────────────────────────────────────────────
    skill_keys: set[tuple[str, str]] = set()
    for s in data["skills"]:
        if not s["role_name"]:
            _err("Skills", s.get("_row"), "Role", "Role is required.")
            continue
        if not s["skill_name"]:
            _err("Skills", s.get("_row"), "Skill", "Skill name is required.")
            continue
        key = (s["role_name"].lower(), s["skill_name"].lower())
        if key in skill_keys:
            _err("Skills", s.get("_row"), "Skill",
                 f"Duplicate skill '{s['skill_name']}' for role '{s['role_name']}'.")
            continue
        skill_keys.add(key)
        if s["role_name"].lower() not in all_role_names:
            _err("Skills", s.get("_row"), "Role",
                 f"Skill '{s['skill_name']}' references role '{s['role_name']}' which is not defined on the Career Roles sheet.")
        if not isinstance(s.get("weight"), int) or s.get("weight", 0) < 1 or s.get("weight", 100) > 100:
            _err("Skills", s.get("_row"), "Weight", "Weight must be a whole number between 1 and 100.")

    # ── Certifications ─────────────────────────────────────────────────────────
    cert_keys: set[tuple[str, str]] = set()
    for c in data["certifications"]:
        if not c["role_name"]:
            _err("Certifications", c.get("_row"), "Role", "Role is required.")
            continue
        if not c["certification_name"]:
            _err("Certifications", c.get("_row"), "Certification", "Certification name is required.")
            continue
        key = (c["role_name"].lower(), c["certification_name"].lower())
        if key in cert_keys:
            _err("Certifications", c.get("_row"), "Certification",
                 f"Duplicate certification '{c['certification_name']}' for role '{c['role_name']}'.")
            continue
        cert_keys.add(key)
        if c["role_name"].lower() not in all_role_names:
            _err("Certifications", c.get("_row"), "Role",
                 f"Certification '{c['certification_name']}' references role '{c['role_name']}' which is not defined on the Career Roles sheet.")

    # ── Course Catalog (framework only) ────────────────────────────────────────
    course_ids: dict[str, int] = {}
    for c in data["courses"]:
        if not c["course_id"]:
            _err("Course Catalog", c.get("_row"), "Course ID", "Course ID is required.")
            continue
        if not c["name"]:
            _err("Course Catalog", c.get("_row"), "Course Name", "Course name is required.")
            continue
        if c["course_id"] in course_ids:
            _err("Course Catalog", c.get("_row"), "Course ID",
                 f"Duplicate course ID '{c['course_id']}' (already defined on row {course_ids[c['course_id']]}).")
        else:
            course_ids[c["course_id"]] = c.get("_row")

    # ── Learning Roadmap ───────────────────────────────────────────────────────
    roadmap_keys: set[tuple[str, str]] = set()
    for r in data["roadmaps"]:
        if not r["role_name"]:
            _err("Learning Roadmap", r.get("_row"), "Role", "Role is required.")
            continue
        if not r["course_id"]:
            _err("Learning Roadmap", r.get("_row"), "Course ID", "Course ID is required.")
            continue
        key = (r["role_name"].lower(), r["course_id"].lower())
        if key in roadmap_keys:
            _err("Learning Roadmap", r.get("_row"), "Course ID",
                 f"Duplicate roadmap entry '{r['course_id']}' for role '{r['role_name']}'.")
            continue
        roadmap_keys.add(key)
        if r["role_name"].lower() not in all_role_names:
            _err("Learning Roadmap", r.get("_row"), "Role",
                 f"Roadmap references role '{r['role_name']}' which is not defined on the Career Roles sheet.")
        if r["course_id"] not in course_ids:
            _err("Learning Roadmap", r.get("_row"), "Course ID",
                 f"Roadmap references course ID '{r['course_id']}' which is not defined on the Course Catalog sheet.")

    # ── Promotion Rules ────────────────────────────────────────────────────────
    rule_keys: set[str] = set()
    for p in data["promotion_rules"]:
        if not p["role_name"]:
            _err("Promotion Rules", p.get("_row"), "Role", "Role is required.")
            continue
        if p["role_name"].lower() in rule_keys:
            _err("Promotion Rules", p.get("_row"), "Role",
                 f"Duplicate promotion rule for role '{p['role_name']}'.")
            continue
        rule_keys.add(p["role_name"].lower())
        if p["role_name"].lower() not in all_role_names:
            _err("Promotion Rules", p.get("_row"), "Role",
                 f"Promotion rule references role '{p['role_name']}' which is not defined on the Career Roles sheet.")

    if not data["roles"]:
        warnings.append("No roles found in workbook.")

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "details": details,
        "counts": {k: len(v) for k, v in data.items() if not k.startswith("_")},
    }


async def apply_import_data(organization_id: str, data: dict) -> dict:
    """Apply validated import data atomically.

    The framework is replaced all-or-nothing: existing documents are snapshotted,
    cleared, and the imported data is written back. If any write fails, the
    snapshot is restored so a failed import never leaves a partially-applied
    framework.
    """
    report = validate_import_data(data)
    if not report["valid"]:
        raise ValueError("Import contains validation errors: " + "; ".join(report["errors"]))

    oid = _oid_filter(organization_id)
    collections = (
        database.org_framework_departments,
        database.org_framework_roles,
        database.org_framework_skills,
        database.org_framework_certifications,
        database.org_framework_courses,
        database.org_framework_roadmaps,
        database.org_framework_promotion_rules,
    )

    # Snapshot existing documents (including _id) for rollback.
    snapshots: dict[str, list[dict]] = {}
    for coll in collections:
        snapshots[coll.name] = await coll.find(oid).to_list(100000)

    async def _restore() -> None:
        for coll in collections:
            await coll.delete_many(oid)
        for coll in collections:
            if snapshots.get(coll.name):
                await coll.insert_many(snapshots[coll.name])

    now = _now()

    def _without_row(record: dict) -> dict:
        return {k: v for k, v in record.items() if k != "_row"}

    try:
        for coll in collections:
            await coll.delete_many(oid)

        departments = [
            {"organization_id": organization_id, **_without_row(d), "created_at": now, "updated_at": now}
            for d in data["departments"]
        ]
        if departments:
            await database.org_framework_departments.insert_many(departments)

        roles = []
        for r in data["roles"]:
            role_id = f"{organization_id}:{r['department']}:{r['name']}"
            roles.append({
                "organization_id": organization_id,
                "role_id": role_id,
                **_without_row(r),
                "next_role": r.get("next_role") or None,
                "created_at": now,
                "updated_at": now,
            })
        if roles:
            await database.org_framework_roles.insert_many(roles)

        skills = [
            {"organization_id": organization_id, "skill_id": f"{organization_id}:{s['role_name']}:{s['skill_name']}",
             **_without_row(s), "created_at": now, "updated_at": now}
            for s in data["skills"]
        ]
        if skills:
            await database.org_framework_skills.insert_many(skills)

        certifications = [
            {"organization_id": organization_id, "cert_id": f"{organization_id}:{c['role_name']}:{c['certification_name']}",
             **_without_row(c), "created_at": now, "updated_at": now}
            for c in data["certifications"]
        ]
        if certifications:
            await database.org_framework_certifications.insert_many(certifications)

        courses = [
            {**_without_row(c), "organization_id": organization_id, "created_at": now, "updated_at": now}
            for c in data["courses"]
        ]
        if courses:
            await database.org_framework_courses.insert_many(courses)

        course_names = {c["course_id"]: c["name"] for c in data["courses"]}
        roadmaps = []
        for idx, r in enumerate(data["roadmaps"]):
            roadmaps.append({
                "organization_id": organization_id,
                "roadmap_id": f"{organization_id}:{r['role_name']}:{r['course_id']}:{idx}:{now.microsecond}",
                "role_name": r["role_name"],
                "course_id": r["course_id"],
                "course_name": course_names.get(r["course_id"], r["course_id"]),
                "mandatory": r.get("mandatory", True),
                "order": r.get("order") or (idx + 1),
                "prerequisite_course_id": None,
                "created_at": now,
                "updated_at": now,
            })
        if roadmaps:
            await database.org_framework_roadmaps.insert_many(roadmaps)

        promotion_rules = [
            {**_without_row(p), "organization_id": organization_id, "updated_at": now}
            for p in data["promotion_rules"]
        ]
        if promotion_rules:
            await database.org_framework_promotion_rules.insert_many(promotion_rules)
    except Exception:
        await _restore()
        raise

    await create_version_snapshot(organization_id, "Excel Import")
    return report["counts"]
