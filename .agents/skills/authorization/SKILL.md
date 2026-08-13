---
name: authorization
description: >-
  TalentAI authorization overview — roles, permission codes, FastAPI
  dependencies, and recruiter capability layer. Use before changing access
  checks or Require* aliases.
scope: authorization
related_skills:
  - authorization/rbac-permissions
  - authorization/recruiter-capabilities
  - authentication/jwt-refresh-session
primary_files:
  - backend/app/core/rbac.py
  - backend/app/core/security.py
  - backend/app/api/rbac.py
  - frontend/services/rbac.js
---

# Authorization (overview)

## Purpose

Keep role permissions and recruiter capabilities consistent. Code in `rbac.py` is the source of truth — Mongo `roles`/`permissions` collections are a seeded mirror only.

## Location

| Concern | Path |
|---------|------|
| Permission & role maps | `backend/app/core/rbac.py` |
| Dependencies | `backend/app/core/security.py` (`require_permissions`, `require_roles`, `require_capabilities`, shared `Require*`) |
| Introspection API | `backend/app/api/rbac.py` (`/api/rbac/me`, `/api/rbac/catalog`) |
| Capability admin | `backend/app/api/super_admin.py` |
| Frontend mirror | `frontend/services/rbac.js`, capability helpers in `authService.js` |

## Entry Points

- Every protected router imports `RequireRecruiter` / `RequireEmployee` / `RequireUser` / `RequireOnboardingSelf` from `security.py`, **or** a router-local Annotated dependency.
- UI gates via `can()` / `hasCapability()` in `frontend/services/rbac.js` and `authService.js`.
- Client loads effective access from `GET /api/rbac/me` after login.

## Data Flow

```
Bearer access token
  → get_current_user → CurrentUser(role, capabilities, organization_id)
  → require_roles / require_permissions / require_capabilities
  → service (must also scope by organization_id)
```

Denied access writes `audit_logs` via `_audit_denied`.

## Business Rules

- Four roles: `super_admin`, `recruiter`, `candidate`, `employee`.
- Permissions are role-static frozensets in `ROLE_PERMISSIONS`.
- Recruiters have a second gate: **capabilities** (org modules ∩ personal toggles).
- **RequireCandidate gotcha:** same name, different rules:
  - `offers.py`: `require_roles("candidate", "super_admin")`
  - `employees.py`: `RequireOnboardingSelf as RequireCandidate` → `require_permissions("onboarding.self")` (candidate **and** employee qualify)

## Permissions

See child skill `rbac-permissions.md` for the full permission table. Shared aliases in `security.py`:

- `RequireUser`, `RequireRecruiter`, `RequireEmployee`, `RequireAny`, `RequireOnboardingSelf`

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/rbac/me` | Bearer |
| GET | `/api/rbac/catalog` | Public |

## Important Files

- `backend/app/core/rbac.py` — `PERMISSIONS`, `ROLE_PERMISSIONS`, `ROLE_HOME`, `CurrentUser`
- `backend/app/core/security.py` — dependency factories
- `frontend/services/rbac.js` — UI permission mirror (may lag backend; **backend wins**)

## Modification Guide

1. Add permission codes to `PERMISSIONS` + role frozensets in `rbac.py`.
2. Gate routers with shared `Require*` or compose `require_roles` + `require_capabilities`.
3. Update `frontend/services/rbac.js` if UI must hide modules.
4. Never trust client-only checks for security.

## Do Not Break

- Tenant `organization_id` filtering on list/search queries.
- Capability intersection for recruiters.
- Distinct `RequireCandidate` meanings in offers vs employees — read the local definition before reusing.

## Testing

- Call endpoint as each role; expect 401/403 correctly.
- Recruiter with capability off → 403 with capability message.
- `GET /api/rbac/me` reflects role permissions + capabilities.
- `py_compile` `rbac.py` + `security.py` + touched routers.
