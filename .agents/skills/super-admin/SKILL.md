---
name: super-admin
description: >-
  TalentAI Super Admin platform — hidden portal login, organizations, recruiter
  invites/capabilities. Use when changing /portal-root-x9f3 or /api/super-admin.
scope: super-admin
related_skills:
  - super-admin/organizations
  - super-admin/recruiters-capabilities
  - super-admin/portal-login
  - tickets/admin-tickets
  - authorization/recruiter-capabilities
primary_files:
  - backend/app/api/super_admin.py
  - frontend/app/portal-root-x9f3/page.js
  - frontend/components/super-admin/SuperAdminShell.js
---

# Super Admin (overview)

## Purpose

Platform owner controls: organizations, recruiter invites/capabilities, admin tickets, AI assistant. Login UI is deliberately unlinked at `/portal-root-x9f3`.

## Location

| Concern | Path |
|---------|------|
| Portal login page | `frontend/app/portal-root-x9f3/page.js` |
| Shell | `frontend/components/super-admin/SuperAdminShell.js` |
| Home | `/dashboard/super-admin` |
| API | `backend/app/api/super_admin.py` (`/api/super-admin`) |
| Auth dep | `RequireSuperAdmin` |
| Bootstrap/seed | `POST /api/auth/bootstrap-super-admin`; `python -m scripts.seed_super_admin` |

## Entry Points

1. `/portal-root-x9f3` → login → `/dashboard/super-admin`.
2. Tabs: overview, recruiters, organizations, invite, support, AI assistant.

## Data Flow

```
portal-root-x9f3 (PUBLIC_PATHS)
  → auth login as super_admin
  → SuperAdminShell → /api/super-admin/*
```

## Business Rules

- Never link portal path from public marketing/nav UI.
- Org purchased modules clamp recruiter capabilities (`_clamp_capabilities_to_org` / `effective_capabilities`).
- Default recruiter capabilities include: overview, candidates, invite, employees, talent, learning, org_config, assistant, messages, announcements, it, reporting, profile, support.

## Permissions

`RequireSuperAdmin` = `require_roles("super_admin")`. UI may also check `admin.access`.

## APIs (real)

Under `/api/super-admin`: organizations CRUD, recruiters invite/list/update/delete/capabilities, bulk-capabilities, capability-templates. Plus admin tickets under `/api/admin/tickets`.

## Important Files

- `super_admin.py`, `organization_service.py`
- `portal-root-x9f3/page.js`, `SuperAdminShell.js`
- `frontend/proxy.js` includes portal in `PUBLIC_PATHS`

## Modification Guide

1. New SA feature → `/api/super-admin` or dedicated admin router + shell tab.
2. Keep portal path unguessable unless explicitly renaming (and update `PUBLIC_PATHS`).
3. Update SA agent tools when adding platform operations.

## Do Not Break

- Hidden `/portal-root-x9f3` (no public links).
- Capability clamp to org modules.
- Bootstrap/seed path for first admin.

## Testing

- Login via portal only; normal `/login` should not advertise SA.
- Org create → invite recruiter → capabilities respect modules.
- `docker compose exec backend python -m scripts.seed_super_admin` when needed.
