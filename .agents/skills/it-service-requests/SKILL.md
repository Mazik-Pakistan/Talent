---
name: it-service-requests
description: >-
  IT service requests under /api/it-service-requests: recruiter create/send/cancel,
  employee me draft/close, public token fulfill. Capability it for recruiter.
---

# IT Service Requests

## Purpose

Ongoing IT support tickets separate from onboarding provisioning: recruiter or employee create requests; IT fulfills via public token; employee can confirm close.

## Location

- Router: `backend/app/api/it_service_requests.py` — prefix **`/api/it-service-requests`**
- Service: `backend/app/services/it_service_request_service.py`
- Schema: `backend/app/schemas/it_service_request.py`
- Frontend: `authService.js` IT service helpers; `frontend/app/dashboard/employee/it-support/page.js`; `frontend/app/it-support/[token]/page.js`; recruiter IT dashboard

## Entry Points

| Actor | Routes |
|-------|--------|
| Recruiter + `it` | GET/POST ``, POST `/send`, POST `/{id}/cancel`, GET `/officers/overview` |
| Employee | GET/POST `/me`, POST `/me/{id}/close` |
| Public | GET `/public/{token}`, POST `/public/{token}/fulfill` |

## Data Flow

```
Recruiter create → optional send email with public token → IT fulfill
Employee draft (/me) → recruiter send → fulfill → employee close
officers/overview → join provisioning + service request history for IT contacts
```

## Business Rules

- Unique `token` on `it_service_requests`.
- IT officer email validation rejects recruiter/candidate/super_admin addresses as IT officer.
- Public fulfill must respect status machine (no fulfill when cancelled/closed incorrectly).
- Cancel/send ownership org/recruiter scoped.

## Permissions

- Recruiter: `RequireRecruiterWithIT` (capability **`it`**)
- Employee: `require_roles("employee", "super_admin")`
- Public: token only

## Real APIs

Base **`/api/it-service-requests`**. See `employee-recruiter-public-fulfill.md`.

## Important Files

- `backend/app/api/it_service_requests.py`
- `backend/app/services/it_service_request_service.py`
- `backend/app/schemas/it_service_request.py`
- `frontend/services/authService.js`
- `frontend/app/it-support/[token]/page.js`
- `frontend/proxy.js` (`/it-support` public)

## Modification Guide

1. New request fields: schema + create forms (recruiter + employee) + public fulfill page.
2. Keep officers overview aggregations in sync when status enums change.
3. Email send path uses existing email_service patterns.

## Do Not Break

- Capability `it`
- Token uniqueness and public status checks
- Employee close only for own requests
- Do not confuse with `/api/it-provisioning` onboarding flow

## Testing

- Capability audit for IT
- Employee create → recruiter send → public fulfill → employee close
- Cancel blocks fulfill
- Manual proxy public path

## Related

- `employee-recruiter-public-fulfill.md`
- Sibling: `../it-provisioning/` (onboarding kits/send — different module)
