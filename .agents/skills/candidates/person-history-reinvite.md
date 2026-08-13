---
name: person-history-reinvite
description: >-
  Lookup prior candidate cycles and employee tenures by email; historical
  candidates list for rehire / re-invite decisions.
scope: candidates
related_skills:
  - candidates/SKILL
  - recruitment/invitations
  - recruitment/bulk-invite
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - frontend/services/authService.js
  - frontend/app/dashboard/recruiter/invite/page.js
---

# Person history & re-invite

## Purpose

Before inviting an email, show prior candidate cycles and employee tenures so recruiters avoid conflicts and can rehire thoughtfully. Used by invite UI and bulk preview.

## Location

- `GET /api/employees/person-history?email=` — `lookup_person_history` in `backend/app/api/employees.py`
- `GET /api/employees/historical-candidates` — list with `q`, `reason`, pagination
- Service: `EmployeeService.lookup_person_history`, `list_historical_candidates`
- Client: `lookupPersonHistory`, `listHistoricalCandidates` in `authService.js`
- Consumers: invite page, `BulkInvitePanel.js` (preview attaches history per row)

## Entry Points

1. Invite form email blur/search → person-history.
2. Bulk preview rows include history/conflict flags → `can_send`.
3. Historical candidates directory for rehire outreach.

## Data Flow

```
RequireRecruiterWithCandidates
  → EmployeeService.lookup_person_history(org, email)
  → aggregate candidate cycles + employee tenures for that email in org
Bulk preview
  → same checks per roster row
```

## Business Rules

- Email query min_length 3.
- Historical list: optional `q`, `reason`, `page`, `page_size` (1–100).
- Org-scoped — never return other tenants' history.
- Active employment / active offer conflicts should block or warn (`can_send` in bulk).

## Permissions

`RequireRecruiterWithCandidates` (roles + capability `candidates`).

Note: creating a new invite still needs capability `invite` on invitations routes.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/employees/person-history` | candidates capability |
| GET | `/api/employees/historical-candidates` | candidates capability |

Related write path: `POST /api/invitations` (invite capability).

## Important Files

- `backend/app/services/employee_service.py`
- `backend/app/services/bulk_invite_service.py` (preview integration)
- `frontend/app/dashboard/recruiter/invite/page.js`

## Modification Guide

1. Extend history payload in `lookup_person_history` only with org-safe fields.
2. Keep bulk preview consuming the same semantics.
3. Update invite UI copy when new conflict reasons appear.

## Do Not Break

- Tenant isolation on email lookup.
- Bulk `can_send` / conflict contract.
- Do not expose decrypted banking in history payloads.

## Testing

- Known prior email returns cycles; unknown returns empty structure.
- Other-org email not visible.
- Bulk row with active conflict not `can_send`.
- `py_compile` employees API + employee_service history methods.
