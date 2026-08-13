---
name: it-provisioning-send-public-submit
description: >-
  Send/remind IT provisioning and public token get/submit/edit/reset-password under
  /api/it-provisioning. Use when changing the signed-offer → IT link flow.
---

# IT Provisioning — Send & Public Submit

## Purpose

Recruiter triggers IT email; IT completes provisioning via public token pages.

## Location

- `backend/app/api/it_provisioning.py` — send, remind, public routes
- `it_provisioning_service.py` — send, submit, edit, reset_password_public
- Public UI: `frontend/app/it-setup/[token]/page.js`
- Recruiter: dashboard IT page; `sendItProvisioning`, `remindItProvisioning`, `getItProvisioningPublic`, submit helpers in `authService.js`

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/it-provisioning/send` | Recruiter + `it` |
| POST | `/api/it-provisioning/remind` | Recruiter + `it` |
| GET | `/api/it-provisioning/candidate/{candidate_id}` | Recruiter + `it` |
| GET | `/api/it-provisioning/{token}` | Public |
| POST | `/api/it-provisioning/{token}/submit` | Public |
| POST | `/api/it-provisioning/{token}/edit` | Public |
| POST | `/api/it-provisioning/{token}/reset-password` | Public |

## Data Flow

```
SendItProvisioningRequest → validate offer signed → create request + token
  → email settings.it_provisioning_link
IT opens token → GET form context → submit company email, assets, licenses, temporary_password
  → encrypt secrets → update candidate/employee linkage as service defines
edit → update submission; optional new temp password
reset-password → new temp password hashed on user; email employee; return once
```

## Business Rules

- Reject send unless offer `status == signed`.
- Duplicate company email rejected.
- Temporary password policy validated in schema (length, complexity).
- Public token invalid/expired/already terminal → error, no silent reopen without rules.

## Permissions

- Send/remind/candidate: `RequireRecruiterWithIT`
- Public token routes: none (token is the secret)

## Real APIs

See Entry Points. Schemas: `SendItProvisioningRequest`, `ItProvisioningSubmitRequest`, etc.

## Important Files

- `backend/app/api/it_provisioning.py`
- `backend/app/services/it_provisioning_service.py`
- `backend/app/schemas/it_provisioning.py`
- `frontend/app/it-setup/[token]/page.js`
- `frontend/proxy.js` (`PUBLIC_PATHS` for `/it-setup`)

## Modification Guide

1. New submit fields: schema validators + public form + service persistence.
2. Email template changes via email_service / org templates.
3. Keep reset-password from returning passwords in logs or recruiter APIs casually.

## Do Not Break

- Signed-offer prerequisite
- Token secrecy and status checks
- Fernet for stored secrets
- `must_change_password` behavior after IT reset
- Public path registration in proxy

## Testing

- Unsigned offer → send fails
- Submit → candidate shows provisioned
- Edit + reset-password emails
- Invalid token 404
