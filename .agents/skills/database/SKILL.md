---
name: database
description: >-
  TalentAI MongoDB Motor access — indexes, organization_id tenancy, SRV DNS
  shim. Use when adding collections or queries.
scope: database
related_skills:
  - database/indexes-tenancy
  - backend/lifespan-seeds
  - security/SKILL
primary_files:
  - backend/app/core/database.py
  - backend/app/core/config.py
---

# Database (overview)

## Purpose

All persistence is MongoDB via Motor. There is **no** in-memory mock mode — `MONGODB_URI` required to boot.

## Location

- Client + indexes: `backend/app/core/database.py`
- Settings: `MONGODB_URI`, `DATABASE_NAME`
- Domain collections touched from services

## Entry Points

Services import `db` / collection helpers from `database.py`. Lifespan calls `create_database_indexes()`.

## Data Flow

```
Service → Motor collection ops
  → filter by organization_id when tenant-scoped
Indexes ensured at startup via _ensure_index
```

## Business Rules

- Missing tenant filter on list/search = critical bug (treat like injection).
- Legacy rows without `organization_id` may use `recruiter_people_scope` / `organization_record_scope` helpers where those exist.
- `mongodb+srv://` uses public DNS resolvers `8.8.8.8` / `1.1.1.1` shim when needed — do not remove casually.

## Permissions

DB layer trusts calling service to pass scoped queries; not a substitute for RBAC.

## APIs (real)

N/A — internal. Example collections: users/recruiters/candidates/employees/super_admins/organizations/documents/notifications/offer_letters/learning_*/it_*/hr_threads/tickets/agent_conversations/audit_logs.

## Important Files

- `database.py`
- Tenant scope helpers in services/core as used by domain

## Modification Guide

1. New collection → indexes + schema + tenant field if needed.
2. Prefer additive fields; backfills in `backend/scripts/`.
3. Banking fields encrypted — see security skill.

## Do Not Break

- `_ensure_index` usage.
- SRV DNS shim.
- Tenant filters on new aggregations.

## Testing

- Boot against Atlas/local mongo.
- Tenant isolation tests under `backend/tests/` if touching queries.
- `py_compile database.py`
