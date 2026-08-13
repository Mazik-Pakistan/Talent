---
name: dual-role
description: >-
  TalentAI dual-role employee+recruiter accounts — switch-role API, profile field
  mirroring, and reconcile scripts. Use when changing role switch or shared profile.
scope: dual-role
related_skills:
  - dual-role/switch-role-profile-sync
  - authentication/jwt-refresh-session
  - super-admin/recruiters-capabilities
primary_files:
  - backend/app/services/auth_service.py
  - backend/app/services/profile_sync_service.py
  - frontend/hooks/useRoleSwitch.js
  - frontend/components/shared/shell/RoleSwitchButton.js
---

# Dual-role (overview)

## Purpose

Some users have both **employee** and **recruiter** profiles. They switch active role via API; shared profile fields stay mirrored.

## Location

| Concern | Path |
|---------|------|
| Switch API | `POST /api/auth/switch-role` in `auth.py` / `auth_service.switch_role` |
| Profile sync | `backend/app/services/profile_sync_service.py` |
| FE | `useRoleSwitch.js`, `RoleSwitchButton.js`, `authService.switchRole` |
| Scripts | `scripts/reconcile_dual_role_profiles.py`, `backfill_dual_role_recruiters.py`, `verify_dual_role.py` |

## Entry Points

Shell role switch control when `_available_switch_roles` includes both; login detection order `candidate → recruiter → employee`.

## Data Flow

```
POST /api/auth/switch-role { role: employee|recruiter }
  → new tokens with role claim
  → client persistLoginSession → redirect ROLE_HOME
Profile update → mirror_profile_fields across collections
```

## Business Rules

- Switch targets **only** `employee` | `recruiter` (not candidate/super_admin).
- Invited recruiters often get dual docs; session starts as recruiter.
- Shared fields: full_name, phone, profile_picture(+meta), department, job_title, office_location.

## Permissions

`RequireUser` on switch-role; both profiles must exist and be active.

## APIs (real)

| Method | Path |
|--------|------|
| POST | `/api/auth/switch-role` |

## Important Files

- `auth_service.py` — `_available_switch_roles`, `switch_role`, `_resolve_active_profile`
- `profile_sync_service.py` — `SHARED_PROFILE_FIELDS`, `mirror_profile_fields`
- `security.py` preferred_role pinning

## Modification Guide

1. New shared field → add to `SHARED_PROFILE_FIELDS` + all writers call mirror.
2. Keep token `role` claim authoritative after switch.
3. Run reconcile script if historical drift exists.

## Do Not Break

- No silent fallback to another collection when preferred role missing (403).
- Access vs refresh typing still enforced after switch.
- Candidate-only users must not see switch UI.

## Testing

- Dual fixture: switch both ways; `/api/rbac/me` reflects role.
- Update name as employee → recruiter profile matches.
- `verify_dual_role.py` passes.
