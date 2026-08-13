---
name: it-service-requests-employee-recruiter-public-fulfill
description: >-
  Full IT service request flows: recruiter list/create/send/cancel, employee /me,
  public fulfill under /api/it-service-requests. Use when changing ticket lifecycle.
---

# IT Service Requests — Employee, Recruiter & Public Fulfill

## Purpose

Document the three actors’ API surface and status transitions for IT support requests.

## Location

- `backend/app/api/it_service_requests.py`
- `it_service_request_service.py` — `list_recruiter`, `create_for_employee`, `send_to_it`, `cancel`, `list_employee`, `create_employee_draft`, `close_by_employee`, `get_public`, `fulfill_public`, `officers_overview`
- Frontend pages: employee `it-support`, public `it-support/[token]`, recruiter IT dashboard
- `authService.js`: `listItServiceRequests`, `createItServiceRequest`, `sendItServiceRequest`, `getItServiceRequestPublic`, `fulfillItServiceRequestPublic`, `getItOfficersOverview`, plus employee `/me` wrappers if present

## Entry Points

| Method | Path | Actor |
|--------|------|-------|
| GET | `/api/it-service-requests/officers/overview` | Recruiter |
| GET | `/api/it-service-requests` | Recruiter (`status` query) |
| POST | `/api/it-service-requests` | Recruiter create |
| POST | `/api/it-service-requests/send` | Recruiter email IT |
| POST | `/api/it-service-requests/{request_id}/cancel` | Recruiter |
| GET | `/api/it-service-requests/me` | Employee |
| POST | `/api/it-service-requests/me` | Employee draft |
| POST | `/api/it-service-requests/me/{request_id}/close` | Employee |
| GET | `/api/it-service-requests/public/{token}` | Public |
| POST | `/api/it-service-requests/public/{token}/fulfill` | Public |

## Data Flow

```
create (recruiter or employee draft)
  → send → token email to IT officer
  → public GET context → fulfill (assets/notes/resolution)
  → employee close confirms resolved
cancel → terminal; fulfill rejected
officers/overview → operational view across IT contacts
```

## Business Rules

- Schemas: `ItServiceRequestCreate`, `ItServiceRequestSendRequest`, `ItServiceRequestCancelRequest`, `ItServiceRequestEmployeeCreate`, `ItServiceRequestFulfillRequest`.
- IT email cannot be an in-app recruiter/candidate/super_admin mailbox (validation in service).
- Employee close only on own open/fulfilled requests per service rules.
- Org/recruiter ownership on cancel and send.

## Permissions

- Recruiter routes: capability `it`
- Employee `/me*`: employee role
- Public: token

## Real APIs

See Entry Points. Collection: `it_service_requests` (unique token; indexes recruiter/employee/status).

## Important Files

- `backend/app/api/it_service_requests.py`
- `backend/app/services/it_service_request_service.py`
- `backend/app/schemas/it_service_request.py`
- `frontend/app/dashboard/employee/it-support/page.js`
- `frontend/app/it-support/[token]/page.js`
- `frontend/services/authService.js`
- `frontend/proxy.js`

## Modification Guide

1. Status enum changes: update service transitions + all three UIs + overview.
2. Fulfill payload: schema + public page + any notification copy.
3. Keep provisioning overview separate unless intentionally joining more fields.

## Do Not Break

- Status machine on public fulfill
- Token uniqueness
- Capability `it` for recruiter
- Employee cannot cancel/fulfill others’ requests via `/me`
- Public `/it-support` allowlisted in proxy

## Testing

- Happy path recruiter + employee-originated
- Cancel then fulfill fails
- Bad token 404
- Officer email validation rejects recruiter address
- Recruiter without `it` capability 403
