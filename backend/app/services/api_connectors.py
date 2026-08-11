"""Legacy provider connectors for the universal import engine.

Coursera and Microsoft Learn predate the generic config-driven API importer.
Their APIs need special handling that is not representable through a single
generic GET + JSON path mapping:

* Coursera — multi-page pagination, English-language filtering, and course
  URL construction from ``slug``.
* Microsoft Learn — three separate catalog type fetches (learningPaths,
  modules, certifications) merged into one catalog.

Each connector isolates that logic behind ``fetch_courses()`` so the import
engine stays provider-agnostic. The matching ``learning_providers`` document
still stores a representative ``api_config`` (endpoint / auth / mapping) so
the Edit UI is never blank, plus ``api_connector`` so the UI can disclose
that sync is connector-managed.

New providers added from the UI go through the generic importer
(``generic_api_provider_service``) and never touch this module.
"""

from __future__ import annotations

from typing import Any

from app.services.generic_api_provider_service import API_MAX_COURSES


class CourseraConnector:
    """Adapter that feeds the Coursera catalog into the universal import engine."""

    async def fetch_courses(self, *, max_items: int | None = None) -> list[dict]:
        from app.services import coursera_service as cs

        items, _ = await cs._get_cached_catalog(force_refresh=False)
        cap = max_items if max_items is not None else API_MAX_COURSES
        if cap and len(items) > cap:
            items = items[:cap]
        return [self._to_record(item) for item in items]

    def _to_record(self, item: dict) -> dict:
        return {
            "external_id": item.get("uid"),
            "title": item.get("title"),
            "url": item.get("url"),
            "description": item.get("summary"),
            "duration_minutes": item.get("duration_minutes"),
            "category": item.get("category"),
            "competency": "",
            "designation": "",
            "learning_month": "",
            "instructor": None,
            "tags": [],
            "skills": item.get("subjects") or [],
            "difficulty": "",
        }


class MicrosoftLearnConnector:
    """Adapter that feeds the Microsoft Learn catalog into the universal import engine."""

    async def fetch_courses(self, *, max_items: int | None = None) -> list[dict]:
        from app.services import ms_learn_service as ms

        items = await ms.get_catalog()
        cap = max_items if max_items is not None else API_MAX_COURSES
        if cap and len(items) > cap:
            items = items[:cap]
        return [self._to_record(item) for item in items]

    def _to_record(self, item: dict) -> dict:
        subjects = item.get("subjects") or []
        return {
            "external_id": item.get("uid"),
            "title": item.get("title"),
            "url": item.get("url"),
            "description": item.get("summary"),
            "duration_minutes": item.get("duration_minutes"),
            "category": subjects[0] if subjects else "",
            "competency": "",
            "designation": "",
            "learning_month": "",
            "instructor": None,
            "tags": [],
            "skills": subjects,
            "difficulty": (item.get("levels") or [None])[0] if item.get("levels") else "",
        }
