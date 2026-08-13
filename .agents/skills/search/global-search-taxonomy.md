---
name: global-search-taxonomy
description: >-
  TalentAI recruiter global people search fields/scoping and learning
  SEARCH_TAXONOMY synonym ranks.
scope: search
related_skills:
  - search/SKILL
  - database/indexes-tenancy
primary_files:
  - frontend/hooks/useGlobalSearch.js
  - backend/app/services/search_taxonomy.py
  - backend/tests/test_search_taxonomy.py
---

# Global search & taxonomy

## Purpose

Detailed rules for people search hit shapes and learning taxonomy ranking.

## Location

- People search API wiring in dashboard API/service (path `GET /api/search`)
- FE hook `useGlobalSearch.js`
- Taxonomy `SEARCH_TAXONOMY` in `search_taxonomy.py`

## Entry Points

Recruiter shell; learning search helpers importing taxonomy.

## Data Flow

### People

```
q → match full_name, email, phone, department, job_title, user_id, supabase_user_id
  → filter organization_id
  → return typed hits: employee | historical_employee | candidate
```

### Taxonomy

```
normalize query → map to taxonomy bucket
  → 4-tier rank against course metadata
  → optional OpenRouter expand when configured
```

## Business Rules

- People: minimum **2** characters; capability `candidates`.
- Taxonomy buckets (examples): frontend/front end/front-end, backend/…, database/db, ai/ml/…, data science, devops, cloud, security/cyber*, communication.
- Used by learning / Coursera / MS Learn style catalog ranking.

## Permissions

People search: recruiter + `candidates`. Taxonomy: internal to learning authz.

## APIs (real)

`GET /api/search?q=` only for people. Taxonomy is library code.

## Important Files

- `useGlobalSearch.js`, `authService.globalSearch`
- `search_taxonomy.py`, `test_search_taxonomy.py`

## Modification Guide

1. New people field → index consideration in `database.py` + FE hit rendering.
2. New taxonomy domain → add synonyms + pytest cases.
3. Keep historical_employee distinction if UI depends on it.

## Do Not Break

- Org isolation (critical).
- Hit type enums expected by FE.
- Taxonomy unit tests.

## Testing

- Cross-tenant user never appears.
- Taxonomy tests green after synonym edits.
- Debounced shell search does not spam API (hook behavior).
