"""E2E verification for Import Engine single-course create/update (Step 1).

Creates a provider + course via POST /api/learning/import/courses, asserts
provider_id is set, then confirms _match_existing finds it by provider+title
and by url. Cleans up afterwards.

Run from backend/:  python scripts/e2e_import_single_course_test.py
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import httpx

from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import get_current_user
from app.main import app
from app.services.import_engine_service import import_engine_service
from app.services.provider_service import provider_service

FAKE_USER = CurrentUser(
    id="step1-e2e-tester",
    email="step1-e2e@test.local",
    full_name="Step1 E2E Tester",
    role="super_admin",
    access_token="test",
)

PROVIDER_NAME = "Step1 Import Engine Provider"
COURSE_TITLE = "Step1 Single Course Create"
COURSE_URL = "https://example.com/step1-single-course"


async def main() -> None:
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    provider_service._notify = AsyncMock(return_value=None)
    provider_service._create_audit_log = AsyncMock(return_value=None)

    provider_id = None
    course_id = None

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        try:
            create_provider = await client.post(
                "/api/learning/providers",
                json={
                    "name": PROVIDER_NAME,
                    "provider_type": "manual",
                    "import_method": "excel",
                    "active": True,
                },
            )
            assert create_provider.status_code in (200, 201), create_provider.text
            provider = create_provider.json()["provider"]
            provider_id = provider["id"]
            print(f"OK provider created id={provider_id}")

            create_course = await client.post(
                "/api/learning/import/courses",
                json={
                    "provider_id": provider_id,
                    "title": COURSE_TITLE,
                    "url": COURSE_URL,
                    "designation": "Software Engineer",
                    "learning_month": "2026-08",
                    "category": "Cloud",
                    "competency": "Azure",
                    "description": "Step 1 verification course",
                    "duration_minutes": 45,
                    "external_id": "step1-ext-1",
                    "tags": ["azure", "fundamentals"],
                },
            )
            assert create_course.status_code in (200, 201), create_course.text
            course = create_course.json()["course"]
            course_id = course["id"]
            print(f"OK course created id={course_id}")

            assert course.get("provider_id") == provider_id, (
                f"provider_id missing/wrong: {course.get('provider_id')!r}"
            )
            assert course.get("course_key"), "course_key was not set"
            assert course.get("hierarchy_key"), "hierarchy_key was not set"
            print(f"OK provider_id={course['provider_id']}")
            print(f"OK course_key={course['course_key']}")

            raw = await database.learning_courses.find_one(
                {"_id": __import__("bson").ObjectId(course_id)}
            )
            assert raw is not None
            assert raw.get("provider_id") == provider_id
            print("OK DB document has provider_id")

            provider_doc = await database.learning_providers.find_one(
                {"_id": __import__("bson").ObjectId(provider_id)}
            )
            matched, method = await import_engine_service._match_existing(
                {
                    "external_id": "step1-ext-1",
                    "title": COURSE_TITLE,
                    "url": COURSE_URL,
                    "provider": PROVIDER_NAME,
                },
                provider_doc,
            )
            assert matched is not None, "Engine matching returned None"
            assert str(matched["_id"]) == course_id
            assert method == "external_id"
            print(f"OK _match_existing by external_id -> {method}")

            matched_url, method_url = await import_engine_service._match_existing(
                {
                    "title": COURSE_TITLE,
                    "url": COURSE_URL,
                    "provider": PROVIDER_NAME,
                },
                provider_doc,
            )
            assert matched_url is not None and str(matched_url["_id"]) == course_id
            assert method_url == "url"
            print(f"OK _match_existing by url -> {method_url}")

            matched_name, method_name = await import_engine_service._match_existing(
                {
                    "title": COURSE_TITLE,
                    "provider": PROVIDER_NAME,
                },
                provider_doc,
            )
            assert matched_name is not None and str(matched_name["_id"]) == course_id
            assert method_name == "provider_name"
            print(f"OK _match_existing by provider+title -> {method_name}")

            update = await client.put(
                f"/api/learning/import/courses/{course_id}",
                json={"description": "Updated Step 1 description", "duration_minutes": 60},
            )
            assert update.status_code == 200, update.text
            updated = update.json()["course"]
            assert updated["provider_id"] == provider_id
            assert updated["duration_minutes"] == 60
            assert updated["description"] == "Updated Step 1 description"
            print("OK update keeps provider_id and applies field changes")

            conflict = await client.post(
                "/api/learning/import/courses",
                json={
                    "provider_id": provider_id,
                    "title": COURSE_TITLE,
                    "url": COURSE_URL,
                    "designation": "Software Engineer",
                    "learning_month": "2026-08",
                    "category": "Cloud",
                    "competency": "Azure",
                },
            )
            assert conflict.status_code == 409, conflict.text
            print("OK duplicate create correctly returns 409")

            print("\nSTEP 1 VERIFICATION PASSED")
        finally:
            if course_id:
                from bson import ObjectId

                await database.learning_courses.delete_one({"_id": ObjectId(course_id)})
            if provider_id:
                from bson import ObjectId

                await database.learning_providers.delete_one({"_id": ObjectId(provider_id)})
            # Also clean any leftover by name if create failed mid-way.
            await database.learning_providers.delete_many({"name": PROVIDER_NAME})
            await database.learning_courses.delete_many({"title": COURSE_TITLE})
            app.dependency_overrides.clear()


if __name__ == "__main__":
    asyncio.run(main())
