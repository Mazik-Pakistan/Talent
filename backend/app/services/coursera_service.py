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

from app.core.database import database

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


MAX_CONCURRENT_PAGE_FETCHES = 8


async def _fetch_all_courses() -> list[dict]:
    """Fetch the entire Coursera catalog using pagination. Returns a list of
    normalized course dicts.

    Performance note: the first page is fetched alone so we can read the
    catalog's reported `total` from the paging metadata. Once we know the
    total, every remaining page is fetched concurrently (bounded by
    MAX_CONCURRENT_PAGE_FETCHES) instead of one request at a time, which is
    the main thing that made a cold cache fetch slow. If the API doesn't
    report a `total` for some reason, we transparently fall back to the
    original sequential walk so no pages are ever missed."""
    limit = 100  # sensible page size

    async with httpx.AsyncClient(timeout=30.0) as client:
        first_elements, first_paging = await _fetch_page(client, 0, limit)
        all_raw: list[dict] = list(first_elements)

        total: int | None = None
        if first_paging and "total" in first_paging:
            try:
                total = int(first_paging["total"])
            except (TypeError, ValueError):
                total = None

        if not first_elements:
            pass  # empty catalog / nothing to fetch
        elif total is not None:
            # Fast path: we know exactly how many more pages exist, so fetch
            # them all concurrently instead of awaiting one page at a time.
            remaining_starts = list(range(limit, total, limit))
            semaphore = asyncio.Semaphore(MAX_CONCURRENT_PAGE_FETCHES)

            async def _bounded_fetch(page_start: int) -> list[dict]:
                async with semaphore:
                    elements, _ = await _fetch_page(client, page_start, limit)
                    return elements

            if remaining_starts:
                pages = await asyncio.gather(*(_bounded_fetch(s) for s in remaining_starts))
                for page_elements in pages:
                    all_raw.extend(page_elements)
        else:
            # Fallback path: identical to the original implementation.
            start = limit
            while True:
                elements, paging = await _fetch_page(client, start, limit)
                if not elements:
                    break
                all_raw.extend(elements)
                if paging and "next" in paging:
                    try:
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


_refresh_in_progress = False
_background_refresh_task: asyncio.Task | None = None
_warm_cache_task: asyncio.Task | None = None

# ---------------------------------------------------------------------- #
# Mongo-backed persistence layer.
#
# The dict above is per-process and dies on every restart/redeploy, which
# meant the very first employee to open the Coursera tab after a restart
# paid for a full paginated catalog fetch (thousands of courses). We now
# also keep the last good snapshot in Mongo so app startup can hydrate the
# in-memory cache instantly (see load_persisted_cache(), called from the
# FastAPI lifespan), and no request ever has to fetch Coursera live unless
# both the in-memory cache AND the DB snapshot are empty/unreachable.
# ---------------------------------------------------------------------- #
_CACHE_DOC_ID = "coursera_catalog"


async def _persist_cache_to_db(items: list[dict]) -> None:
    try:
        await database.learning_catalog_cache.update_one(
            {"_id": _CACHE_DOC_ID},
            {"$set": {"items": items, "updated_at": time.time()}},
            upsert=True,
        )
    except Exception as exc:  # pragma: no cover - persistence is best-effort
        logger.warning(f"Could not persist Coursera catalog snapshot to Mongo: {exc}")


async def load_persisted_cache() -> None:
    """Hydrate the in-memory cache from the last Mongo snapshot. Called once
    at app startup so the process never starts "cold" from the user's point
    of view — worst case they see a slightly stale (but instant) catalog
    while a background refresh brings it up to date."""
    global _cache
    if _cache["items"]:
        return
    try:
        doc = await database.learning_catalog_cache.find_one({"_id": _CACHE_DOC_ID})
    except Exception as exc:  # pragma: no cover - DB may not be reachable yet
        logger.warning(f"Could not load persisted Coursera catalog snapshot: {exc}")
        return
    if not doc or not doc.get("items"):
        return
    async with _cache_lock:
        _cache["items"] = doc["items"]
        _cache["by_uid"] = {item["uid"]: item for item in doc["items"]}
        # Treat the persisted snapshot as already "fetched_at" load time so it
        # is served immediately, but still counts toward the TTL for a
        # background refresh rather than being trusted forever.
        age_seconds = max(0.0, time.time() - (doc.get("updated_at") or 0))
        _cache["fetched_at"] = time.monotonic() - min(age_seconds, CACHE_TTL_SECONDS)
    logger.info(f"Coursera catalog hydrated from Mongo snapshot: {len(doc['items'])} courses")


