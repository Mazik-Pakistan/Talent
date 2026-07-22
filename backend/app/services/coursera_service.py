"""Coursera Catalog API integration — industry soft-skills courses (US-065/US-072
extension). Mirrors ms_learn_service.py exactly: everything is fetched live from
Coursera's public catalog API and cached in-process with a TTL. Nothing about a
specific course is ever written to our own database — only OUR usage of it
(enrollments/bookmarks/assignments/certificates) is stored, exactly like the
Microsoft Learn integration. New Coursera courses show up automatically on the
next cache refresh; nothing to maintain on our side.

This implementation does NOT use the deprecated q=search endpoint. Instead it
fetches the entire paginated catalog, stores it in memory, and performs all
search and filtering locally. The public API remains identical to the previous
version, ensuring a drop-in replacement.
"""

from __future__ import annotations

import asyncio
import difflib
import re
import time
from typing import Any

import httpx
from loguru import logger

CATALOG_URL = "https://api.coursera.org/api/courses.v1"
# Request only the fields we actually use to reduce bandwidth.
FIELDS = "description,shortDescription,photoUrl,workload,courseType,partnerIds,primaryLanguages"

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours, same cadence as Microsoft Learn
RESULTS_PER_CATEGORY = 12

# Industry-standard soft-skill categories. Each maps to search terms used for
# local categorization of courses fetched from the full catalog.
SOFT_SKILL_CATEGORIES: dict[str, list[str]] = {
    "Communication": ["communication skills", "business communication"],
    "Leadership": ["leadership", "leadership and management"],
    "Teamwork & Collaboration": ["teamwork", "team collaboration"],
    "Time Management": ["time management", "productivity"],
    "Emotional Intelligence": ["emotional intelligence"],
    "Critical Thinking & Problem Solving": ["critical thinking", "problem solving"],
    "Negotiation": ["negotiation skills"],
    "Public Speaking & Presentation": ["public speaking", "presentation skills"],
    "Conflict Resolution": ["conflict resolution", "conflict management"],
    "Customer Service": ["customer service"],
    "Change Management & Adaptability": ["change management", "adaptability at work"],
    "Creativity & Innovation": ["creativity", "innovation"],
    "Stress Management & Resilience": ["stress management", "resilience at work"],
    "Networking": ["professional networking"],
    "Coaching & Mentoring": ["coaching and mentoring"],
    "Diversity, Equity & Inclusion": ["diversity equity and inclusion"],
    "Decision Making": ["decision making"],
    "Business Etiquette & Professionalism": ["business etiquette", "workplace professionalism"],
}

# In‑memory cache: all courses, indexed by uid, and timestamp.
_cache: dict[str, Any] = {
    "items": [],           # list of normalized course dicts
    "by_uid": {},          # uid -> course dict for O(1) lookup
    "fetched_at": 0.0,     # monotonic timestamp of last successful fetch
}
_cache_lock = asyncio.Lock()

_slug_re = re.compile(r"[^a-z0-9]+")


def get_categories() -> list[str]:
    """Return the list of known soft‑skill category names."""
    return list(SOFT_SKILL_CATEGORIES.keys())


def _parse_workload_minutes(workload: str | None) -> int | None:
    """Coursera 'workload' is a free-text string like '4-6 hours/week' or
    '10 hours'. We extract a rough total-minutes estimate; None if unparseable."""
    if not workload:
        return None
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", workload)]
    if not numbers:
        return None
    avg_hours = sum(numbers[:2]) / len(numbers[:2])
    if "week" in workload.lower():
        avg_hours *= 4  # rough per-course estimate assuming ~4 week course
    return round(avg_hours * 60)


def _assign_category(course: dict) -> str | None:
    """Determine the best‑matching soft‑skill category for a course based on its
    title, description, and slug. Returns the first category whose any keyword
    is found (case‑insensitive substring). If none match, returns None."""
    title = (course.get("name") or "").lower()
    desc = (course.get("description") or course.get("shortDescription") or "").lower()
    slug = (course.get("slug") or "").lower()
    haystack = f"{title} {desc} {slug}"

    for cat, terms in SOFT_SKILL_CATEGORIES.items():
        for term in terms:
            if term.lower() in haystack:
                return cat
    return None


