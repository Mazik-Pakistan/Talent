---
name: notifications
description: >-
  TalentAI notifications collection — create_notification helper, list/mark-read
  APIs, and shell polling via useNotificationsCenter.
scope: notifications-announcements
related_skills:
  - notifications-announcements/SKILL
  - notifications-announcements/announcements
primary_files:
  - backend/app/services/dashboard_service.py
  - backend/app/api/dashboard.py
  - frontend/hooks/useNotificationsCenter.js
  - frontend/services/authService.js
---

# Notifications

## Purpose

Implement the shared in-app notification inbox without inventing per-feature notification stores.

## Location

- Writer: `create_notification()` in `dashboard_service.py`
- Reader/mark: `DashboardService.get_notifications`, `mark_notifications_read`
- Router: `GET /api/notifications`, `PUT /api/notifications/read`
- Schema: `MarkNotificationsReadRequest` (`ids`, `all`)
- FE: `getNotifications`, `markNotificationsRead` in `authService.js`; `useNotificationsCenter.js`
- Agent: `list_notifications`, `mark_notifications_read`

## Entry Points

Any service emitting user-visible events (messages, tickets, offers, docs, learning, invitations, announcements, …).

## Data Flow

```
create_notification(...) → insert notifications → return id
Shell poll → GET /api/notifications?limit=
User click → PUT /api/notifications/read { ids | all: true }
```

## Business Rules

- Scoped to current user as recipient.
- `link` should be an in-app path the role can open.
- Do not put secrets in `message`.

## Permissions

`RequireUser` (any authenticated role).

## APIs (real)

| Method | Path | Body |
|--------|------|------|
| GET | `/api/notifications?limit=` | — |
| PUT | `/api/notifications/read` | `{ ids: [], all: bool }` |

## Important Files

- `dashboard_service.py`
- `useNotificationsCenter.js` (poll interval ~20s)
- Role shells consuming the hook

## Modification Guide

1. Always use `create_notification` — do not insert ad hoc.
2. Keep `type` strings stable for UI icons/filtering.
3. On logout, existing hook teardown should stop polling.

## Do Not Break

- Mark-read `all` vs `ids` contract.
- Shell hook import path shared across Recruiter/Employee/Candidate shells.

## Testing

- Insert notification → appears within one poll.
- Mark one id vs mark all.
- Agent list/mark tools hit same service.
