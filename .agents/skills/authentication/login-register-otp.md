---
name: login-register-otp
description: >-
  Invitation-based registration, OTP email verification, and login for
  candidates, recruiters, and super admins.
scope: authentication
related_skills:
  - authentication/SKILL
  - authentication/jwt-refresh-session
  - recruitment/invitations
primary_files:
  - backend/app/api/auth.py
  - backend/app/services/auth_service.py
  - backend/app/services/candidate_service.py
  - frontend/app/login/page.js
  - frontend/app/invite/[token]/page.js
  - frontend/app/verify-email/page.js
---

# Login, register & OTP

## Purpose

Implement or fix signup/login/OTP without opening public registration or skipping invitation validation.

## Location

- Backend: `backend/app/api/auth.py`, `backend/app/services/auth_service.py`, `backend/app/services/candidate_service.py` (`register`)
- Schemas: `CandidateRegisterRequest`, `RecruiterRegisterRequest` in `backend/app/schemas/invitation.py`; `LoginRequest`, `VerifyOTPRequest` in `backend/app/schemas/auth.py`
- Frontend: `frontend/services/authService.js` (`candidateRegister`, `login`, `verifyOtp`, `resendOtp`, `getInvitation`)
- Pages: `frontend/app/login/page.js`, `frontend/app/register/page.js` (blocked UX), `frontend/app/invite/[token]/page.js`, `frontend/app/verify-email/page.js`, `frontend/app/portal-root-x9f3/page.js`

## Entry Points

| Actor | Flow |
|-------|------|
| Candidate | `/invite/[token]` → validate token → register → verify OTP → login → `/dashboard/candidate` |
| Recruiter | Invite email → recruiter register → OTP → login → `/dashboard/recruiter` |
| Super admin bootstrap | First account via `bootstrap-super-admin` → OTP → `/portal-root-x9f3` |
| Existing user | `/login` → `POST /api/auth/login` |

## Data Flow

1. `GET /api/invitations/{token}` validates invite (public).
2. `POST /api/auth/candidate/register` or `/recruiter/register` creates pending profile + emails OTP.
3. `POST /api/auth/verify-otp` (or `verify-email` with email+otp) activates account.
4. `POST /api/auth/login` returns session; frontend `persistLoginSession`.
5. Failed open signup: `POST /api/auth/register` → HTTP 403.

## Business Rules

- Registration is invitation-only; generic `/api/auth/register` is intentionally disabled.
- OTP is 6-digit; resend via `/resend-otp` or alias `/resend-verification`.
- `verify-email` without email+otp returns 400 (legacy access_token flow removed).
- Login resolves active profile by role collections (`candidates`, `recruiters`, `employees`, `super_admins`) with `status: active`.

## Permissions

Public endpoints. Post-login role home from `ROLE_HOME` in `backend/app/core/rbac.py`.

## APIs (real)

- `POST /api/auth/candidate/register`
- `POST /api/auth/recruiter/register`
- `POST /api/auth/bootstrap-super-admin`
- `POST /api/auth/verify-otp`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-otp`
- `POST /api/auth/resend-verification`
- `POST /api/auth/login`
- `POST /api/auth/register` (403)
- Related: `GET /api/invitations/{token}`

Frontend wrappers: `candidateRegister`, `verifyOtp`, `verifyEmail`, `resendOtp`, `login`, `getInvitation`, `bootstrapSuperAdmin`.

## Important Files

- `backend/app/services/candidate_service.py` — candidate register + OTP side effects
- `backend/app/services/auth_service.py` — `recruiter_register`, `verify_otp`, `login`
- `frontend/components/auth/AuthAside.js` — shared auth chrome

## Modification Guide

1. Change validation in Pydantic schemas first.
2. Keep invite token consumption / expiry logic in invitation + register services aligned.
3. Update both `verify-otp` and `verify-email` if OTP contract changes.
4. Mirror any new fields in `authService.js` and invite/login pages.

## Do Not Break

- Do not enable open `POST /api/auth/register`.
- Do not accept refresh tokens on login-protected routes.
- Keep invite email normalization (lowercase) consistent with invitations.

## Testing

- Happy path: valid invite → register → OTP → login → correct `ROLE_HOME`.
- Expired/used invite rejected.
- Wrong OTP rejected; resend works.
- `py_compile` on touched auth/candidate service files.
