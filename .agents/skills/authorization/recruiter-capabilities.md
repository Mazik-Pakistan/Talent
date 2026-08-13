---
name: recruiter-capabilities
description: >-
  Per-recruiter module capability toggles, org module intersection, templates,
  and require_capabilities usage in TalentAI.
scope: authorization
related_skills:
  - authorization/SKILL
  - authorization/rbac-permissions
primary_files:
  - backend/app/core/rbac.py
  - backend/app/core/security.py
  - backend/app/api/super_admin.py
  - frontend/services/authService.js
  - frontend/services/rbac.js
---

# Recruiter capabilities

## Purpose

Toggle recruiter module access (invite, employees, learning, etc.) without changing role permissions. Effective access = organization granted modules ∩ recruiter personal capabilities.

## Location

- Check: `CurrentUser.has_capability` / `has_any_capability` in `backend/app/core/rbac.py`
- Dependency: `require_capabilities` / `require_any_capability` in `backend/app/core/security.py`
- Defaults/templates/admin API: `backend/app/api/super_admin.py` (`DEFAULT_RECRUITER_CAPABILITIES`, `CAPABILITY_TEMPLATES`)
- Effective merge at auth: `get_current_user` + `organization_service.effective_capabilities`
- Frontend: `hasCapability`, `persistCapabilities`, `refreshRecruiterCapabilities` in `authService.js`; `rbac.js` wrappers

## Entry Points

- Super admin UI invites/edits recruiters with capability maps.
- Routers compose e.g. `require_roles("recruiter","super_admin")` + `require_capabilities("invite")`.
- Agent chat requires `assistant` for recruiters (`backend/app/api/agent.py`).

## Data Flow

```
recruiter.capabilities (personal)
  ∩ org modules
  → CurrentUser.capabilities
  → require_capabilities("employees"|"invite"|...)
```

Empty/missing capabilities on recruiter → treated as unrestricted (backward compatible) inside `has_capability`.

## Business Rules

### Default keys (`DEFAULT_RECRUITER_CAPABILITIES`)

`overview`, `candidates`, `invite`, `employees`, `talent`, `learning`, `org_config`, `assistant`, `messages`, `announcements`, `it`, `reporting`, `profile`, `support`

### Templates (`CAPABILITY_TEMPLATES`)

- `standard_recruiter` — all true
- `hiring_only` — candidates/invite/overview/assistant/profile; employees/talent/learning/etc. false
- `people_ops` — employees/talent/learning/org_config; candidates/invite false

### Router examples

| Capability | Used by (examples) |
|------------|-------------------|
| `invite` | `RequireInvite` in invitations; `RequireRecruiterWithInvite` in offers |
| `candidates` | `RequireRecruiterWithCandidates`; `GET /api/search` |
| `employees` | `RequireRecruiterWithEmployees`; banking custom dep |
| `overview` / `reporting` | dashboard summary/activity |
| `assistant` | `/api/agent/chat` for recruiters |

**Banking gotcha:** FastAPI keeps only the last `Depends` in a single `Annotated` list. Banking uses `_require_banking_recruiter` in `employees.py` to compose role + `employees` capability correctly.

Non-recruiters: `has_capability` returns True (super_admin/candidate/employee).

## Permissions

Role permissions still required where used; capabilities are an **additional** recruiter gate. Super admin bypasses capability checks in `require_capabilities`.

## APIs (real)

Prefix `/api/super-admin`:

| Method | Path |
|--------|------|
| POST | `/api/super-admin/recruiters/invite` |
| GET | `/api/super-admin/recruiters` |
| GET | `/api/super-admin/recruiters/{recruiter_id}` |
| PUT | `/api/super-admin/recruiters/{recruiter_id}` |
| PUT | `/api/super-admin/recruiters/{recruiter_id}/capabilities` |
| POST | `/api/super-admin/recruiters/bulk-capabilities` |
| DELETE | `/api/super-admin/recruiters/{recruiter_id}` |
| GET | `/api/super-admin/capability-templates` |

Also reflected on `GET /api/rbac/me` → `capabilities`.

## Important Files

- `backend/app/api/super_admin.py`
- `backend/app/services/organization_service.py` (`effective_capabilities`, org modules)
- `frontend/components/super-admin/InviteRecruiter.js`
- Nav gating: `frontend/utils/recruiterNav.js` (if present) / shell hooks using `hasCapability`

## Modification Guide

1. Add a key to `DEFAULT_RECRUITER_CAPABILITIES`, `ALL_CAPABILITY_KEYS`, templates, and labels on `/capability-templates`.
2. Clamp new keys in `_clamp_capabilities_to_org` / org module maps if org-sellable.
3. Gate router with `require_capabilities("new_key")`.
4. Hide nav on frontend via `hasCapability`.
5. When composing role+capability, avoid stacked Annotated Depends that drop the first check (see banking).

## Do Not Break

- Org ∩ personal intersection.
- Invite/offer capability `invite` on both invitations and offers.
- Agent `assistant` gate.
- Super admin portal unlinked path.

## Testing

- Recruiter with `invite: false` → `POST /api/invitations` 403.
- Same user with `invite: true` succeeds.
- Update capabilities via super-admin PUT; `GET /api/rbac/me` updates.
- Bulk capabilities endpoint updates count.
- `py_compile` super_admin + security + touched routers.