def _normalize(raw: dict) -> dict | None:
    """Convert a raw Coursera course object into our internal normalized format,
    including category assignment."""
    slug = raw.get("slug")
    name = raw.get("name")
    if not slug or not name:
        return None

    category = _assign_category(raw)
    if category is None:
        # If no category matches, we still keep the course but with category None;
        # it will be excluded from category‑filtered results but accessible via search.
        category = "Uncategorized"

    return {
        "uid": f"coursera:{slug}",
        "type": "course",
        "source": "coursera",
        "title": name,
        "summary": raw.get("description") or raw.get("shortDescription") or "",
        "url": f"https://www.coursera.org/learn/{slug}",
        "duration_minutes": _parse_workload_minutes(raw.get("workload")),
        "levels": [],
        "roles": [],
        "products": [],
        "subjects": [category] if category != "Uncategorized" else [],
        "category": category,
        "last_modified": None,
        "icon_url": raw.get("photoUrl"),
        "popularity": 0,
        "number_of_children": None,
        "certification_type": None,
    }


async def _fetch_page(client: httpx.AsyncClient, start: int, limit: int = 100) -> tuple[list[dict], dict | None]:
    """Fetch one page of the catalog. Returns (elements, paging_metadata)."""
    params = {
        "start": start,
        "limit": limit,
        "fields": FIELDS,
    }
    # Exponential backoff retry loop
    attempt = 0
    max_attempts = 5
    base_delay = 1.0
    while True:
        try:
            resp = await client.get(CATALOG_URL, params=params, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()
            elements = data.get("elements", [])
            paging = data.get("paging")
            return elements, paging
        except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.ConnectError) as exc:
            attempt += 1
            if attempt >= max_attempts:
                logger.error(f"Failed to fetch catalog page start={start}: {exc}")
                raise
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(f"Fetch page start={start} failed (attempt {attempt}), retrying in {delay:.1f}s")
            await asyncio.sleep(delay)


async def _fetch_all_courses() -> list[dict]:
    """Fetch the entire Coursera catalog using pagination. Returns a list of
    normalized course dicts."""
    all_raw = []
    start = 0
    limit = 100  # sensible page size

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            elements, paging = await _fetch_page(client, start, limit)
            if not elements:
                break
            all_raw.extend(elements)
            # If pagination metadata provides a 'next' URL, use it; otherwise increment start.
            if paging and "next" in paging:
                # The 'next' URL may be absolute; we could follow it, but it's simpler to
                # increment start by limit. The API also provides 'total' and 'start' but
                # we rely on empty elements to stop.
                # To be safe, if 'next' exists but we can't parse it, we fall back to start+limit.
                try:
                    # Parse the 'start' parameter from the next URL (if relative)
                    # The next URL often looks like: /api/courses.v1?start=100&limit=100
                    import urllib.parse
                    parsed = urllib.parse.urlparse(paging["next"])
                    qs = urllib.parse.parse_qs(parsed.query)
                    if "start" in qs:
                        start = int(qs["start"][0])
                        continue
                except Exception:
                    pass
            start += limit

    # Deduplicate by slug (in case the API returns duplicates)
    seen_slugs = set()
    unique_raw = []
    for raw in all_raw:
        slug = raw.get("slug")
        if slug and slug not in seen_slugs:
            seen_slugs.add(slug)
            unique_raw.append(raw)

    # Normalize and assign categories
    normalized = []
    for raw in unique_raw:
        norm = _normalize(raw)
        if norm:
            normalized.append(norm)
    return normalized


async def _get_cached_catalog(force_refresh: bool = False) -> tuple[list[dict], dict[str, dict]]:
    """Return the cached catalog (items and by_uid dict), fetching fresh if
    expired or force_refresh is True. Thread‑safe."""
    global _cache
    now = time.monotonic()
    async with _cache_lock:
        if not force_refresh and _cache["items"] and (now - _cache["fetched_at"]) < CACHE_TTL_SECONDS:
            return _cache["items"], _cache["by_uid"]

        logger.info("Coursera catalog cache expired or empty, fetching fresh...")
        try:
            items = await _fetch_all_courses()
            by_uid = {item["uid"]: item for item in items}
            _cache["items"] = items
            _cache["by_uid"] = by_uid
            _cache["fetched_at"] = now
            logger.info(f"Coursera catalog refreshed: {len(items)} courses")
        except Exception as exc:
            logger.error(f"Failed to refresh Coursera catalog: {exc}")
            # If we have stale cache, keep it; otherwise re-raise.
            if not _cache["items"]:
                raise
            # Still return whatever we have
        return _cache["items"], _cache["by_uid"]


