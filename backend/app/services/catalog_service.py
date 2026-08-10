"""Unified facade over every live, external course catalog we plug into the
Learning module.

Phase 1 refactor: this module now delegates to the dynamic catalog service,
which resolves providers from the `learning_providers` collection instead of
hardcoded sources. Adding a new provider (Udemy, Skillsoft, Company Academy,
...) requires zero code changes — only a provider record + imported courses.

The module keeps its original function signatures so existing callers
(learning_service, learning_ai_service, learning_path_service, etc.) keep
working unchanged.
"""

from __future__ import annotations

from app.services import coursera_service, ms_learn_service
from app.services.dynamic_catalog_service import dynamic_catalog_service
from app.services.managed_learning_service import MANAGED_SOURCE, managed_learning_service

SOURCES: tuple[str, ...] = (MANAGED_SOURCE, "microsoft_learn", "coursera")


def source_of(uid: str) -> str:
    return dynamic_catalog_service.source_of(uid)


async def get_course_by_uid(uid: str) -> dict | None:
    return await dynamic_catalog_service.get_course_by_uid(uid)


async def search_catalog(
    *,
    source: str = "microsoft_learn",
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    product: str | None = None,
    course_type: str | None = None,
    category: str | None = None,
    provider: str | None = None,
    designation: str | None = None,
    learning_month: str | None = None,
    competency: str | None = None,
    archived: bool | None = None,
    sort_by: str | None = "newest",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    return await dynamic_catalog_service.search_catalog(
        source=source,
        q=q,
        role=role,
        level=level,
        product=product,
        course_type=course_type,
        category=category,
        provider=provider,
        designation=designation,
        learning_month=learning_month,
        competency=competency,
        archived=archived,
        sort_by=sort_by,
        page=page,
        page_size=page_size,
    )


async def get_facets(source: str = "microsoft_learn") -> dict:
    return await dynamic_catalog_service.get_facets(source)


async def find_courses_for_keywords(
    keywords: list[str],
    *,
    per_keyword: int = 4,
    limit: int = 40,
    sources: tuple[str, ...] = SOURCES,
    use_ai: bool = False,
) -> list[dict]:
    """Merges real, live candidates from every requested source."""
    return await dynamic_catalog_service.find_courses_for_keywords(
        keywords,
        per_keyword=per_keyword,
        limit=limit,
        sources=sources,
        use_ai=use_ai,
    )


async def get_catalog_sources() -> list[dict]:
    """Get all available catalog sources for the frontend (provider-agnostic)."""
    return await dynamic_catalog_service.get_catalog_sources()
