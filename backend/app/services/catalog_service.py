"""Unified facade over every live, external course catalog we plug into the
Learning module. Nothing about a course is ever stored on our side — every
call here fetches (or reads the in-process cache of) the provider's live
catalog, exactly like ms_learn_service.py did on its own. Adding a new
provider later means adding one module here and one entry in SOURCES; no
frontend or database changes required.

Current sources:
  - "microsoft_learn" -> ms_learn_service (technical: paths/modules/certs)
  - "coursera"         -> coursera_service (industry soft skills)
"""

from __future__ import annotations

from app.services import coursera_service, ms_learn_service

SOURCES: tuple[str, ...] = ("microsoft_learn", "coursera")


def source_of(uid: str) -> str:
    return "coursera" if uid.startswith("coursera:") else "microsoft_learn"


async def get_course_by_uid(uid: str) -> dict | None:
    if source_of(uid) == "coursera":
        return await coursera_service.get_course_by_uid(uid)
    return await ms_learn_service.get_course_by_uid(uid)


async def search_catalog(
    *,
    source: str = "microsoft_learn",
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    product: str | None = None,
    course_type: str | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    if source == "coursera":
        return await coursera_service.search_catalog(q=q, category=category, page=page, page_size=page_size)
    return await ms_learn_service.search_catalog(
        q=q, role=role, level=level, product=product, course_type=course_type, page=page, page_size=page_size
    )


async def get_facets(source: str = "microsoft_learn") -> dict:
    if source == "coursera":
        return {"categories": coursera_service.get_categories()}
    return await ms_learn_service.get_facets()


async def find_courses_for_keywords(
    keywords: list[str],
    *,
    per_keyword: int = 4,
    limit: int = 40,
    sources: tuple[str, ...] = SOURCES,
) -> list[dict]:
    """Merges real, live candidates from every requested source. This is what
    lets AI recommendations and skill-gap course matching surface an industry
    soft-skills course (Coursera) right alongside a Microsoft Learn technical
    course for the same employee — whichever is the better real match."""
    results: list[dict] = []
    if "microsoft_learn" in sources:
        results += await ms_learn_service.find_courses_for_keywords(keywords, per_keyword=per_keyword, limit=limit)
    if "coursera" in sources:
        results += await coursera_service.find_courses_for_keywords(
            keywords, per_keyword=max(2, per_keyword // 2), limit=limit
        )
    seen: dict[str, dict] = {}
    for course in results:
        seen.setdefault(course["uid"], course)
    return list(seen.values())[:limit]
