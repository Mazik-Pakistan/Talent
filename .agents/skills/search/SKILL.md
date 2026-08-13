---
name: search
description: >-
  TalentAI search systems — recruiter global people search and learning course
  taxonomy. Use when changing /api/search or search_taxonomy.py.
scope: search
related_skills:
  - search/global-search-taxonomy
  - dashboard/recruiter-overview-activity
  - llm/openrouter-gemini
primary_files:
  - backend/app/api/dashboard.py
  - backend/app/services/search_taxonomy.py
  - frontend/hooks/useGlobalSearch.js
---

# Search (overview)

## Purpose

Two different search systems:

1. **Global people search** (recruiter shell) — candidates/employees by name/email/phone/etc.
2. **Learning taxonomy** — course intent synonyms + ranking for catalogs.

Do not conflate them.

## Location

| System | Backend | Frontend |
|--------|---------|----------|
| People | `GET /api/search?q=` (dashboard router/service) | `useGlobalSearch.js` → `authService.globalSearch` |
| Taxonomy | `backend/app/services/search_taxonomy.py` | learning services/UI |

## Entry Points

Recruiter shell search box; learning course search/rank pipelines.

## Data Flow

```
People: q (≥2 chars) → org-scoped Mongo text/regex fields → employee|historical_employee|candidate
Taxonomy: query → SEARCH_TAXONOMY keys → 4-tier rank (+ optional OpenRouter expand)
```

## Business Rules

- People search requires capability `candidates` and `organization_id` scope.
- Taxonomy keys include frontend/backend/database/ai/ml/data science/devops/cloud/security/communication variants.

## Permissions

People: recruiter (+ cap). Taxonomy: used inside learning services with those routes’ auth.

## APIs (real)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/search?q=` | min 2 chars; cap `candidates` |

Taxonomy has no dedicated public router — embedded in learning.

## Important Files

- `useGlobalSearch.js`
- `search_taxonomy.py`
- `backend/tests/test_search_taxonomy.py`

## Modification Guide

1. People fields → keep tenant filter mandatory.
2. Taxonomy synonyms → update `SEARCH_TAXONOMY` + tests.
3. Optional LLM expand must tolerate `llm_configured()` false.

## Do Not Break

- Min query length and org scope on people search.
- Taxonomy tests as regression harness.
- Shell search UX performance (debounce as existing hook does).

## Testing

- `q=ab` boundary; other-org person absent.
- `pytest backend/tests/test_search_taxonomy.py`
