"""Step 2 verification: provider_id backfill + course_key fallback matching.

Handles both fresh orphans and the already-backfilled DB state:
  - Reports current missing-provider_id count (and runs backfill if any remain).
  - Picks 3 real LinkedIn/Managed courses, strips provider_id to recreate the
    legacy collision condition, measures OLD match failures, then re-imports
    via the Import Engine (course_key fallback + provider_id restore).

Run from backend/:  python scripts/e2e_step2_backfill_match_test.py
"""

from __future__ import annotations

import asyncio
import csv
import io
from unittest.mock import AsyncMock

from bson import ObjectId
from starlette.datastructures import Headers
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.database import create_database_indexes, database
from app.core.rbac import CurrentUser
from app.core.security import get_current_user
from app.main import app
from app.services.import_engine_service import import_engine_service
from app.services.managed_learning_service import (
    _course_key,
    _normalize,
    managed_learning_service,
)

FAKE_USER = CurrentUser(
    id="step2-e2e-tester",
    email="step2-e2e@test.local",
    full_name="Step2 E2E Tester",
    role="super_admin",
    access_token="test",
)

MISSING = {
    "$or": [
        {"provider_id": {"$exists": False}},
        {"provider_id": None},
        {"provider_id": ""},
    ]
}


async def _old_match_existing(record: dict, provider: dict | None):
    """Pre-Step-2 identity match (no course_key fallback)."""
    provider_id = str(provider["_id"]) if provider else None

    if record.get("external_id"):
        doc = await database.learning_courses.find_one(
            {"external_id": record["external_id"], "provider_id": provider_id}
        )
        if doc:
            return doc, "external_id"

    if record.get("url"):
        url_key = _normalize(record["url"])
        docs = await database.learning_courses.find(
            {"provider_id": provider_id, "url": {"$ne": None}}
        ).to_list(length=200)
        for doc in docs:
            if _normalize(doc.get("url")) == url_key:
                return doc, "url"

    if provider and record.get("title"):
        title_key = _normalize(record["title"])
        name_key = _normalize(provider.get("name"))
        docs = await database.learning_courses.find({"provider_id": provider_id}).to_list(length=2000)
        for doc in docs:
            if _normalize(doc.get("title")) == title_key and _normalize(doc.get("provider")) == name_key:
                return doc, "provider_name"

    return None, None


def _record_from_course(course: dict, provider_name: str) -> dict:
    return {
        "external_id": course.get("external_id"),
        "title": course.get("title"),
        "url": course.get("url"),
        "provider": provider_name,
        "designation": course.get("designation") or "",
        "learning_month": course.get("learning_month") or "",
        "category": course.get("category") or "",
        "competency": course.get("competency") or "",
        "description": course.get("description"),
        "duration_minutes": course.get("duration_minutes"),
    }


def _csv_for_courses(courses: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Course Title",
            "Course URL",
            "Designation",
            "Learning Month",
            "Category",
            "Competency",
            "Description",
            "Duration (minutes)",
        ]
    )
    for c in courses:
        writer.writerow(
            [
                c.get("title") or "",
                c.get("url") or "",
                c.get("designation") or "",
                c.get("learning_month") or "",
                c.get("category") or "",
                c.get("competency") or "",
                c.get("description") or "Step2 reimport",
                c.get("duration_minutes") or "",
            ]
        )
    return buf.getvalue().encode("utf-8")


async def _upload(name: str, raw: bytes) -> StarletteUploadFile:
    return StarletteUploadFile(
        filename=name,
        file=io.BytesIO(raw),
        headers=Headers({"content-type": "text/csv"}),
    )


