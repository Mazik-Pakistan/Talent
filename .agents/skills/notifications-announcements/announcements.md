---
name: announcements
description: >-
  TalentAI announcements CRUD, audience targeting, notification fanout, optional
  email, and HTML sanitization. Use when changing announcement features.
scope: notifications-announcements
related_skills:
  - notifications-announcements/SKILL
  - notifications-announcements/notifications
  - email/smtp-templates
primary_files:
  - backend/app/services/dashboard_service.py
  - backend/app/api/dashboard.py
  - backend/app/schemas/dashboard.py
  - frontend/app/dashboard/recruiter/announcements/page.js
---

# Announcements

## Purpose

Recruiter-authored org announcements with targeted fanout to candidates and/or employees.

## Location

- Service: `list/create/update/delete_announcement`, `_fanout_announcement`, `_announcement_tenant_scope`
- Schemas: `CreateAnnouncementRequest`, `UpdateAnnouncementRequest`
- Page: `frontend/app/dashboard/recruiter/announcements/page.js`
- Client: `listAnnouncements`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` in `authService.js`
- Agent: list/create in core tools; update/delete + `list_my_announcements` in parity (`delete_announcement` confirm-gated)

## Entry Points

Recruiter announcements UI; recipient home feeds; agent announcement tools.

## Data Flow

```
POST /api/announcements
  → sanitize HTML lightly
  → insert announcements (organization_id, created_by)
  → _fanout_announcement → notifications
  → optional email_service.send_announcement (send_email default true)
```

## Business Rules

- Audience: `candidates` | `employees` | `both`.
- Targeting: departments / designations / employee_ids / candidate_ids (must match audience type).
- Update may `notify_again` / `send_email`.
- Recruiter manages **own** announcements only; lists tenant-scoped.
- Recipients hide announcements published before their account `created_at`.
- Sanitize: strip script / on* / javascript: patterns on create.

## Permissions

`RequireRecruiter` + capability `announcements` for writes; `RequireUser` for list (role-filtered).

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/announcements?limit=&audience=` |
| POST | `/api/announcements` |
| PUT | `/api/announcements/{announcement_id}` |
| DELETE | `/api/announcements/{announcement_id}` |

## Important Files

- `dashboard_service.py`, `schemas/dashboard.py`
- `email_service.send_announcement`
- Recruiter nav capability `announcements`

## Modification Guide

1. Extend targeting carefully with validation against audience.
2. Keep audit_logs behavior if already written on mutations.
3. Mirror agent delete confirm gate.

## Do Not Break

- Tenant + creator ownership rules.
- Fanout + email soft-fail.
- Pre-`created_at` hide rule for recipients.

## Testing

- Target one department → only those employees notified.
- Delete via UI and via agent confirm.
- Recruiter cannot delete another recruiter’s announcement.
