"""Backfill organization_id on learning_courses, career_tracks, career_levels,
and employee_career_assignments.

Run once to migrate legacy unscoped documents. Safe to re-run (idempotent).

Usage:
    cd backend && python scripts/backfill_org_scoping.py
"""

from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.database import database


async def _build_recruiter_lookup() -> dict[str, str | None]:
    docs = await database.recruiters.find(
        {}, {"_id": 1, "organization_id": 1}
    ).to_list(length=10000)
    return {str(d["_id"]): d.get("organization_id") for d in docs}


async def backfill_learning_courses() -> int:
    recruiter_lookup = await _build_recruiter_lookup()
    docs = await database.learning_courses.find(
        {"organization_id": {"$exists": False}}
    ).to_list(length=50000)
    updated = 0
    for doc in docs:
        org_id = recruiter_lookup.get(str(doc.get("created_by_id") or ""))
        if org_id:
            await database.learning_courses.update_one(
                {"_id": doc["_id"]},
                {"$set": {"organization_id": org_id}},
            )
            updated += 1
    return updated


async def backfill_career_tracks() -> int:
    recruiter_lookup = await _build_recruiter_lookup()
    docs = await database.career_tracks.find(
        {"organization_id": {"$exists": False}}
    ).to_list(length=10000)
    updated = 0
    for doc in docs:
        org_id = recruiter_lookup.get(str(doc.get("created_by") or ""))
        if org_id:
            await database.career_tracks.update_one(
                {"_id": doc["_id"]},
                {"$set": {"organization_id": org_id}},
            )
            await database.career_levels.update_many(
                {"track_id": str(doc["_id"]), "organization_id": {"$exists": False}},
                {"$set": {"organization_id": org_id}},
            )
            updated += 1
    return updated


async def backfill_career_assignments() -> int:
    recruiter_lookup = await _build_recruiter_lookup()
    docs = await database.employee_career_assignments.find(
        {"organization_id": {"$exists": False}}
    ).to_list(length=10000)
    updated = 0
    for doc in docs:
        org_id = recruiter_lookup.get(str(doc.get("assigned_by") or ""))
        if org_id:
            await database.employee_career_assignments.update_one(
                {"_id": doc["_id"]},
                {"$set": {"organization_id": org_id}},
            )
            updated += 1
    return updated


async def main() -> None:
    print("Backfilling org scoping...")
    n1 = await backfill_learning_courses()
    print(f"  learning_courses: {n1} updated")
    n2 = await backfill_career_tracks()
    print(f"  career_tracks + career_levels: {n2} updated")
    n3 = await backfill_career_assignments()
    print(f"  employee_career_assignments: {n3} updated")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
