---
name: jwt-refresh-session
description: >-
  JWT access/refresh token issuance, typed token verification, session refresh,
  dual-role switch, and logout for TalentAI.
scope: authentication
related_skills:
  - authentication/SKILL
  - authentication/login-register-otp
  - authorization/SKILL
primary_files:
  - backend/app/core/security.py
  - backend/app/services/auth_service.py
  - frontend/services/authService.js
  - frontend/proxy.js
---

# JWT, refresh & session

## Purpose

Change token lifetime, refresh, logout, or dual-role switching without accepting the wrong token type or breaking cookie gating.

## Location

- Token create/verify: `backend/app/core/security.py` (`create_access_token`, `create_refresh_token`, `get_current_user`)
- Refresh/logout/switch: `backend/app/services/auth_service.py` (`refresh_token`, `logout`, `switch_role`)
- Router: `backend/app/api/auth.py` — `/refresh`, `/logout`, `/switch-role`
- Client: `frontend/services/authService.js` — `persistTokens`, `refreshToken`, `refreshSession`, `logout`, `switchRole`, `clearLocalSession`
- Gate: `frontend/proxy.js` (cookie `access_token`)

## Entry Points

1. Login / OTP success → access + refresh issued.
2. Expiring access → `POST /api/auth/refresh` with refresh token body.
3. Dual-role → `POST /api/auth/switch-role` with `{ role }` + Bearer access.
4. Logout → `POST /api/auth/logout` + `clearLocalSession()`.

## Data Flow

```
create_access_token({..., type: "access"})
create_refresh_token({..., type: "refresh"})
  → client stores tokens (localStorage / cookie patterns in authService)
get_current_user(Authorization: Bearer)
  → jwt.decode → require type == "access"
  → _resolve_active_profile(user_id, preferred_role=token.role)
refresh_token(refresh_str)
  → require type == "refresh" → new access (+ refresh as implemented)
```

## Business Rules

- Access expiry: `settings.JWT_EXPIRE_MINUTES`; refresh default 7 days in `create_refresh_token`.
- `get_current_user` rejects missing Bearer, bad JWT, or `type != "access"`.
- Preferred role on token must still have an **active** profile; otherwise 403 (no silent role fallback).
- Legacy tokens without role fall back to fixed priority: super_admin → recruiter → employee → candidate.
- Logout destroys session server-side, revokes refresh, audits.

## Permissions

- `/refresh` — public with valid refresh token in body (`RefreshRequest`).
- `/logout`, `/switch-role` — `RequireUser`.

## APIs (real)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/refresh` | Body: `refresh_token` |
| POST | `/api/auth/logout` | Bearer |
| POST | `/api/auth/switch-role` | Bearer; dual-role only |

Client: `refreshToken`, `refreshSession`, `logout`, `switchRole`, `getTokenExpiresAt`, `isRememberMeEnabled`.

## Important Files

- `backend/app/core/security.py` — typed JWT + profile resolution + capability load for recruiters
- `backend/app/core/config.py` — `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`
- `frontend/services/authService.js` — session persistence and refresh orchestration

## Modification Guide

1. Adjust expiry only via settings + token helpers; keep `type` claims.
2. If adding claims, update both issue and `get_current_user` decode.
3. Keep client `persistLoginSession` / refresh path in sync with response shape.
4. New authenticated pages are gated by default; only public routes need `PUBLIC_PATHS`.

## Do Not Break

- Never accept refresh tokens where access is required.
- Never silently remapping dual-role sessions to a different collection.
- Do not weaken `JWT_SECRET` validation.

## Testing

- Login → call protected route → wait/force refresh → still works.
- Use refresh token as Bearer on protected API → 401.
- Switch role (if dual-role fixture) → subsequent calls use new role.
- Logout → refresh fails / local session cleared.
