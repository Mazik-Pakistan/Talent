---
name: smtp-templates
description: >-
  TalentAI SMTP transport settings and org_email_templates registry keys —
  invitation, offer, IT, announcement, HR message, and related templates.
scope: email
related_skills:
  - email/SKILL
primary_files:
  - backend/app/services/email_service.py
  - backend/app/services/email_template_service.py
  - backend/app/api/email_templates.py
---

# SMTP & templates

## Purpose

Change transport config or template keys without breaking merge/`_resolve_org_template`.

## Location

- Transport: `smtplib` inside `EmailService`
- Overrides collection: `org_email_templates`
- UI: EmailTemplatesPanel on recruiter learning page

## Entry Points

Template registry/list/get/save/delete APIs; runtime sends via `EmailService`.

## Data Flow

```
settings.SMTP_HOST/PORT/USERNAME/PASSWORD/FROM_*
  + MAIL_USE_TLS / MAIL_USE_SSL
→ EmailService
_resolve_org_template(key) → default ⊕ org override
```

## Business Rules

**Registry keys (23):**  
`candidate_invitation`, `offer_invitation`, `employee_welcome`, `offer_letter`, `offer_validity_extended`, `offer_clarification_request`, `offer_clarification_result`, `it_service_request`, `document_reupload_request`, `document_status_update`, `it_provisioning_*` variants, `first_time_password`, `banking_details_notice`, `company_email_assigned`, `asset_assigned`, `orientation_scheduled`, `profile_completion_reminder`, `candidate_onboarding_reminder`, `announcement`, `custom_reminder`, `hr_message`.

Notable methods: `send_signup_otp`, `send_forgot_password_otp`, invitations/offers, `send_employee_activation`, document/IT/orientation/banking mails, reminders, `send_announcement`, `send_custom_reminder`, `send_hr_message`.

## Permissions

As email overview — registry public; mutations need recruiter/SA + `org_config` or `learning`.

## APIs (real)

See email `SKILL.md`.

## Important Files

- `email_template_service.py`
- `config.py` SMTP fields
- `orgFrameworkService.js` template helpers

## Modification Guide

1. Add key to registry + default content + `send_*` method.
2. Update FE panel if it enumerates keys client-side.
3. Keep placeholder variable names documented in registry metadata.

## Do Not Break

- DELETE = reset override (not delete ability to send).
- FROM address / logo URL substitution.
- Password/OTP emails must remain functional for auth.

## Testing

- GET registry returns all keys.
- PUT override → GET returns override → send reflects it → DELETE restores default.
- TLS vs SSL env combinations documented in `.env.example`.
