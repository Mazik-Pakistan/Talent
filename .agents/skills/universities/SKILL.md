---
name: universities
description: >-
  Public university autocomplete for onboarding education fields.
  Seeded at lifespan; search is unauthenticated.
scope: universities
related_skills:
  - onboarding/candidate-wizard
  - backend/lifespan-seeds
primary_files:
  - backend/app/api/universities.py
  - backend/app/services/university_seed_service.py
  - frontend/components/onboarding/UniversityAutocomplete.js
---

# Universities (autocomplete)

## Purpose

Provide searchable university names for candidate onboarding education steps without requiring auth.

## Location

| Layer | Path |
|-------|------|
| Router | `backend/app/api/universities.py` — prefix `/api/universities` |
| Seed | `backend/app/services/university_seed_service.py` — `seed_universities` (lifespan) |
| Collection | `universities` |
| UI | `frontend/components/onboarding/UniversityAutocomplete.js` |

## Entry Points

- Onboarding education UI → `GET /api/universities/search?q=...`
- App boot → `seed_universities()` in `main.py` lifespan

## Data Flow

```
UniversityAutocomplete → GET /api/universities/search (public)
  → Mongo universities collection (text/prefix match as implemented)
  → options for education form fields
```

## Business Rules

- Endpoint is **public** (no auth dependency) — do not attach secrets or PII to this API.
- Data is seeded; do not assume user-editable university CRUD exists unless you add it deliberately.
- Keep response payloads small (name/id style) for autocomplete UX.

## Permissions

Public read. No role required.

## APIs (real)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/universities/search` | Public | Autocomplete query |

## Important Files

- `backend/app/api/universities.py`
- `backend/app/services/university_seed_service.py`
- `frontend/components/onboarding/UniversityAutocomplete.js`

## Modification Guide

1. Change search behavior only in the universities router/query helpers.
2. If adding admin CRUD, create a gated route — do not overload the public search.
3. Keep onboarding component using the shared autocomplete, not a one-off fetch.

## Do Not Break

- Public availability for invite/onboarding flows before full session.
- Lifespan seed idempotency.
- Onboarding education UX that depends on this list.

## Testing

- Hit `/api/universities/search?q=stan` without a token; expect 200 + matches.
- Open onboarding education step and confirm dropdown populates.
