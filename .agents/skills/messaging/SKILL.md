---
name: messaging
description: >-
  TalentAI HR messaging threads — recruiter/employee/candidate conversations,
  notifications+email side effects. Use when changing messages API or pages.
scope: messaging
related_skills:
  - messaging/hr-threads
  - notifications-announcements/notifications
  - email/SKILL
primary_files:
  - backend/app/api/messages.py
  - backend/app/services/message_service.py
  - frontend/services/messageService.js
---

# Messaging (overview)

## Purpose

1:1 HR threads between recruiters and employees/candidates, with in-app notification and email fanout.

## Location

| Layer | Path |
|-------|------|
| Router | `backend/app/api/messages.py` (`/api/messages`) |
| Service | `backend/app/services/message_service.py` |
| Collection | `hr_threads` |
| Frontend | `app/dashboard/recruiter/messages`, `app/dashboard/employee/messages` |
| Client | `frontend/services/messageService.js` |

## Entry Points

List/get/reply/close via REST; agent tools `list_hr_threads`, `message_recruiter`, `message_employee`, `reply_hr_thread`, `close_hr_thread`.

## Data Flow

```
Sender → MessageService → hr_threads update
  → create_notification (hr_message)
  → email_service.send_hr_message (soft-fail)
```

## Business Rules

- One **open** thread per employee–recruiter (or candidate–recruiter) pair.
- Parties only message assigned recruiter / own threads.
- Closed threads reject new messages.
- `candidate_send` exists in service + agent tools; **no dedicated candidate REST start route** (candidates use agent/parity paths).

## Permissions

- List/get/close: `RequireAny` (+ recruiter capability `messages`).
- Employee start/reply: `RequireEmployee`.
- Recruiter start/reply: `RequireRecruiter` + `messages`.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/messages` | RequireAny (+ cap) |
| GET | `/api/messages/{thread_id}` | same |
| POST | `/api/messages` | RequireEmployee |
| POST | `/api/messages/start` | RequireRecruiter + messages |
| POST | `/api/messages/{thread_id}/reply` | recruiter + messages |
| POST | `/api/messages/{thread_id}/close` | RequireAny (+ cap) |

## Important Files

- `message_service.py` — `_assert_access`, `_notify_counterpart`
- Recruiter nav capability `messages`

## Modification Guide

1. Business logic in `MessageService` only.
2. Keep notification + email side effects; email must soft-fail.
3. Agent tools must call the same service methods.

## Do Not Break

- Open-thread uniqueness per pair.
- Tenant/assignment scoping (no cross-recruiter reads).
- Soft-fail email on SMTP errors.

## Testing

- Employee↔recruiter thread create/reply/close.
- Second open thread for same pair rejected.
- Notification appears for counterpart.
