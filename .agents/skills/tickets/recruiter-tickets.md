---
name: recruiter-tickets
description: >-
  TalentAI recruiter support tickets API — create, list, reply, close, upload
  under /api/tickets and the Support dashboard page.
scope: tickets
related_skills:
  - tickets/SKILL
  - tickets/admin-tickets
primary_files:
  - backend/app/api/tickets.py
  - backend/app/services/ticket_service.py
  - frontend/app/dashboard/recruiter/support/page.js
---

# Recruiter tickets

## Purpose

Recruiter-facing support ticket CRUD/reply without exposing admin-only operations.

## Location

- Router: `backend/app/api/tickets.py`
- Page: `frontend/app/dashboard/recruiter/support/page.js`
- Nav capability: `support`
- Agent: `create_support_ticket`

## Entry Points

Support page and agent create tool.

## Data Flow

```
POST /api/tickets → TicketService.create → notify super_admins
GET /api/tickets (filters) → recruiter-owned list
reply/close/upload → updates + notifications
```

## Business Rules

- Filters: status, priority, category, page, search.
- Recruiter sees **own** tickets only.
- Close is recruiter-allowed; resolve/assign/merge are admin-side.

## Permissions

`RequireRecruiter`. UI gated by capability `support`.

## APIs (real)

| Method | Path |
|--------|------|
| POST | `/api/tickets` |
| GET | `/api/tickets` |
| GET | `/api/tickets/stats/my` |
| GET | `/api/tickets/{ticket_id}` |
| PATCH | `/api/tickets/{ticket_id}` |
| POST | `/api/tickets/{ticket_id}/reply` |
| POST | `/api/tickets/{ticket_id}/close` |
| POST | `/api/tickets/{ticket_id}/upload` |

## Important Files

- `tickets.py`, `ticket_service.py`, `authService.js` ticket helpers

## Modification Guide

1. Keep admin-only actions out of this router.
2. Upload path must enforce ownership + size limits consistent with storage rules.
3. Mirror list filters in the Support page.

## Do Not Break

- Stats endpoint path `/stats/my`.
- Create → super admin notification.
- Capability `support` nav mapping.

## Testing

- Create/list/reply/close as recruiter.
- Another recruiter cannot read the ticket.
- Upload attachment then fetch detail.
