"""Microsoft Learn Catalog API integration (US-065, US-066, US-072).

Free, unauthenticated, metadata-only API. We never proxy Microsoft's actual
lesson content — only title/summary/duration/url metadata, and every "Start
Learning" action redirects the employee out to learn.microsoft.com.

Docs (undocumented but stable, publicly used): each `type` query param
returns a JSON object keyed by that type, e.g.:
    GET https://learn.microsoft.com/api/catalog/?type=learningPaths
    -> {"learningPaths": [ {uid, title, summary, url, duration_in_minutes,
                             levels, roles, products, subjects, last_modified,
                             number_of_children, modules, ...}, ... ]}
Also supports type=modules and type=certifications.

Whole catalog is cached in-process (thousands of items, ~5-15MB of JSON) with
a TTL so we don't hammer Microsoft on every request. Search/filter is done
locally over the cached list.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from loguru import logger

CATALOG_BASE_URL = "https://learn.microsoft.com/api/catalog/"

# Maps our internal course_type -> (MS query param value, MS response key, MS item "type")
CATALOG_TYPES: dict[str, tuple[str, str]] = {
    "learningPath": ("learningPaths", "learningPaths"),
    "module": ("modules", "modules"),
    "certification": ("certifications", "certifications"),
}

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours — catalog changes infrequently

_cache: dict[str, dict[str, Any]] = {}  # course_type -> {"items": [...], "fetched_at": ts}
_locks: dict[str, asyncio.Lock] = {t: asyncio.Lock() for t in CATALOG_TYPES}


def _normalize(item: dict, course_type: str) -> dict:
    return {
        "uid": item.get("uid"),
        "type": course_type,
        "title": item.get("title") or "Untitled",
        "summary": item.get("summary") or "",
        "url": item.get("url"),
        "duration_minutes": item.get("duration_in_minutes") or 0,
        "levels": item.get("levels") or [],
        "roles": item.get("roles") or [],
        "products": item.get("products") or [],
        "subjects": item.get("subjects") or [],
        "last_modified": item.get("last_modified"),
        "icon_url": item.get("icon_url"),
        "popularity": item.get("popularity") or 0,
        "number_of_children": item.get("number_of_children"),
        "certification_type": item.get("certification_type") if course_type == "certification" else None,
    }


async def _fetch_type(course_type: str) -> list[dict]:
    query_value, response_key = CATALOG_TYPES[course_type]
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.get(CATALOG_BASE_URL, params={"type": query_value, "locale": "en-us"})
        response.raise_for_status()
        payload = response.json()
    raw_items = payload.get(response_key) or []
    return [_normalize(item, course_type) for item in raw_items if item.get("uid")]


async def _get_cached(course_type: str) -> list[dict]:
    entry = _cache.get(course_type)
    now = time.monotonic()
    if entry and (now - entry["fetched_at"]) < CACHE_TTL_SECONDS:
        return entry["items"]

    lock = _locks.setdefault(course_type, asyncio.Lock())
    async with lock:
        # Re-check after acquiring the lock — another request may have refreshed it.
        entry = _cache.get(course_type)
        now = time.monotonic()
        if entry and (now - entry["fetched_at"]) < CACHE_TTL_SECONDS:
            return entry["items"]
        try:
            items = await _fetch_type(course_type)
            _cache[course_type] = {"items": items, "fetched_at": now}
            return items
        except Exception as exc:  # pragma: no cover - network dependent
            logger.error(f"Microsoft Learn catalog fetch failed for type={course_type}: {exc}")
            if entry:
                return entry["items"]  # serve stale cache rather than fail the request
            return []


async def get_catalog(course_types: tuple[str, ...] = ("learningPath", "module", "certification")) -> list[dict]:
    """Returns the merged, cached catalog for the requested types."""
    results = await asyncio.gather(*(_get_cached(t) for t in course_types))
    merged: list[dict] = []
    for chunk in results:
        merged.extend(chunk)
    return merged


async def refresh_catalog() -> dict[str, int]:
    """Force a refresh of all catalog types. Returns counts per type."""
    counts: dict[str, int] = {}
    for course_type in CATALOG_TYPES:
        _cache.pop(course_type, None)
        items = await _get_cached(course_type)
        counts[course_type] = len(items)
    return counts


from app.services.search_taxonomy import search_and_rank_items


def _matches_query(item: dict, q: str) -> bool:
    q = q.lower()
    haystacks = [
        item.get("title") or "",
        item.get("summary") or "",
        " ".join(item.get("roles") or []),
        " ".join(item.get("products") or []),
        " ".join(item.get("subjects") or []),
    ]
    return any(q in h.lower() for h in haystacks)


async def search_catalog(
    *,
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    product: str | None = None,
    course_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """US-065, US-072: browse/search/filter with pagination."""
    types = (course_type,) if course_type in CATALOG_TYPES else tuple(CATALOG_TYPES.keys())
    catalog = await get_catalog(types)

    filtered = catalog
    if q and q.strip():
        filtered = search_and_rank_items(filtered, q.strip())

    if role and role.strip():
        role_lower = role.strip().lower()
        filtered = [item for item in filtered if role_lower in [r.lower() for r in item.get("roles") or []]]
    if level and level.strip():
        level_lower = level.strip().lower()
        filtered = [item for item in filtered if level_lower in [lv.lower() for lv in item.get("levels") or []]]
    if product and product.strip():
        product_lower = product.strip().lower()
        filtered = [item for item in filtered if product_lower in [p.lower() for p in item.get("products") or []]]

    if not (q and q.strip()):
        filtered = sorted(filtered, key=lambda item: (-(item.get("popularity") or 0), item.get("title") or ""))

    total = len(filtered)
    start = max(0, (page - 1) * page_size)
    end = start + page_size
    page_items = filtered[start:end]
    pages = max(1, (total + page_size - 1) // page_size)

    return {
        "courses": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


async def get_course_by_uid(uid: str) -> dict | None:
    """US-066: full metadata for a single course/path/certification."""
    catalog = await get_catalog()
    for item in catalog:
        if item.get("uid") == uid:
            return item
    return None


async def get_courses_by_uids(uids: list[str]) -> list[dict]:
    wanted = set(uids)
    if not wanted:
        return []
    catalog = await get_catalog()
    return [item for item in catalog if item.get("uid") in wanted]


async def get_facets() -> dict:
    """Distinct roles/levels/products for building filter dropdowns (US-065)."""
    catalog = await get_catalog()
    roles: set[str] = set()
    levels: set[str] = set()
    products: set[str] = set()
    for item in catalog:
        roles.update(item.get("roles") or [])
        levels.update(item.get("levels") or [])
        products.update(item.get("products") or [])
    return {
        "roles": sorted(roles),
        "levels": sorted(levels),
        "products": sorted(products),
    }


async def find_courses_for_keywords(keywords: list[str], *, per_keyword: int = 6, limit: int = 40) -> list[dict]:
    """Used by the AI services to build a real, non-hallucinated candidate pool."""
    catalog = await get_catalog()
    seen: dict[str, dict] = {}
    for keyword in keywords:
        if not keyword or not keyword.strip():
            continue
        matches = search_and_rank_items(catalog, keyword.strip())
        for item in matches[:per_keyword]:
            seen[item["uid"]] = item
        if len(seen) >= limit:
            break
    return list(seen.values())[:limit]
