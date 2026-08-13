---
name: reminders
description: >-
  Throttled candidate/employee/course reminder emails and in-app nudges via
  reminder_service (onboarding, profile, reupload, course, general).
scope: reminders
related_skills:
  - employees/SKILL
  - candidates/SKILL
  - learning/assignments-analytics
  - email/smtp-templates
  - recruitment/pipeline-search
primary_files:
  - backend/app/services/reminder_service.py
  - backend/app/api/employees.py
  - backend/app/api/learning.py
  - frontend/components/recruiter/SendReminderModal.js
---

# Reminders

## Purpose

Send throttled reminder emails (and related notifications) for incomplete onboarding, profile completion, document reupload, learning assignments, or general nudges — without spamming users.

## Location

| Layer | Path |
|-------|------|
| Service | `backend/app/services/reminder_service.py` |
| Call sites | `employees.py` (candidate/employee remind), `learning.py` (course remind), agent tools (`remind_*`) |
| Email | `email_service` + templates |
| UI | `frontend/components/recruiter/SendReminderModal.js`, candidate/employee detail actions |

## Entry Points

- Recruiter candidate detail → remind candidate
- Recruiter employee detail → remind profile / general
- Learning assignments → remind courses
- Agent tools: `remind_candidate`, `bulk_remind_*`, `remind_employee_profile`, `send_reminder`, etc.

## Data Flow

```
UI/agent → employees/learning router (capability-gated)
  → reminder_service.send_* / remind_courses
  → throttle check (~3600s unless force=True)
  → email_service (+ optional notification)
```

## Business Rules

- Kinds used in service: `onboarding | profile | reupload | course | general` (verify exact set in file before extending).
- Default throttle **~1 hour** unless `force` is passed.
- Always org/people-scope the target user; never remind across tenants.
- Prefer existing modal/API rather than inventing a parallel remind endpoint.

## Permissions

- Candidate remind: recruiter + capability `candidates`
- Employee/profile remind: recruiter + capability `employees` (as wired on the route)
- Course remind: recruiter + capability `learning`

## APIs (real)

Examples (confirm exact paths in routers before changing):

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/employees/candidates/{candidate_id}/remind` | Candidate nudge |
| POST | `/api/employees/detail/{employee_id}/remind` | Employee remind |
| POST | `/api/employees/detail/{employee_id}/remind-profile` | Profile completion |
| Learning assignment remind | under `/api/learning/...` | Course assignment remind as implemented |

## Important Files

- `backend/app/services/reminder_service.py`
- `backend/app/services/email_service.py`
- `frontend/components/recruiter/SendReminderModal.js`

## Modification Guide

1. Add new remind kinds in `reminder_service` first, then wire router + UI.
2. Preserve throttle unless product explicitly asks for different cadence.
3. Keep agent remind tools calling the same service functions as REST.

## Do Not Break

- Throttle / `force` semantics.
- Tenant scoping of target emails.
- Agent tool parity with dashboard remind actions.

## Common Bugs

- Reminder appears “broken” but is throttled — check last-sent timestamp.
- Wrong capability on composed dependency → 403.

## Testing

- Send remind twice quickly → second should throttle (unless force).
- Confirm email path in DEBUG logs / SMTP sandbox.
- Agent remind tool should need same caps as UI.
