---
name: switch-role-profile-sync
description: >-
  TalentAI switch-role mechanics and profile_sync_service mirroring for
  dual-role recruiters/employees.
scope: dual-role
related_skills:
  - dual-role/SKILL
  - authentication/jwt-refresh-session
  - storage/cloudinary-photos-docs
primary_files:
  - backend/app/services/profile_sync_service.py
  - backend/app/services/auth_service.py
  - frontend/hooks/useRoleSwitch.js
---

# Switch role & profile sync

## Purpose

Implement role switching and keep shared profile fields consistent across `employees` and `recruiters` documents.

## Location

- `auth_service.switch_role`, `_available_switch_roles`, `_resolve_active_profile`
- `profile_sync_service.mirror_profile_fields`
- Photo updates via `profile_photo_service` should trigger mirror
- FE: `useRoleSwitch`, `RoleSwitchButton`, `authService.switchRole`

## Entry Points

User clicks switch → `POST /api/auth/switch-role` → new session. Profile/photo PATCH paths call mirror.

## Data Flow

```
switch_role(role)
  → validate dual profiles
  → issue access(+refresh) with role
mirror_profile_fields(user_id, changed_fields)
  → copy SHARED_PROFILE_FIELDS to sibling collection
```

## Business Rules

- `ROLE_DETECT_ORDER` on login: candidate → recruiter → employee.
- Preferred role on token must have active profile — no silent remap.
- Scripts repair drift: reconcile / backfill / verify under `backend/scripts/`.

## Permissions

Authenticated user; switch only if both roles available.

## APIs (real)

`POST /api/auth/switch-role` body `{ "role": "employee" | "recruiter" }`.

## Important Files

- `profile_sync_service.py`
- `security.py` profile resolution
- Shell shared `RoleSwitchButton.js`

## Modification Guide

1. Any profile writer for dual-role users → call `mirror_profile_fields`.
2. Switching must update client storage the same way as login (`persistLoginSession`).
3. Document new shared fields in this skill when added.

## Do Not Break

- SHARED_PROFILE_FIELDS completeness for photo meta.
- 403 when requested role profile missing.
- Recruiter capability load still runs after switch to recruiter.

## Testing

- Switch → protected recruiter-only route works only in recruiter mode.
- Photo upload mirrors URL to sibling profile.
- Reconcile script dry-run on staging copy.
