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
from app.services.recruiter_kb_service import recruiter_kb_service

SOURCES: tuple[str, ...] = ("microsoft_learn", "coursera", "recruiter_kb")


def source_of(uid: str) -> str:
    if uid.startswith("coursera:"):
        return "coursera"
    if uid.startswith("recruiter_kb:"):
        return "recruiter_kb"
    return "microsoft_learn"


async def get_course_by_uid(uid: str) -> dict | None:
    src = source_of(uid)
    if src == "coursera":
        return await coursera_service.get_course_by_uid(uid)
    if src == "recruiter_kb":
        from bson import ObjectId
        from app.core.database import database

        cert_id = uid.split(":", 1)[1]
        if not ObjectId.is_valid(cert_id):
            return None
        doc = await database.recruiter_kb_certifications.find_one({"_id": ObjectId(cert_id)})
        if not doc:
            return None
        courses = await recruiter_kb_service.list_as_catalog_courses(doc.get("recruiter_id"))
        return next((c for c in courses if c["uid"] == uid), None)
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
    if source == "recruiter_kb":
        courses = await recruiter_kb_service.list_as_catalog_courses()
        if q:
            from app.services.search_taxonomy import search_and_rank_items_async

            courses = await search_and_rank_items_async(courses, q)
        if course_type:
            courses = [c for c in courses if c.get("type") == course_type]
        total = len(courses)
        start = (page - 1) * page_size
        return {
            "courses": courses[start : start + page_size],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size) if total else 1,
        }
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
    use_ai: bool = False,
) -> list[dict]:
    """Merges real, live candidates from every requested source. This is what
    lets AI recommendations and skill-gap course matching surface an industry
    soft-skills course (Coursera) right alongside a Microsoft Learn technical
    course for the same employee — whichever is the better real match."""
    results: list[dict] = []
    if "microsoft_learn" in sources:
        results += await ms_learn_service.find_courses_for_keywords(
            keywords, per_keyword=per_keyword, limit=limit, use_ai=use_ai
        )
    if "coursera" in sources:
        results += await coursera_service.find_courses_for_keywords(
            keywords, per_keyword=max(2, per_keyword // 2), limit=limit
        )
    if "recruiter_kb" in sources:
        kb = await recruiter_kb_service.list_as_catalog_courses()
        lowered = [k.lower() for k in keywords if k]
        for course in kb:
            hay = f"{course.get('title') or ''} {' '.join(course.get('products') or [])}".lower()
            if any(k in hay for k in lowered):
                results.append(course)
    seen: dict[str, dict] = {}
    for course in results:
        seen.setdefault(course["uid"], course)
    return list(seen.values())[:limit]