async def get_catalog(categories: tuple[str, ...] | None = None) -> list[dict]:
    """Merged, cached soft-skills catalog for the requested categories (all by default)."""
    items, _ = await _get_cached_catalog()
    if categories is None:
        return items
    wanted = set(categories)
    return [c for c in items if c.get("category") in wanted]


async def refresh_catalog() -> dict[str, int]:
    """Force a full refresh of the catalog and return per‑category counts."""
    items, _ = await _get_cached_catalog(force_refresh=True)
    counts: dict[str, int] = {}
    for cat in SOFT_SKILL_CATEGORIES:
        counts[cat] = sum(1 for c in items if c.get("category") == cat)
    # Also count uncategorized
    counts["Uncategorized"] = sum(1 for c in items if c.get("category") == "Uncategorized")
    return counts


def _matches_query(item: dict, q: str) -> bool:
    """Simple case‑insensitive substring match against title, summary, slug, and category."""
    q_lower = q.lower()
    haystacks = [
        item.get("title") or "",
        item.get("summary") or "",
        item.get("slug") or "",  # we don't store slug directly, but we can extract from uid
        item.get("category") or "",
    ]
    # Extract slug from uid (coursera:{slug})
    uid = item.get("uid", "")
    if uid.startswith("coursera:"):
        haystacks.append(uid.split(":", 1)[1])
    return any(q_lower in h.lower() for h in haystacks)


def _score_course(item: dict, q: str) -> float:
    """Compute a fuzzy relevance score between a course and a query string.
    Returns a float between 0 and 1, where 1 is a perfect match."""
    q_lower = q.lower()
    # Combine fields
    uid = item.get("uid", "")
    slug = uid.split(":", 1)[1] if uid.startswith("coursera:") else ""
    text = " ".join([
        item.get("title") or "",
        item.get("summary") or "",
        slug,
        item.get("category") or "",
    ]).lower()

    # Exact substring match gives a high baseline
    if q_lower in text:
        return 0.9 + 0.1 * (len(q) / max(len(text), 1))  # slight boost for short queries
    # Otherwise use difflib ratio
    ratio = difflib.SequenceMatcher(None, q_lower, text).ratio()
    return ratio


async def search_catalog(
    *,
    q: str | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Search the local catalog with optional category filter and pagination."""
    items, _ = await _get_cached_catalog()

    # Filter by category if given
    if category is not None:
        items = [c for c in items if c.get("category") == category]

    # Apply search query (if any) using fuzzy scoring, then sort by score
    if q and q.strip():
        query = q.strip()
        scored = [(item, _score_course(item, query)) for item in items]
        # Keep only items with score > 0.1 to filter out completely unrelated
        scored = [(item, score) for item, score in scored if score > 0.1]
        scored.sort(key=lambda x: x[1], reverse=True)
        items = [item for item, _ in scored]
    else:
        # If no query, sort by title
        items = sorted(items, key=lambda c: c.get("title") or "")

    total = len(items)
    start = max(0, (page - 1) * page_size)
    end = start + page_size
    page_items = items[start:end]
    pages = max(1, (total + page_size - 1) // page_size)

    return {
        "courses": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


async def get_course_by_uid(uid: str) -> dict | None:
    """Retrieve a course by its uid (coursera:{slug}). Uses the cached catalog;
    does not call the API separately."""
    if not uid.startswith("coursera:"):
        return None
    _, by_uid = await _get_cached_catalog()
    return by_uid.get(uid)


async def find_courses_for_keywords(keywords: list[str], *, per_keyword: int = 4, limit: int = 24) -> list[dict]:
    """Used by the AI service to build a real, non-hallucinated soft-skills
    candidate pool. Searches the local cache using fuzzy matching for each
    keyword, deduplicates, and returns top results."""
    items, _ = await _get_cached_catalog()
    if not items or not keywords:
        return []

    seen: dict[str, dict] = {}
    # For each keyword, get the top per_keyword results based on fuzzy score
    for kw in keywords:
        if not kw or not kw.strip():
            continue
        query = kw.strip()
        scored = [(item, _score_course(item, query)) for item in items]
        scored.sort(key=lambda x: x[1], reverse=True)
        # Take top per_keyword (or fewer if not enough)
        for item, _ in scored[:per_keyword]:
            uid = item["uid"]
            if uid not in seen:
                seen[uid] = item
                if len(seen) >= limit:
                    break
        if len(seen) >= limit:
            break

    return list(seen.values())[:limit]