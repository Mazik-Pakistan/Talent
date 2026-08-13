# Authentication

JWT session auth with typed tokens, OTP signup, lockout, dual-role switch, and public token pages for invite/IT flows.

```
related_skills: authorization/, multi-tenancy/, frontend/
```

## Token types

Created in `backend/app/core/security.py`:

| Helper | Claim `type` | Use |
|--------|--------------|-----|
| `create_access_token` | `"access"` | API `Authorization: Bearer` |
| `create_refresh_token` | refresh (not accepted as access) | `POST /api/auth/refresh` |

`get_current_user` **rejects** any JWT whose `type != "access"`. Keep this check when touching verification.

Payload carries `user_id`, `email`, `role`. Profile is re-resolved from Mongo (`_resolve_active_profile` over `super_admins` / `recruiters` / `candidates` / `employees`).

## Login / OTP / refresh

Service: `backend/app/services/auth_service.py`. Router: `backend/app/api/auth.py`.

| Flow | Endpoints | Notes |
|------|-----------|--------|
| Signup | `POST /register`, `/candidate/register`, `/recruiter/register` | Pending user + SMTP OTP |
| Verify | `POST /verify-otp`, `/verify-email` | Activates account, returns session |
| Resend | `/resend-otp`, `/resend-verification` | Cooldown: `OTP_RESEND_COOLDOWN_SECONDS` |
| Login | `POST /login` | Password; optional `remember_me` → refresh 30d vs 7d |
| Refresh | `POST /refresh` | Rotates access (+ refresh as implemented) |
| Password | `/forgot-password`, `/reset-password`, `/change-password` | 6-digit code path for forgot |
| Logout | `POST /logout` | Revokes refresh tokens |
| Bootstrap | `POST /bootstrap-super-admin` | First super admin only, OTP-gated |

OTP settings (`config.py`): `OTP_EXPIRE_MINUTES` (default 10), `OTP_MAX_ATTEMPTS` (5).

## Cookie + localStorage (frontend)

`frontend/services/authService.js` + `lib/apiClient.js`:

1. On login/verify/switch: store `access_token`, `refresh_token`, `token_expires_at`, `user` in **localStorage**.
2. Mirror `access_token` into **`document.cookie`** so `proxy.js` can gate routes.
3. API calls use Bearer from localStorage; 401 → `/api/auth/refresh`.
4. Logout clears localStorage **and** cookies (`max-age=0`).

Do not rely on HttpOnly cookies for API auth today — dual storage is intentional.

## Dual-role switch

Accounts may hold both recruiter and employee profiles.

- `POST /api/auth/switch-role` — issues fresh token pair; rotates refresh tokens.
- Login response includes `available_roles`.
- UI: `hooks/useRoleSwitch.js` + `RoleSwitchButton`.

Effective role in JWT must match the active profile collection used by services.

## Lockout

Business rule in `auth_service` login path:

- **5 failed attempts** → **15-minute lockout**
- Counter keyed by canonical email in `login_attempts` collection
- Company email and personal email can map to the same employee account; lockout uses the canonical identity

Agent copy and UX should mention Forgot-password OTP as the unlock/reset path.

## Public token routes (no JWT)

These bypass login but use unguessable tokens:

| Backend | Frontend page | Purpose |
|---------|---------------|---------|
| `GET /api/invitations/{token}` | `/invite/[token]` | Accept invite / register |
| `/api/it-provisioning/{token}` (+ batch) | `/it-setup/...` | IT assigns email/assets |
| `/api/it-service-requests/public/{token}` | `/it-support/[token]` | IT fulfills employee request |

Frontend public allowlist: `proxy.js` `PUBLIC_PATHS` includes `/invite`, `/it-setup`, `/it-support`, `/offer`, `/onboarding`, `/documents`, `/portal-root-x9f3`, etc.

Super Admin login UI is deliberately at **`/portal-root-x9f3`** — never link it from public marketing UI.

## Session resolution extras

On each request, for recruiters:

- Load personal `capabilities`
- Intersect with org `modules` via `effective_capabilities`
- Attach `organization_id` / `organization_name` to `CurrentUser`

Candidates/employees also carry `organization_id` when bound.

## Agent checklist

1. Never accept refresh tokens where access is required.
2. New public page → `PUBLIC_PATHS` + consider token security.
3. Keep lockout and OTP limits intact unless product asks otherwise.
4. Dual-role: test both profiles after auth changes.
