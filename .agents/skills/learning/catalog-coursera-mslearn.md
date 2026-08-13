---
name: learning-catalog-coursera-mslearn
description: >-
  Learning catalog browse for Microsoft Learn, Coursera, and provider sources under
  /api/learning/catalog*. Use when changing catalog_service, facets, or source switching.
---

# Learning — Catalog (Coursera / MS Learn)

## Purpose

Browse and detail courses from external and managed catalog sources without inventing IDs.

## Location

- `backend/app/api/learning.py` — catalog routes
- `backend/app/services/catalog_service.py`, Coursera/MS Learn provider services, `provider_service.py`
- `GET /catalog/sources` → `get_catalog_sources()` from `learning_providers` (not hardcoded)
- Frontend: `learningService.js`, recruiter/employee learning catalog UI, `CatalogPicker.js`

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/learning/catalog` |
| GET | `/api/learning/catalog/facets` |
| GET | `/api/learning/catalog/sources` |
| GET | `/api/learning/catalog/soft-skills/categories` |
| GET | `/api/learning/catalog/{uid}` |

Query `source`: `microsoft_learn` (common default) | `coursera` | managed provider ids.

## Data Flow

```
Client filters → catalog_service browse
  → provider APIs / cache (learning_catalog_cache) / learning_courses
  → return courses with stable uid
Detail by uid → single course payload for start/enroll UI
```

## Business Rules

- Sources come from DB providers registry, not a frozen enum in the router.
- Soft-skill categories are Coursera-live via `/catalog/soft-skills/categories`.
- UIDs must be real catalog identifiers — downstream AI/enrollment depends on them.
- Capability `learning` required for catalog reads.

## Permissions

- `RequireAny` + `require_capabilities("learning")`

## Real APIs

See Entry Points table. Start/progress live under enrollments skill:  
`POST /api/learning/catalog/{uid}/start`, `PUT /api/learning/catalog/{uid}/progress`.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/catalog_service.py`
- `backend/app/services/provider_service.py`
- `backend/app/services/learning_cache_service.py`
- `frontend/services/learningService.js`
- `frontend/app/dashboard/recruiter/learning/CatalogPicker.js` (if present)

## Modification Guide

1. New source: register provider + catalog adapter; expose via `/catalog/sources`.
2. Keep uid stability — breaking uids breaks enrollments and AI recommendations.
3. Update facets contract and frontend filters together.

## Do Not Break

- Provider-agnostic `/catalog/sources`
- Real UIDs only
- `learning` capability check
- Cache invalidation semantics for live providers

## Testing

- `backend/tests/test_provider_support.py`
- Manual: switch MS Learn ↔ Coursera, open `{uid}` detail
- Confirm sources list matches `learning_providers`
