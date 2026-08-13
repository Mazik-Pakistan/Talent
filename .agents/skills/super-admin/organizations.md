---
name: organizations
description: >-
  TalentAI super-admin organization CRUD and module keys — tenant creation,
  updates, deletes, and ORG_MODULE_KEYS clamping.
scope: super-admin
related_skills:
  - super-admin/SKILL
  - super-admin/recruiters-capabilities
  - database/indexes-tenancy
primary_files:
  - backend/app/api/super_admin.py
  - backend/app/services/organization_service.py
  - backend/app/services/agent_tools_super_admin.py
---

# Organizations

## Purpose

Create and configure tenant organizations and their purchased module flags.

## Location

- API: `GET/POST /api/super-admin/organizations`, `GET/PUT/DELETE /api/super-admin/organizations/{id}`
- Service: `organization_service.py` (`ORG_MODULE_KEYS`)
- Agent: `list_organizations`, `create_organization`, `update_organization`, `delete_organization` (delete confirm-gated)
- FE: Super Admin organizations tab

## Entry Points

Super Admin Organizations UI and SA agent org tools.

## Data Flow

```
SA → organization_service CRUD
  → organizations collection
  → recruiter capabilities clamped to org modules
Tenant data elsewhere carries organization_id
```

## Business Rules

- Modules define which recruiter capabilities can be enabled.
- Delete is destructive — agent uses `confirm_gate`.
- Most product queries must filter by `organization_id` after org exists.

## Permissions

Super Admin only for these endpoints.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/super-admin/organizations` |
| POST | `/api/super-admin/organizations` |
| GET | `/api/super-admin/organizations/{id}` |
| PUT | `/api/super-admin/organizations/{id}` |
| DELETE | `/api/super-admin/organizations/{id}` |

## Important Files

- `organization_service.py`
- `super_admin.py`
- Tenancy helpers / `recruiter_people_scope` patterns

## Modification Guide

1. New module key → `ORG_MODULE_KEYS` + capability maps + FE org editor + clamp logic.
2. Deletion policy: define what happens to child recruiters/candidates (follow existing service rules).
3. Keep indexes for `organization_id` on tenant collections.

## Do Not Break

- Capability clamp when modules disabled.
- Tenant isolation for non-SA users.
- Agent confirm on delete.

## Testing

- Create org → invite recruiter into it → data scoped.
- Disable module → recruiter capability forced off.
- Delete confirm path via agent.
