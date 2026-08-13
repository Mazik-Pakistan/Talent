---
name: email
description: >-
  TalentAI SMTP email and org-overridable templates — EmailService send path and
  /api/email-templates registry. Use when changing mail content or SMTP config.
scope: email
related_skills:
  - email/smtp-templates
  - notifications-announcements/announcements
  - messaging/hr-threads
primary_files:
  - backend/app/services/email_service.py
  - backend/app/services/email_template_service.py
  - backend/app/api/email_templates.py
  - backend/app/core/config.py
---

# Email (overview)

## Purpose

All transactional email goes through `EmailService` (SMTP). Orgs can override HTML/subject templates via `org_email_templates`.

## Location

| Layer | Path |
|-------|------|
| Sender | `backend/app/services/email_service.py` |
| Templates | `email_template_service.py` + `api/email_templates.py` |
| Config | `SMTP_*`, `MAIL_USE_TLS/SSL`, `EMAIL_LOGO_URL` |
| FE panel | `frontend/app/dashboard/recruiter/learning/EmailTemplatesPanel.js` |
| FE API | `frontend/services/orgFrameworkService.js` |

## Entry Points

Other services call `email_service.send_*` methods. No public “send arbitrary email” API.

## Data Flow

```
Caller → EmailService method
  → _resolve_org_template(key, org) merge overrides
  → smtplib SSL or STARTTLS → login → sendmail
```

## Business Rules

- Email failures should **soft-fail** where product flows must continue (messages, announcements).
- Gmail app passwords: spaces stripped in validator.
- Registry is the catalog of overridable keys (~23).

## Permissions

Template CRUD: recruiter/super_admin with `org_config` **or** `learning`. Registry GET is public.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/email-templates/registry` | Public |
| GET | `/api/email-templates` | org_config or learning |
| GET/PUT/DELETE | `/api/email-templates/{key}` | same (+ write rules) |

## Important Files

- `email_service.py` — all `send_*` methods
- `email_templates.py` router
- SMTP settings in `config.py`

## Modification Guide

1. New email type → add `send_*` + registry key + default body; wire callers.
2. Prefer org template resolution over hardcoding subjects in callers.
3. Never log full recipient bodies with secrets (temp passwords, banking).

## Do Not Break

- Soft-fail behavior on SMTP errors for non-critical paths.
- Registry key stability (FE panel depends on keys).
- TLS/SSL configuration matrix.

## Testing

- Send one invitation/OTP in staging with real SMTP.
- Override a template → send uses override; DELETE resets.
- Bad SMTP creds → caller still succeeds where soft-fail expected.