async def _get_cached_catalog(force_refresh: bool = False) -> tuple[list[dict], dict[str, dict]]:
    """Return the cached catalog (items and by_uid dict).

    Behavior:
      - Fresh cache -> return immediately (unchanged, fast path).
      - Stale cache but we HAVE data -> return the stale data immediately
        (stale-while-revalidate) and kick off a background refresh instead of
        making the caller wait. This is what used to make a random employee's
        click block on a full catalog fetch.
      - No data yet (true cold start) or force_refresh=True -> fetch inline,
        exactly like before. In practice this should now only happen if the
        app-startup warm-up (see warm_cache()) itself failed.
    """
    global _cache, _refresh_in_progress
    now = time.monotonic()

    async with _cache_lock:
        has_data = bool(_cache["items"])
        is_expired = (now - _cache["fetched_at"]) >= CACHE_TTL_SECONDS

        if not force_refresh and has_data and not is_expired:
            return _cache["items"], _cache["by_uid"]

        if not force_refresh and has_data and is_expired:
            if not _refresh_in_progress:
                _refresh_in_progress = True
                asyncio.create_task(_refresh_cache_in_background())
            return _cache["items"], _cache["by_uid"]

    # Cold start or explicit force_refresh: no stale data to fall back to
    # (or caller explicitly wants to wait), so fetch inline like before.
    logger.info("Coursera catalog cache expired or empty, fetching fresh...")
    try:
        items = await _fetch_all_courses()
        by_uid = {item["uid"]: item for item in items}
        async with _cache_lock:
            _cache["items"] = items
            _cache["by_uid"] = by_uid
            _cache["fetched_at"] = time.monotonic()
        logger.info(f"Coursera catalog refreshed: {len(items)} courses")
        await _persist_cache_to_db(items)
    except Exception as exc:
        logger.error(f"Failed to refresh Coursera catalog: {exc}")
        if not _cache["items"]:
            raise
    return _cache["items"], _cache["by_uid"]


async def _refresh_cache_in_background() -> None:
    """Refresh the cache without blocking any in-flight request. Used both by
    the stale-while-revalidate path above and by the periodic loop below."""
    global _cache, _refresh_in_progress
    try:
        items = await _fetch_all_courses()
        by_uid = {item["uid"]: item for item in items}
        async with _cache_lock:
            _cache["items"] = items
            _cache["by_uid"] = by_uid
            _cache["fetched_at"] = time.monotonic()
        logger.info(f"Coursera catalog refreshed in background: {len(items)} courses")
        await _persist_cache_to_db(items)
    except Exception as exc:
        logger.error(f"Background Coursera catalog refresh failed, keeping stale cache: {exc}")
    finally:
        _refresh_in_progress = False


async def _periodic_refresh_loop() -> None:
    """Runs for the lifetime of the app process, refreshing the catalog every
    CACHE_TTL_SECONDS proactively so the cache practically never goes stale
    and no user request ever pays for a live Coursera fetch."""
    while True:
        await asyncio.sleep(CACHE_TTL_SECONDS)
        try:
            await _refresh_cache_in_background()
        except Exception as exc:  # pragma: no cover - safety net
            logger.error(f"Periodic Coursera refresh loop error: {exc}")


async def warm_cache() -> None:
    """Eagerly populate the cache once.

    This is intentionally triggered after authentication, from the first
    authenticated learning-dashboard request, so login is not delayed by the
    Coursera catalog fetch. Failures are swallowed and logged; the existing
    lazy-fetch-on-request behavior remains as a safety net.
    """
    try:
        await _get_cached_catalog(force_refresh=False)
    except Exception as exc:
        logger.error(f"Coursera catalog warm-up failed (will retry lazily on first request): {exc}")


def start_post_login_course_loading() -> None:
    """Start the Coursera warm-up after a successful login.

    The first authenticated learning-dashboard request calls this so the
    catalog begins loading only once the user has already entered the app.
    Subsequent calls are ignored while the warm-up task is in flight.
    """
    global _warm_cache_task

    start_background_refresh()

    if _cache["items"]:
        return

    if _warm_cache_task is not None and not _warm_cache_task.done():
        return

    _warm_cache_task = asyncio.create_task(warm_cache())


def start_background_refresh() -> None:
    """Start the periodic background refresh task. Safe to call once at
    startup; a no-op if a refresh loop is already running."""
    global _background_refresh_task
    if _background_refresh_task is None or _background_refresh_task.done():
        _background_refresh_task = asyncio.create_task(_periodic_refresh_loop())


def stop_background_refresh() -> None:
    """Cancel the periodic background refresh task. Intended for graceful
    app shutdown."""
    global _background_refresh_task
    if _background_refresh_task is not None:
        _background_refresh_task.cancel()
        _background_refresh_task = None


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


from app.services.search_taxonomy import search_and_rank_items


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

    # Apply search query (if any) using domain-aware taxonomy search and 4-tier relevance ranking
    if q and q.strip():
        items = search_and_rank_items(items, q.strip())
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