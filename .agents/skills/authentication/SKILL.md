---
name: authentication
description: >-
  TalentAI authentication overview — invitation-only signup, OTP activation,
  JWT access/refresh sessions, password reset, and logout. Use when changing
  login, register, cookies, tokens, or auth routes.
scope: authentication
related_skills:
  - authentication/login-register-otp
  - authentication/jwt-refresh-session
  - authentication/password-reset
  - authorization/SKILL
primary_files:
  - backend/app/api/auth.py
  - backend/app/services/auth_service.py
  - backend/app/core/security.py
  - frontend/services/authService.js
  - frontend/proxy.js
---

# Authentication (overview)

## Purpose

Guide agents changing TalentAI auth without inventing endpoints or weakening token typing. Public signup is disabled; accounts are created only via invitation flows.

## Location

| Layer | Path |
|-------|------|
| Router | `backend/app/api/auth.py` (`prefix=/api/auth`) |
| Service | `backend/app/services/auth_service.py`, `backend/app/services/candidate_service.py` (candidate register) |
| Schemas | `backend/app/schemas/auth.py`, `backend/app/schemas/invitation.py` |
| JWT helpers | `backend/app/core/security.py` |
| Frontend API | `frontend/services/authService.js` |
| Cookie gate | `frontend/proxy.js` (`PUBLIC_PATHS`) |
| Pages | `frontend/app/login/page.js`, `frontend/app/register/page.js`, `frontend/app/verify-email/page.js`, `frontend/app/forgot-password/page.js`, `frontend/app/reset-password/page.js`, `frontend/app/set-password/page.js`, `frontend/app/invite/[token]/page.js`, `frontend/app/portal-root-x9f3/page.js` |

## Entry Points

1. **Candidate invite** → `GET /api/invitations/{token}` → `POST /api/auth/candidate/register` → OTP → login.
2. **Recruiter invite** (super admin) → invite link → `POST /api/auth/recruiter/register` → OTP → login.
3. **First super admin** → `POST /api/auth/bootstrap-super-admin` → OTP → `/portal-root-x9f3`.
4. **Session** → `POST /api/auth/login` → access + refresh → cookie/`localStorage` via `persistLoginSession`.
5. **Refresh / logout / password** — see child skills.

## Data Flow

```
Browser (authService.js)
  → POST /api/auth/*
  → AuthService / CandidateService
  → Mongo (candidates|recruiters|employees|super_admins, invitations, audit_logs)
  → JWT (type=access|refresh) via security.py
```

`proxy.js` redirects unauthenticated users to `/login` unless path is in `PUBLIC_PATHS`.

## Business Rules

- `POST /api/auth/register` always returns **403** — invitation only.
- OTP activates pending accounts (`verify-otp` / legacy alias `verify-email` with email+otp).
- Access tokens must have `type: "access"`; refresh tokens `type: "refresh"` — never interchange.
- Dual-role accounts use `POST /api/auth/switch-role` (authenticated); session stays pinned to token role via `_resolve_active_profile`.
- `JWT_SECRET` must be long and non-placeholder or the app refuses to boot (`config.py`).

## Permissions

Most auth routes are **public**. Authenticated: `change-password`, `logout`, `switch-role` use `RequireUser` (`get_current_user`).

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/register` | Public (always 403) |
| POST | `/api/auth/candidate/register` | Public |
| POST | `/api/auth/recruiter/register` | Public |
| POST | `/api/auth/bootstrap-super-admin` | Public (first only) |
| POST | `/api/auth/verify-otp` | Public |
| POST | `/api/auth/verify-email` | Public (email+otp) |
| POST | `/api/auth/resend-otp` | Public |
| POST | `/api/auth/resend-verification` | Public (alias) |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public (refresh token body) |
| POST | `/api/auth/forgot-password` | Public |
| POST | `/api/auth/reset-password` | Public |
| POST | `/api/auth/change-password` | Bearer |
| POST | `/api/auth/logout` | Bearer |
| POST | `/api/auth/switch-role` | Bearer |

## Important Files

- `backend/app/api/auth.py` — thin router
- `backend/app/services/auth_service.py` — login, OTP, refresh, password, logout
- `backend/app/core/security.py` — `create_access_token`, `create_refresh_token`, `get_current_user`
- `frontend/services/authService.js` — `persistTokens`, `refreshSession`, `clearLocalSession`
- `frontend/proxy.js` — public route allowlist

## Modification Guide

1. Add/change auth behavior in `AuthService`, not the router.
2. Mirror request/response in `frontend/services/authService.js`.
3. New **public** top-level page → add to `PUBLIC_PATHS` in `proxy.js`.
4. Keep `type` claim checks on access vs refresh.

## Do Not Break

- Invitation-only registration (do not re-enable open `/register`).
- Access/refresh token type separation.
- Super admin portal path `/portal-root-x9f3` (do not link from public UI).
- Dual-role preferred_role pinning in `_resolve_active_profile`.

## Testing

- `python -m py_compile backend/app/api/auth.py backend/app/services/auth_service.py backend/app/core/security.py`
- Manual: invite → register → OTP → login → refresh → logout; forgot → OTP → reset.
- Confirm OpenAPI lists `/api/auth/*` after router changes.
