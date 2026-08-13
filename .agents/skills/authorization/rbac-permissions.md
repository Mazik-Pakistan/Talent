---
name: rbac-permissions
description: >-
  Role permission codes, ROLE_PERMISSIONS maps, and FastAPI require_permissions /
  require_roles usage in TalentAI.
scope: authorization
related_skills:
  - authorization/SKILL
  - authorization/recruiter-capabilities
primary_files:
  - backend/app/core/rbac.py
  - backend/app/core/security.py
  - backend/app/api/rbac.py
  - frontend/services/rbac.js
---

# RBAC permissions

## Purpose

Add or change permission codes and role grants safely; keep API dependencies and UI mirrors aligned with `backend/app/core/rbac.py`.

## Location

- Source of truth: `backend/app/core/rbac.py`
- Enforcement: `require_permissions` / `require_roles` in `backend/app/core/security.py`
- Catalog/me: `backend/app/api/rbac.py`
- UI: `frontend/services/rbac.js` (subset mirror — verify against backend)

## Entry Points

- Router dependencies: `Depends(require_permissions("..."))` or `Depends(require_roles(...))`
- Shared: `RequireOnboardingSelf` = `onboarding.self`
- `CurrentUser.has_permission` / `has_any` / `has_all`

## Data Flow

Role from JWT → profile resolution → `ROLE_PERMISSIONS[role]` → dependency check → 403 + audit if missing.

## Business Rules

### Permission codes (`PERMISSIONS`)

| Code | Meaning |
|------|---------|
| `recruitment.view` | View recruitment modules |
| `recruitment.invite` | Create candidate invitations |
| `onboarding.self` | Complete personal onboarding |
| `onboarding.manage` | Manage candidate onboarding |
| `documents.self` | Own documents |
| `documents.review` | Review/verify docs |
| `offers.self` | View/sign own offer |
| `offers.manage` | Create/send/approve offers |
| `learning.access` | Learning modules |
| `ai.access` | AI modules |
| `ai.coach` | AI Coach |
| `reporting.view` | Reporting |
| `profile.view` | Personal profile |
| `admin.access` | Platform admin |

### Role grants (`ROLE_PERMISSIONS`)

- **super_admin**: all permissions
- **recruiter**: recruitment.*, onboarding.manage, documents.review, offers.manage, learning.access, ai.access, reporting.view, profile.view
- **candidate**: onboarding.self, documents.self, offers.self, profile.view
- **employee**: onboarding.self, documents.self, offers.self, learning.access, ai.coach, profile.view

`ROLE_HOME`: super-admin → `/dashboard/super-admin`, recruiter → `/dashboard/recruiter`, candidate → `/dashboard/candidate`, employee → `/dashboard/employee`.

## Permissions

Enforcement is server-side only. Frontend `can()` is UX; API must still gate.

Note: `frontend/services/rbac.js` candidate/employee lists omit some backend perms (e.g. `documents.self`, `offers.self`) — treat **backend** as authoritative when changing authz.

## APIs (real)

- `GET /api/rbac/me` — role, permissions list, capabilities, modules flags, home
- `GET /api/rbac/catalog` — public definitions

## Important Files

- `backend/app/core/rbac.py`
- `backend/app/core/security.py` (`require_permissions`, `require_roles`, `_audit_denied`)
- Examples: `backend/app/api/onboarding.py` uses `onboarding.self`; offers candidate routes use **roles**, not `offers.self` permission string directly

## Modification Guide

1. Add to `PERMISSIONS` dict.
2. Add to appropriate `ROLE_PERMISSIONS` frozensets.
3. Wire `require_permissions("new.code")` on the router.
4. Update `frontend/services/rbac.js` if the UI should hide/show based on it.
5. Prefer shared `Require*` aliases over copy-pasting Annotated blocks.

## Do Not Break

- Do not widen `super_admin`-only surfaces to recruiters accidentally.
- Do not assume two local `RequireCandidate` aliases are equal.
- Keep audit on deny.

## Testing

- `/api/rbac/catalog` includes new permission.
- Each role can/cannot hit the gated route as designed.
- `py_compile` rbac + security + router.
