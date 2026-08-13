---
name: tickets
description: >-
  TalentAI support tickets — recruiter /api/tickets and super-admin
  /api/admin/tickets. Use when changing ticket lifecycle, replies, or UI panels.
scope: tickets
related_skills:
  - tickets/recruiter-tickets
  - tickets/admin-tickets
  - notifications-announcements/notifications
  - super-admin/SKILL
primary_files:
  - backend/app/api/tickets.py
  - backend/app/api/admin_tickets.py
  - backend/app/services/ticket_service.py
  - backend/app/schemas/ticket.py
---

# Tickets (overview)

## Purpose

Recruiter-created support tickets escalated to Super Admins, with replies, status, assignment, and audit trails.

## Location

| Layer | Path |
|-------|------|
| Recruiter router | `backend/app/api/tickets.py` → `/api/tickets` |
| Admin router | `backend/app/api/admin_tickets.py` → `/api/admin/tickets` |
| Service | `backend/app/services/ticket_service.py` |
| Schema | `backend/app/schemas/ticket.py` |
| Collections | `tickets`, `ticket_replies`, `ticket_activity`, `ticket_audit_logs` |
| FE recruiter | `frontend/app/dashboard/recruiter/support/page.js` |
| FE admin | `frontend/components/super-admin/SupportTicketsPanel.js` |
| Client | ticket helpers in `frontend/services/authService.js` |

## Entry Points

Recruiter Support page (cap `support`); Super Admin Support tab; agent `create_support_ticket`.

## Data Flow

```
Recruiter create → unique ticket_id → notify all super_admins (ticket_created)
Admin assign/reply/status → activity + audit + notifications
```

## Business Rules

- Status: `open`, `in_progress`, `waiting`, `resolved`, `closed`
- Priority: `low`, `medium`, `high`, `critical`
- Categories/modules: fixed enums in schema
- Recruiter owns own tickets; admin can assign, merge, soft-delete, export CSV

## Permissions

- Recruiter routes: `RequireRecruiter` (+ UI capability `support`)
- Admin routes: `require_roles("super_admin")`

## APIs (real)

See child skills for full tables. Prefixes: `/api/tickets`, `/api/admin/tickets`.

## Important Files

- `ticket_service.py`, `schemas/ticket.py`
- Agent create tool in `agent_tools.py`
- Admin agent ticket tools in `agent_tools_super_admin.py`

## Modification Guide

1. Enum changes → schema + FE filters + notifications copy.
2. Keep activity/audit writes on status transitions.
3. Agent delete ticket remains confirm-gated for SA.

## Do Not Break

- Notification on create to all super admins.
- Recruiter cannot access admin merge/delete/export.
- Soft-delete semantics if used.

## Testing

- Create as recruiter → visible in admin list.
- Assign/reply/resolve/close/reopen paths.
- Export CSV as SA.
- `py_compile` ticket modules; existing `backend/tests` agent ticket tests if present.
