---
name: admin-tickets
description: >-
  TalentAI super-admin tickets — /api/admin/tickets assign, resolve, merge,
  export, audit, and SupportTicketsPanel.
scope: tickets
related_skills:
  - tickets/SKILL
  - tickets/recruiter-tickets
  - super-admin/SKILL
  - ai-agent/role-tool-lists
primary_files:
  - backend/app/api/admin_tickets.py
  - backend/app/services/ticket_service.py
  - frontend/components/super-admin/SupportTicketsPanel.js
---

# Admin tickets

## Purpose

Platform-level ticket operations for Super Admins across organizations.

## Location

- Router: `backend/app/api/admin_tickets.py`
- UI: `SupportTicketsPanel.js` on super-admin dashboard
- Agent tools: list/get/assign/reply/status/priority/resolve/close/reopen/delete/activity + stats

## Entry Points

Super Admin Support tab; SA agent ticket tools; optional CSV export.

## Data Flow

```
Admin list (filters: assigned_to, organization_id, sort)
  → assign / reply / status / priority / resolve / close / reopen / merge / delete
  → ticket_activity + ticket_audit_logs + notifications
```

## Business Rules

- Cross-org visibility for super_admin.
- Soft-delete and merge are admin-only.
- Status/priority changes notify creator and/or assignee/admins as implemented.
- Agent `delete_ticket` uses `confirm_gate`.

## Permissions

`require_roles("super_admin")` on all `/api/admin/tickets*` routes.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/admin/tickets` |
| GET | `/api/admin/tickets/stats` |
| GET | `/api/admin/tickets/export` |
| GET/PATCH | `/api/admin/tickets/{id}` |
| POST | `.../assign`, `.../reply`, `.../close`, `.../resolve`, `.../reopen`, `.../delete`, `.../merge`, `.../upload` |
| PATCH | `.../status`, `.../priority` |
| GET | `.../activity`, `.../audit` |

## Important Files

- `admin_tickets.py`, `ticket_service.py`
- `agent_tools_super_admin.py` ticket tools
- `SupportTicketsPanel.js`

## Modification Guide

1. New admin action → router + service + audit + FE panel + optional agent tool.
2. Export columns should avoid leaking secrets.
3. Keep organization_id filter for support triage.

## Do Not Break

- Audit/activity history integrity.
- Confirm gate on agent delete.
- Recruiter router remains unable to call these paths.

## Testing

- Assign → assignee notified.
- Merge two tickets.
- Export CSV downloads.
- Delete via agent requires Approve.
