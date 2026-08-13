---
name: portal-login
description: >-
  TalentAI Super Admin hidden portal at /portal-root-x9f3 — PUBLIC_PATHS, bootstrap,
  and seed. Use when changing SA login entry.
scope: super-admin
related_skills:
  - super-admin/SKILL
  - authentication/login-register-otp
  - frontend/shells-nav-proxy
primary_files:
  - frontend/app/portal-root-x9f3/page.js
  - frontend/proxy.js
  - backend/app/api/auth.py
---

# Portal login

## Purpose

Keep Super Admin login discoverable only via the unguessable path `/portal-root-x9f3`.

## Location

- Page: `frontend/app/portal-root-x9f3/page.js`
- Public allowlist: `frontend/proxy.js` → `PUBLIC_PATHS` includes `/portal-root-x9f3`
- First admin: `POST /api/auth/bootstrap-super-admin`
- Seed: `python -m scripts.seed_super_admin` (also via docker compose exec)

## Entry Points

Browser → `/portal-root-x9f3` → OTP/login flows shared with auth service → redirect `/dashboard/super-admin`.

## Data Flow

```
PUBLIC_PATHS allows portal without access_token cookie
  → login/bootstrap as super_admin
  → tokens + cookie → SuperAdminShell
```

## Business Rules

- Do **not** link this path from public UI, README marketing pages, or role nav.
- Renaming requires updating page folder, any redirects, and `PUBLIC_PATHS` together — only when explicitly requested.
- Bootstrap allowed for first super admin only (service enforces).

## Permissions

Page is public; successful login yields `super_admin` role JWT.

## APIs (real)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/bootstrap-super-admin` | First SA |
| POST | `/api/auth/login` | Existing SA |
| POST | `/api/auth/verify-otp` | Activation |

## Important Files

- `portal-root-x9f3/page.js`
- `proxy.js` `PUBLIC_PATHS`
- `scripts/seed_super_admin.py`

## Modification Guide

1. UX tweaks stay on the portal page — do not add footer links site-wide.
2. If path must change, grep for `portal-root-x9f3` across repo.
3. Keep seed script documented in deployment skill.

## Do Not Break

- Presence in `PUBLIC_PATHS` (otherwise redirect loop to `/login`).
- Unlinked nature from public navigation.
- Bootstrap single-admin guard.

## Testing

- Visit portal logged-out → page loads (not redirected).
- Visit `/dashboard/super-admin` logged-out → redirected to login.
- Seed + login works in docker.
