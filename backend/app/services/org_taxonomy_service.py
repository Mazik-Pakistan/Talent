"""Canonical designations (job titles) and departments for invite + career assignment.

Seeded defaults keep the product usable before any employees exist. Recruiters
select from these lists; values already used on employees are merged in so
legacy free-text titles remain available.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.database import database

DEFAULT_DEPARTMENTS: list[str] = [
    "Engineering",
    "Product",
    "Design",
    "Data & Analytics",
    "AI & Machine Learning",
    "DevOps & Infrastructure",
    "Quality Assurance",
    "Cybersecurity",
    "Human Resources",
    "Talent Acquisition",
    "Finance",
    "Operations",
    "Sales",
    "Marketing",
    "Customer Success",
    "Legal & Compliance",
    "IT Support",
]

DEFAULT_DESIGNATIONS: list[str] = [
    "Software Engineer",
    "Senior Software Engineer",
    "Lead Software Engineer",
    "Full Stack Developer",
    "Frontend Developer",
    "Backend Developer",
    "Mobile Developer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "Cloud Engineer",
    "Data Engineer",
    "Data Scientist",
    "AI Engineer",
    "Machine Learning Engineer",
    "QA Engineer",
    "Security Engineer",
    "Product Manager",
    "Project Manager",
    "UI/UX Designer",
    "Business Analyst",
    "HR Specialist",
    "Recruiter",
    "Talent Partner",
    "Finance Analyst",
    "Operations Coordinator",
    "Customer Success Manager",
    "Sales Executive",
    "Marketing Specialist",
    "IT Support Specialist",
    "Engineering Manager",
    "Director of Engineering",
]


async def seed_org_taxonomy() -> None:
    now = datetime.now(UTC)
    existing = await database.org_taxonomy.find_one({"_id": "global"})
    if existing:
        return
    await database.org_taxonomy.insert_one(
        {
            "_id": "global",
            "departments": DEFAULT_DEPARTMENTS,
            "designations": DEFAULT_DESIGNATIONS,
            "created_at": now,
            "updated_at": now,
        }
    )


async def get_org_taxonomy() -> dict:
    """Return selectable departments + designations (seed + live employee values)."""
    await seed_org_taxonomy()
    doc = await database.org_taxonomy.find_one({"_id": "global"}) or {}
    departments = list(doc.get("departments") or DEFAULT_DEPARTMENTS)
    designations = list(doc.get("designations") or DEFAULT_DESIGNATIONS)

    # Merge values already on employees so older free-text roles stay selectable.
    pipeline_dept = [
        {"$match": {"department": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$department"}},
        {"$limit": 200},
    ]
    pipeline_title = [
        {"$match": {"job_title": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$job_title"}},
        {"$limit": 300},
    ]
    live_depts = [d["_id"] for d in await database.employees.aggregate(pipeline_dept).to_list(200)]
    live_titles = [d["_id"] for d in await database.employees.aggregate(pipeline_title).to_list(300)]

    def _merge(base: list[str], extra: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for value in [*base, *extra]:
            key = value.strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(value.strip())
        return sorted(out, key=str.lower)

    return {
        "departments": _merge(departments, live_depts),
        "designations": _merge(designations, live_titles),
    }


# ─── Department CRUD ────────────────────────────────────────────────────────


async def add_department(name: str) -> dict:
    """Add a new department to the org taxonomy. Raises ValueError on duplicates."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Department name is required.")
    await seed_org_taxonomy()
    doc = await database.org_taxonomy.find_one({"_id": "global"}) or {}
    departments = list(doc.get("departments") or [])
    if any(d.lower() == name.lower() for d in departments):
        raise ValueError(f'Department "{name}" already exists.')
    departments.append(name)
    departments.sort(key=str.lower)
    await database.org_taxonomy.update_one(
        {"_id": "global"},
        {"$set": {"departments": departments, "updated_at": datetime.now(UTC)}},
    )
    return {"department": name, "departments": departments}


async def update_department(old_name: str, new_name: str) -> dict:
    """Rename an existing department. Raises ValueError on invalid input or duplicates."""
    old_name = (old_name or "").strip()
    new_name = (new_name or "").strip()
    if not old_name or not new_name:
        raise ValueError("Both old and new department names are required.")
    if old_name.lower() == new_name.lower():
        return {"department": new_name, "unchanged": True}
    await seed_org_taxonomy()
    doc = await database.org_taxonomy.find_one({"_id": "global"}) or {}
    departments = list(doc.get("departments") or [])
    if not any(d.lower() == old_name.lower() for d in departments):
        raise ValueError(f'Department "{old_name}" not found.')
    if any(d.lower() == new_name.lower() for d in departments):
        raise ValueError(f'Department "{new_name}" already exists.')
    departments = [new_name if d.lower() == old_name.lower() else d for d in departments]
    departments.sort(key=str.lower)
    await database.org_taxonomy.update_one(
        {"_id": "global"},
        {"$set": {"departments": departments, "updated_at": datetime.now(UTC)}},
    )
    return {"department": new_name, "departments": departments}


async def delete_department(name: str) -> dict:
    """Remove a department from the org taxonomy. Raises ValueError if not found."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Department name is required.")
    await seed_org_taxonomy()
    doc = await database.org_taxonomy.find_one({"_id": "global"}) or {}
    departments = list(doc.get("departments") or [])
    before = len(departments)
    departments = [d for d in departments if d.lower() != name.lower()]
    if len(departments) == before:
        raise ValueError(f'Department "{name}" not found.')
    await database.org_taxonomy.update_one(
        {"_id": "global"},
        {"$set": {"departments": departments, "updated_at": datetime.now(UTC)}},
    )
    return {"deleted": name, "departments": departments}