async def main() -> None:
    await create_database_indexes()

    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    import_engine_service._record_history = AsyncMock(return_value="step2-history")
    import_engine_service._notify_import_result = AsyncMock(return_value=None)

    missing_before = await database.learning_courses.count_documents(MISSING)
    print(f"missing_provider_id before backfill call: {missing_before}")

    backfill = await managed_learning_service.backfill_missing_provider_ids()
    print("=== Backfill result ===")
    print(backfill)

    # Prefer real LinkedIn Learning courses that originated as managed/excel imports
    # and have no URL (the classic legacy collision shape).
    courses = await database.learning_courses.find(
        {
            "provider": "LinkedIn Learning",
            "title": {"$regex": r".+\S.+"},
            "designation": {"$regex": r".+\S.+"},
            "learning_month": {"$regex": r".+\S.+"},
            "category": {"$regex": r".+\S.+"},
            "competency": {"$regex": r".+\S.+"},
            "course_key": {"$exists": True},
            "$or": [{"url": None}, {"url": ""}, {"url": {"$exists": False}}],
        }
    ).limit(3).to_list(3)

    if len(courses) < 3:
        courses = await database.learning_courses.find(
            {
                "provider": "LinkedIn Learning",
                "title": {"$regex": r".+\S.+"},
                "designation": {"$regex": r".+\S.+"},
                "course_key": {"$exists": True},
            }
        ).limit(3).to_list(3)

    if len(courses) < 3:
        raise SystemExit(f"Need 3 real courses for verification; found {len(courses)}")

    provider = await managed_learning_service._ensure_provider(courses[0].get("provider"))
    assert provider is not None
    provider_id = str(provider["_id"])
    original_provider_ids = {str(c["_id"]): c.get("provider_id") for c in courses}

    print("\n=== Selected real courses ===")
    for c in courses:
        print(f"  id={c['_id']} title={c.get('title')!r}")
        print(f"    course_key={c.get('course_key')}")

    # Recreate legacy condition: strip provider_id (and leave no external_id/url match).
    ids = [c["_id"] for c in courses]
    await database.learning_courses.update_many(
        {"_id": {"$in": ids}},
        {"$unset": {"provider_id": "", "external_id": ""}},
    )
    # Reload after strip
    courses = await database.learning_courses.find({"_id": {"$in": ids}}).to_list(3)

    # BEFORE: old match logic cannot see them → unique course_key collision on insert
    before_failed = 0
    before_matched = 0
    for c in courses:
        record = _record_from_course(c, provider.get("name"))
        matched, method = await _old_match_existing(record, provider)
        if matched:
            before_matched += 1
            print(f"  OLD match unexpected hit via {method} for {c.get('title')!r}")
            continue
        key = c.get("course_key") or _course_key(
            provider=provider.get("name"),
            designation=c.get("designation") or "",
            learning_month=c.get("learning_month") or "",
            category=c.get("category") or "",
            competency=c.get("competency") or "",
            title=c.get("title") or "",
            url=c.get("url") or None,
        )
        if await database.learning_courses.find_one({"course_key": key}):
            before_failed += 1

    print(f"\nBEFORE (legacy strip): would_match={before_matched} would_fail_on_unique_index={before_failed}")
    assert before_failed == 3, before_failed
    assert before_matched == 0, before_matched

    # course_key fallback should already find them even without provider_id
    for c in courses:
        record = _record_from_course(c, provider.get("name"))
        matched, method = await import_engine_service._match_existing(record, provider)
        assert matched is not None and str(matched["_id"]) == str(c["_id"])
        assert method == "course_key", method
        print(f"OK course_key fallback matched {c.get('title')!r}")

    # Excel re-import via Import Engine
    raw = _csv_for_courses(courses)
    upload = await _upload("step2-legacy-reimport.csv", raw)
    preview = await import_engine_service.preview_import(
        FAKE_USER,
        upload,
        provider_id=provider_id,
        provider_name=provider.get("name"),
    )
    print("\n=== Preview ===")
    print(
        f"valid={preview['valid']} new={preview['new_courses']} "
        f"updated={preview['updated_courses']} invalid={preview['invalid_rows']}"
    )
    for row in preview["rows"]:
        print(f"  row {row['row']}: status={row['status']} match={row.get('match_method')} title={row.get('title')!r}")

    assert preview["valid"], preview
    assert preview["updated_courses"] == 3, preview
    assert preview["new_courses"] == 0, preview
    assert all(r.get("match_method") == "course_key" for r in preview["rows"]), preview["rows"]

    upload2 = await _upload("step2-legacy-reimport.csv", raw)
    commit = await import_engine_service.commit_import(
        FAKE_USER,
        upload2,
        provider_id=provider_id,
        provider_name=provider.get("name"),
        missing_action="keep",
    )
    after_failed = len(commit.get("errors") or [])
    print("\n=== Commit ===")
    print(commit["message"])
    print(f"imported={commit['imported']} updated={commit['updated']} failed={after_failed}")
    assert commit["updated"] == 3, commit
    assert commit["imported"] == 0, commit
    assert after_failed == 0, commit["errors"]

    for c in courses:
        refreshed = await database.learning_courses.find_one({"_id": c["_id"]})
        assert refreshed.get("provider_id") == provider_id, refreshed.get("provider_id")

    # Restore any original provider_id that differed (shouldn't, but be safe)
    for course_id, original in original_provider_ids.items():
        if original and original != provider_id:
            await database.learning_courses.update_one(
                {"_id": ObjectId(course_id)},
                {"$set": {"provider_id": original}},
            )

    missing_after = await database.learning_courses.count_documents(MISSING)
    print("\n========== STEP 2 REPORT ==========")
    print(f"courses backfilled this run: {backfill['backfilled']} (before={backfill['before']}, after={backfill['after']})")
    print(f"missing_provider_id now: {missing_after}")
    print(f"repeat import failed-row count BEFORE: {before_failed}")
    print(f"repeat import failed-row count AFTER:  {after_failed}")
    print("STEP 2 VERIFICATION PASSED")

    app.dependency_overrides.clear()


if __name__ == "__main__":
    asyncio.run(main())
