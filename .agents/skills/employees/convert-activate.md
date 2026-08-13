---
name: convert-activate
description: >-
  Generate employee IDs, convert candidates to employees, ready-for-conversion
  queue, and offer approve activation path.
scope: employees
related_skills:
  - employees/SKILL
  - offers/offer-lifecycle
  - employees/day1-assets-orientation
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - backend/app/services/offer_service.py
  - frontend/services/authService.js
---

# Convert & activate

## Purpose

Turn a finished candidate into an active employee (ID allocation, create-from-candidate, offer approve) without skipping IT/docs gates encoded in approve.

## Location

- `POST /api/employees/generate-id` — preview/allocate `EMP-######`
- `POST /api/employees/create-from-candidate` — body `{ candidate_id }`
- `GET /api/employees/ready-for-conversion`
- Offer path: `POST /api/offers/{offer_id}/approve`
- Service: `EmployeeService.generate_employee_id`, `create_from_candidate`, `list_ready_for_conversion`; `offer_service.approve`
- Schemas: `GenerateEmployeeIdRequest`, `CreateFromCandidateRequest`, `OfferApproveRequest`
- Client: `generateEmployeeId`, `createEmployeeFromCandidate`, `getReadyForConversion`, `approveOffer`
- IT pre-req often via `backend/app/api/it_provisioning.py` (send/submit) before approve

## Entry Points

1. Recruiter employees/candidates UI → ready queue → create-from-candidate.
2. Approve signed offer after docs + IT provisioning complete.
3. Optional generate-id before create.

## Data Flow

```
RequireRecruiterWithEmployees
  → create_from_candidate / generate_employee_id
  → employees collection active; candidate marked converted
approve(offer)
  → validates signed + docs + IT → activates employee
```

On-site hires may trigger `banking_required` notification to recruiter after activation.

## Business Rules

- Capability `employees` required (not only `invite`).
- Candidate already converted → conflict on new offers/create.
- Approve is the gated activation path described on the offers router.
- Employee IDs unique per year pattern in `generate_employee_id`.

## Permissions

`RequireRecruiterWithEmployees` on employee convert endpoints.
Approve: `RequireRecruiterWithInvite` on offers (invite capability) — both may be needed across the journey.

## APIs (real)

| Method | Path |
|--------|------|
| POST | `/api/employees/generate-id` |
| POST | `/api/employees/create-from-candidate` |
| GET | `/api/employees/ready-for-conversion` |
| POST | `/api/offers/{offer_id}/approve` |

Related IT: `/api/it-provisioning/send`, `/remind`, `/candidate/{candidate_id}`, public `/api/it-provisioning/{token}/submit`.

## Important Files

- `backend/app/services/employee_service.py`
- `backend/app/services/offer_service.py` (`approve`)
- `backend/app/services/it_provisioning_service.py`

## Modification Guide

1. Keep conversion transactional invariants (candidate status + employee row).
2. Do not bypass IT/docs checks in approve without explicit product change.
3. Update recruiter UI queues + authService.

## Do Not Break

- Ready-for-conversion criteria.
- Dual capability needs across invite approve vs employees create.
- Banking nudge for on-site after activation.

## Testing

- Ready list → create-from-candidate → employee `/me` works.
- Approve without IT/docs fails as designed.
- Duplicate convert → error.
- `py_compile` employees + offer approve + it_provisioning touchpoints.
