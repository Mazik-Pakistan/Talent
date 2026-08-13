---
name: it-provisioning-password-reveal-otp
description: >-
  Employee company-email password OTP reveal via /api/employees/me/company-email-password/*
  implemented in it_provisioning_service. Also covers public IT reset-password. Never log plaintext.
---

# IT Provisioning — Password Reveal OTP

## Purpose

Let employees unlock a stored company-email (account) password using an OTP emailed to their personal address. IT can also reset password from the public provisioning link.

## Location

- Employee routes in `backend/app/api/employees.py`:
  - `POST /api/employees/me/company-email-password/request-otp`
  - `POST /api/employees/me/company-email-password/reveal`
- Implementation: `it_provisioning_service.request_password_otp`, `reveal_password`
- Public reset: `POST /api/it-provisioning/{token}/reset-password` → `reset_password_public`
- Schema: `RevealCompanyEmailPasswordRequest` (OTP field)
- Frontend: `requestCompanyEmailPasswordOtp`, `revealCompanyEmailPassword`; employee profile page
- Collection: `company_email_password_otps`; encrypted fields on employee/request docs

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/employees/me/company-email-password/request-otp` | `RequireEmployee` |
| POST | `/api/employees/me/company-email-password/reveal` | `RequireEmployee` + OTP body |
| POST | `/api/it-provisioning/{token}/reset-password` | Public token |

## Data Flow

```
request-otp → ensure encrypted password on file → generate OTP
  → store company_email_password_otps (expiry OTP_EXPIRE_MINUTES)
  → email personal address
reveal → verify OTP → decrypt_text → return password once → delete OTP row

reset-password (IT) → new temp password → hash on user must_change_password
  → email employee → return temporary_password once in response
```

## Business Rules

- No password on file → 404/400 from request-otp.
- Personal email required for OTP delivery.
- OTP mismatch/expiry fails closed.
- Reveal response is transient — UI must not persist in localStorage.
- Never log OTP or plaintext password.
- Fernet via `encrypt_text` / `decrypt_text`.

## Permissions

- OTP pair: employee (self)
- Reset: public provisioning token after submit

## Real APIs

See Entry Points. Note: reveal is **not** under `/api/it-provisioning` despite schema living in it_provisioning module.

## Important Files

- `backend/app/api/employees.py`
- `backend/app/services/it_provisioning_service.py` (`request_password_otp`, `reveal_password`, `reset_password_public`)
- `backend/app/schemas/it_provisioning.py`
- `backend/app/core/crypto` / security helpers for encrypt
- `frontend/app/dashboard/employee/profile/page.js`
- `frontend/services/authService.js`

## Modification Guide

1. Keep OTP expiry tied to `settings.OTP_EXPIRE_MINUTES`.
2. If moving reveal under it-provisioning router, update frontend paths in the same change.
3. Reset-password emails both personal + company when configured — preserve.

## Do Not Break

- **Never log or store plaintext passwords in audit detail**
- OTP single-use delete after success
- Fernet encryption at rest
- `must_change_password` after IT reset
- Do not allow reveal without OTP

## Testing

- Provision with temp password → request OTP → reveal succeeds
- Bad OTP fails; expired OTP fails
- Reset-password from public link forces change on next login
- Confirm no password in server logs
