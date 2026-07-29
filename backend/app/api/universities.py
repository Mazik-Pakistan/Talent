"""
Universities search API — Candidate Onboarding / Education autocomplete only.

GET /api/universities/search?q=<query>

Returns up to 10 universities whose name starts with or contains the query.
Starts-with matches are ranked before contains matches.
No authentication required — the list is public reference data.
"""

import re

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.core.database import database

router = APIRouter(prefix="/api/universities", tags=["Universities"])

_col = database.universities
_MAX_RESULTS = 10


@router.get("/search")
async def search_universities(
    q: str = Query(default="", min_length=0, max_length=100, description="Partial university name"),
):
    query = q.strip()

    if not query:
        return JSONResponse(content=[])

    # Escape special regex characters in user input.
    escaped = re.escape(query)

    # Two passes so starts-with results surface first:
    #   1. name starts with the query  (anchored)
    #   2. name contains the query     (unanchored, excludes already-matched docs)
    starts_with_filter = {"name": {"$regex": f"^{escaped}", "$options": "i"}}
    contains_filter    = {"name": {"$regex": escaped,       "$options": "i"}}

    projection = {"_id": 0, "name": 1, "country": 1, "city": 1}

    starts_with_docs = (
        await _col.find(starts_with_filter, projection)
        .sort("name", 1)
        .limit(_MAX_RESULTS)
        .to_list(length=_MAX_RESULTS)
    )

    remaining = _MAX_RESULTS - len(starts_with_docs)
    results = list(starts_with_docs)

    if remaining > 0:
        # Exclude names already returned to avoid duplicates.
        already = {d["name"] for d in starts_with_docs}
        async for doc in (
            _col.find(contains_filter, projection)
            .sort("name", 1)
            .limit(_MAX_RESULTS)          # over-fetch so exclusion still gives us enough
        ):
            if doc["name"] not in already:
                results.append(doc)
                if len(results) >= _MAX_RESULTS:
                    break

    return JSONResponse(content=results)
