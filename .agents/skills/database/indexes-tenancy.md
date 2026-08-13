---
name: indexes-tenancy
description: >-
  TalentAI create_database_indexes patterns and organization_id multi-tenant
  query rules including legacy scope helpers.
scope: database
related_skills:
  - database/SKILL
  - authorization/SKILL
  - testing/pytest-frontend-validation
primary_files:
  - backend/app/core/database.py
---

# Indexes & tenancy

## Purpose

Add indexes safely and keep every list/search path tenant-isolated.

## Location

- `create_database_indexes()` / `_ensure_index()` in `database.py`
- Tenant field `organization_id` on recruiters, candidates, employees, invitations, announcements, etc.
- Scope helpers (names vary): `recruiter_people_scope`, `organization_record_scope`

## Entry Points

Startup lifespan; any new service query.

## Data Flow

```
_ensure_index(collection, keys, **opts)
  → ignore benign Atlas conflict/race codes
Query
  → always include organization_id (or explicit SA cross-org + documented)
```

## Business Rules

- Super Admin cross-org views are explicit exceptions.
- Agent tools and REST must share the same scoping functions.
- Unique indexes (email, iban_hash, session_id, …) must match service assumptions.

## Permissions

Tenancy is orthogonal to roles — both required.

## APIs (real)

N/A.

## Important Files

- `database.py`
- Domain services performing `find`/`aggregate`
- Tests: tenant isolation / authorization audit tests in `backend/tests/`

## Modification Guide

1. New query pattern → matching index.
2. New tenant collection → `organization_id` field + index `(organization_id, …)`.
3. When supporting legacy null org ids, use existing scope helper patterns — don’t invent ad hoc ORs that widen access.

## Do Not Break

- Conflict-tolerant index creation.
- Agent conversation indexes (`session_id` unique, `(user_id, updated_at)`).
- IBAN uniqueness via `iban_hash` (encrypted banking).

## Testing

- Two-org fixture: user A never sees B’s rows.
- Re-boot app twice — indexes stable.
- Run tenant isolation pytest modules when present.
