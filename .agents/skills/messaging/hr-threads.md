---
name: hr-threads
description: >-
  TalentAI hr_threads collection behavior — access checks, start/reply/close,
  and notification/email fanout details for HR messaging.
scope: messaging
related_skills:
  - messaging/SKILL
  - ai-agent/confirm-gate
primary_files:
  - backend/app/services/message_service.py
  - backend/app/api/messages.py
  - backend/app/core/database.py
---

# HR threads

## Purpose

Implement or debug thread lifecycle and access control for `hr_threads`.

## Location

- Service methods: `list_threads_for_employee/candidate/recruiter`, `get_thread`, `employee_send`, `candidate_send`, `recruiter_start`, `recruiter_reply`, `close_thread`
- Indexes: `create_database_indexes()` in `database.py` for `hr_threads`
- Agent: `agent_tools_parity.py` (close uses `confirm_gate`)

## Entry Points

REST under `/api/messages*` and agent HR tools.

## Data Flow

```
_assert_access(thread, user)
  → append message / set status closed
  → _notify_counterpart → notifications + optional email
```

## Business Rules

- Status open vs closed; closed → no new messages.
- Recruiter lists only own threads; employee/candidate only own participation.
- Start by recruiter: `POST /api/messages/start`; employee: `POST /api/messages`.
- Agent `close_hr_thread` requires confirm gate.

## Permissions

Recruiter capability `messages`. Roles as in messaging overview. Candidates lack a dedicated REST start endpoint.

## APIs (real)

See messaging `SKILL.md` table.

## Important Files

- `message_service.py`
- `frontend/services/messageService.js`
- Pages under `dashboard/recruiter/messages`, `dashboard/employee/messages`

## Modification Guide

1. Any new participant type → update `_assert_access` + list filters + indexes.
2. Keep audit/notification payload fields (`type: hr_message`, link, related_id) consistent with UI deep links.
3. Mirror agent tools when REST behavior changes.

## Do Not Break

- Assignment checks (employee/candidate ↔ assigned recruiter).
- Soft-fail on email.
- Confirm gate on agent close.

## Testing

- Unauthorized user fetching another thread → 403/404 as implemented.
- Close then reply → rejected.
- Agent close confirm Approve closes once.
