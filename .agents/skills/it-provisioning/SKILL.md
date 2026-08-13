---
name: it-provisioning
description: >-
  IT provisioning under /api/it-provisioning: kits, send/remind, public token submit,
  bulk batch, password reset. Employee company-email password OTP reveal is under
  /api/employees/me/company-email-password/*. Capability: it. Requires signed offer.
---

# IT Provisioning

## Purpose

After a signed offer, recruiters email IT a public link to assign company email, assets, licenses, and a temporary password. Employees later reveal stored company-email password via OTP on employee APIs.

## Location

- Router: `backend/app/api/it_provisioning.py` — prefix **`/api/it-provisioning`**
- Service: `backend/app/services/it_provisioning_service.py`, `it_kit_service.py`
- Schema: `backend/app/schemas/it_provisioning.py`
- OTP reveal routes: `backend/app/api/employees.py` (`/me/company-email-password/*`)
- Frontend: `authService.js` IT helpers; `frontend/app/it-setup/[token]/page.js`; `it-setup/batch/[token]`; recruiter `it` / `it-kits` pages; employee profile reveal UI

## Entry Points

| Actor | Routes |
|-------|--------|
| Recruiter + `it` | kits CRUD, send/remind, bulk-send/remind, candidate status |
| Public (token) | GET/POST `/{token}`, edit, reset-password; batch GET/submit |
| Employee | `POST /api/employees/me/company-email-password/request-otp`, `/reveal` |

## Data Flow

```
Offer status=signed → send/bulk-send → it_provisioning_requests (+ batches)
  → email public link → IT submit company email/assets/temp password (Fernet)
  → employee activation / must_change_password
  → employee OTP to personal email → reveal decrypted password once
```

## Business Rules

- Offer must be **signed** before send.
- Tokens `token_urlsafe(32)`; public routes unauthenticated but token-gated.
- Temp/mailbox secrets Fernet-encrypted — never log plaintext.
- Company email uniqueness across requests/employees.
- One account password covers personal + company email login (legacy company_email_password optional/ignored).

## Permissions

- Recruiter: `RequireRecruiterWithIT` = `recruiter|super_admin` + capability **`it`**
- Public: no JWT
- OTP: `RequireEmployee` on employees router

## Real APIs

Base **`/api/it-provisioning`**. OTP under **`/api/employees`**. See child skills.

## Important Files

- `backend/app/api/it_provisioning.py`
- `backend/app/services/it_provisioning_service.py`
- `backend/app/api/employees.py` (OTP reveal)
- `frontend/services/authService.js`
- `frontend/app/it-setup/[token]/page.js`

## Modification Guide

1. Keep public pages in `proxy.js` `PUBLIC_PATHS` (`/it-setup`).
2. Schema changes for submit → public page + service together.
3. Password/OTP changes stay on encrypted fields + employee routes.

## Do Not Break

- Signed-offer gate
- Fernet encryption / no plaintext logs
- Token expiry/status checks
- Capability `it`
- Public fulfill must not skip status machine

## Testing

- `test_authorization_audit.py` (`RequireRecruiterWithIT`)
- Manual: signed offer → send → public submit → employee OTP reveal
- Bulk batch path

## Related

- `send-public-submit.md`, `kits.md`, `bulk-batch.md`, `password-reveal-otp.md`
