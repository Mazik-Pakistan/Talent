---
name: password-reset
description: >-
  Forgot-password OTP, reset-password, and authenticated change-password flows
  for TalentAI.
scope: authentication
related_skills:
  - authentication/SKILL
  - authentication/login-register-otp
primary_files:
  - backend/app/api/auth.py
  - backend/app/services/auth_service.py
  - frontend/app/forgot-password/page.js
  - frontend/app/reset-password/page.js
  - frontend/services/authService.js
---

# Password reset & change

## Purpose

Safe password recovery and authenticated password change without exposing whether an email exists beyond existing service behavior, and without weakening OTP checks.

## Location

- Router: `backend/app/api/auth.py` — `/forgot-password`, `/reset-password`, `/change-password`
- Service: `backend/app/services/auth_service.py` — `forgot_password`, `reset_password`, `change_password`
- Schemas: `ForgotPasswordRequest`, `ResetPasswordRequest`, `ChangePasswordRequest` in `backend/app/schemas/auth.py` (password pattern shared)
- Pages: `frontend/app/forgot-password/page.js`, `frontend/app/reset-password/page.js`, `frontend/app/set-password/page.js`
- Client: `forgotPassword`, `resetPassword`, `changePassword` in `frontend/services/authService.js`

## Entry Points

1. Unauthenticated: `/forgot-password` → OTP emailed → `/reset-password` with email+otp+new password.
2. Authenticated: profile/settings → `POST /api/auth/change-password` with current + new password.

## Data Flow

```
POST /api/auth/forgot-password {email}
  → AuthService.forgot_password → OTP stored/emailed
POST /api/auth/reset-password {email, otp, password}
  → verify OTP + set password hash (bcrypt via security.hash_password)
POST /api/auth/change-password {current_password, new_password} + Bearer
  → verify current → hash new → update profile collection for active role
```

## Business Rules

- Reset is OTP + new password in **one** step (`reset_password`).
- Password must satisfy `PASSWORD_PATTERN` from auth schemas.
- Change-password requires valid access token (`RequireUser`) and correct current password.
- Passwords hashed with `passlib` bcrypt (`hash_password` / `verify_password` in `security.py`).

## Permissions

- Forgot/reset: public.
- Change: authenticated any role with active profile.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/forgot-password` | Public |
| POST | `/api/auth/reset-password` | Public |
| POST | `/api/auth/change-password` | Bearer |

## Important Files

- `backend/app/services/auth_service.py` (methods above)
- `backend/app/core/security.py` — hashing helpers
- `frontend/proxy.js` — `/forgot-password`, `/reset-password`, `/set-password` are public

## Modification Guide

1. Keep OTP verification rules aligned with signup OTP where shared.
2. Update frontend pages + `authService.js` together when payload changes.
3. Do not log plaintext passwords or OTPs.

## Do Not Break

- Public path allowlist for forgot/reset pages.
- Current-password check on change-password.
- bcrypt hashing (do not store plaintext).

## Testing

- Forgot → valid OTP → reset → login with new password.
- Invalid/expired OTP rejected.
- Change-password with wrong current password → 4xx.
- `py_compile` auth router + service.
