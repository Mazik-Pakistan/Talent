---
name: notifications-announcements
description: >-
  TalentAI in-app notifications and org announcements — dashboard APIs, fanout,
  shell polling. Use when changing notification center or announcements CRUD.
scope: notifications-announcements
related_skills:
  - notifications-announcements/notifications
  - notifications-announcements/announcements
  - email/SKILL
  - messaging/SKILL
primary_files:
  - backend/app/api/dashboard.py
  - backend/app/services/dashboard_service.py
  - backend/app/schemas/dashboard.py
  - frontend/hooks/useNotificationsCenter.js
---

# Notifications & announcements (overview)

## Purpose

Shared in-app notification channel plus recruiter-authored announcements with optional email.

## Location

| Concern | Path |
|---------|------|
| Router | `backend/app/api/dashboard.py` |
| Service | `backend/app/services/dashboard_service.py` |
| Schemas | `backend/app/schemas/dashboard.py` |
| Collections | `notifications`, `announcements` |
| Shell hook | `frontend/hooks/useNotificationsCenter.js` |
| Client helpers | `frontend/services/authService.js` |

## Entry Points

- Shells poll notifications ~20s.
- Recruiter announcements page; recipients see announcements on home feeds.
- Many services call `create_notification()`.

## Data Flow

```
Event writers → create_notification → notifications collection
Recruiter CRUD announcement → _fanout_announcement → notifications (+ optional email)
UI → GET /api/notifications → mark read PUT /api/notifications/read
```

## Business Rules

- Notification shape: `recipient_id`, `recipient_role`, `type`, `title`, `message`, `link`, `related_id`, `read`, `created_at`.
- Announcements: audience `candidates` | `employees` | `both`; targeting by dept/designation/ids; tenant-scoped; creator-owned for recruiter edits.

## Permissions

- Notifications: `RequireUser`.
- Announcement write: `RequireRecruiter` + capability `announcements`.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/notifications?limit=` |
| PUT | `/api/notifications/read` |
| GET | `/api/announcements` |
| POST/PUT/DELETE | `/api/announcements` (+ `/{id}`) |

## Important Files

- `dashboard_service.py` — `create_notification`, announcement CRUD + fanout
- `useNotificationsCenter.js`

## Modification Guide

1. New event type → call `create_notification` with stable `type` + deep `link`.
2. Announcement targeting changes → keep audience/target consistency checks.
3. Agent tools mirror list/create/update/delete as in `agent_tools*.py`.

## Do Not Break

- Polling hook contract used by all role shells.
- Fanout + optional email path on create/update.
- Tenant scope on announcement lists.

## Testing

- Create announcement → recipients get notification.
- Mark read all → unread clears in shell.
- Recruiter without `announcements` → 403 on write.
