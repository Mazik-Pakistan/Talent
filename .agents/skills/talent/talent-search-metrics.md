---
name: talent-search-metrics
description: >-
  Recruiter talent search POST /api/talent/search, metrics, and requirements-status.
  Uses optional resume embeddings. Capability talent.
---

# Talent — Search & Metrics

## Purpose

Search employees by skills/query (optional embedding cosine) and view talent metrics / requirements coverage.

## Location

- `backend/app/api/talent.py` — `search_talent`, `talent_metrics`, `requirements_status`
- `TalentService.search_talent`, `talent_metrics`, `requirements_status`
- Embeddings: `candidates.resume_embedding` via `embedding_service` when `ENABLE_EMBEDDINGS`
- Frontend: recruiter talent search/dashboard widgets

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/talent/search` | `RequireRecruiterWithTalent` |
| GET | `/api/talent/metrics` | Recruiter (`department` optional) |
| GET | `/api/talent/requirements-status` | Recruiter |

## Data Flow

```
TalentSearchRequest → filter org employees
  → optional query embed + cosine vs resume_embedding
  → ranked hits
metrics/requirements-status → aggregates vs org framework / learning requirements
```

## Business Rules

- Always filter by organization.
- Missing embeddings → degrade (keyword/other filters), never 500 solely because embeddings off.
- Department filter on metrics when provided.

## Permissions

- `RequireRecruiterWithTalent` (`talent` capability)

## Real APIs

See Entry Points. Body: `TalentSearchRequest` in `backend/app/schemas/talent.py`.

## Important Files

- `backend/app/api/talent.py`
- `backend/app/services/talent_service.py`
- `backend/app/services/embedding_service.py`
- `backend/app/schemas/talent.py`
- `frontend/services/talentService.js`

## Modification Guide

1. New search facets: schema + service query + UI filters together.
2. Keep embedding path lazy/optional.
3. Metrics cards: preserve department scoping.

## Do Not Break

- Org isolation (treat missing filter as critical)
- `ENABLE_EMBEDDINGS` optional behavior
- Capability `talent`
- Do not return cross-tenant candidates

## Testing

- Search with embeddings on/off
- Metrics with department
- Authorization audit for talent capability
- `py_compile` talent + embedding services
