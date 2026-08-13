---
name: lifespan-seeds
description: >-
  TalentAI FastAPI lifespan startup — index creation, RBAC seed, taxonomies,
  learning providers, default org, Coursera cache. Use when changing boot seeds.
scope: backend
related_skills:
  - backend/SKILL
  - database/indexes-tenancy
  - deployment/docker-compose-env
primary_files:
  - backend/app/main.py
  - backend/app/core/database.py
---

# Lifespan & seeds

## Purpose

Understand and safely extend startup seeding without breaking boot or racing Atlas indexes.

## Location

- Lifespan in `backend/app/main.py`
- Indexes: `create_database_indexes()` in `database.py` via `_ensure_index()`
- Related seed modules/scripts under `backend/app` / `backend/scripts`

## Entry Points

App process start (`uvicorn`, docker backend container).

## Data Flow

Typical order:

```
indexes
  → employee_id migrate (if present)
  → RBAC seed (roles/permissions mirror)
  → org taxonomy
  → universities
  → learning providers
  → default org
  → Coursera cache warm (often skipped when DEBUG)
```

## Business Rules

- Mongo `roles`/`permissions` are a **mirror** — code `rbac.py` remains source of truth.
- `_ensure_index` ignores benign Atlas race/conflict codes — reuse it; don’t raw `create_index` casually.
- Missing/`weak` `JWT_SECRET` fails at **import** of settings (before lifespan).
- `REDIS_URL` is required by settings validation even though app code may not use Redis as a client yet.

## Permissions

Seeds run as server process (no user). Keep seed data non-secret.

## APIs (real)

None directly — affects all APIs by ensuring indexes/reference data.

## Important Files

- `main.py` lifespan
- `database.py` indexes
- `scripts/seed_super_admin.py`
- RBAC seed helper modules

## Modification Guide

1. New collection query pattern → add index in `create_database_indexes`.
2. New reference dataset → add seed step with idempotent upserts.
3. Keep DEBUG skips for expensive warmups.

## Do Not Break

- Index helper conflict tolerance.
- Boot without optional OCR/embedding libs (lazy imports elsewhere).
- Seed idempotency (re-boot safe).

## Testing

- Fresh DB boot completes.
- Second boot does not duplicate critical seed rows incorrectly.
- Intentionally bad `JWT_SECRET` → fails fast with clear error.
