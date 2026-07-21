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
