---
name: pipeline-search
description: >-
  Recruiter candidate pipeline lists, filters, reminders, and global search for
  TalentAI hiring workflows.
scope: recruitment
related_skills:
  - recruitment/SKILL
  - candidates/SKILL
  - candidates/person-history-reinvite
primary_files:
  - backend/app/api/employees.py
  - backend/app/api/dashboard.py
  - backend/app/services/employee_service.py
  - frontend/app/dashboard/recruiter/candidates/page.js
---

# Pipeline & search

## Purpose

List and filter candidates in the hiring pipeline, open detail, send reminders, and run global search — all org-scoped with `candidates` capability.

## Location

- Lists/detail/remind: `backend/app/api/employees.py`
- Service: `backend/app/services/employee_service.py`, `backend/app/services/reminder_service.py`
- Search: `GET /api/search` in `backend/app/api/dashboard.py`
- UI: `frontend/app/dashboard/recruiter/candidates/page.js`, `candidates/[id]/page.js`
- Client: `listCandidates`, `getCandidateDetail`, `remindCandidateOnboarding`, `getPendingReview`, `getOnboardingInProgress`, `globalSearch` in `authService.js`

## Entry Points

1. Recruiter Candidates nav → filtered `GET /api/employees/candidates`.
2. Queues: pending review, onboarding in progress.
3. Candidate detail page → remind.
4. Shell global search → `GET /api/search?q=`.

## Data Flow

```
RequireRecruiterWithCandidates
  → EmployeeService.list_candidates / get_candidate_detail / ...
  → Mongo candidates (+ related offers/docs) filtered by organization_id
Remind → reminder_service.send_candidate_reminder (email + notification)
```

## Business Rules

- List query params: `q`, `status`, `profile_status`, `progress_min`/`progress_max`, `joined_from`/`joined_to`, `page`, `page_size` (1–100).
- Reminder body: `kind` (default `onboarding`), optional `note`, `force`/`resend`.
- Search: `q` length 1–120; capability `candidates`.
- Always scope by recruiter `organization_id`.

## Permissions

`RequireRecruiterWithCandidates` = roles `recruiter|super_admin` + capability `candidates`.

Search: `RequireRecruiter` + `require_capabilities("candidates")`.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/employees/candidates` |
| GET | `/api/employees/candidates/{candidate_id}` |
| POST | `/api/employees/candidates/{candidate_id}/remind` |
| GET | `/api/employees/pending-review` |
| GET | `/api/employees/onboarding-in-progress` |
| GET | `/api/employees/historical-candidates` |
| GET | `/api/employees/person-history?email=` |
| GET | `/api/search?q=` |

Related offer pipeline (capability `invite`): `GET /api/offers/awaiting-response`, `GET /api/offers/negotiations/pending`.

## Important Files

- `backend/app/api/employees.py` (candidate section)
- `backend/app/api/dashboard.py` (`global_search`)
- `backend/app/services/reminder_service.py`

## Modification Guide

1. Add filters in service query builders with org scope.
2. Keep router query validation (ge/le on page sizes).
3. Update candidates page + authService params.
4. Reminder kinds must match `reminder_service` supported set.

## Do Not Break

- Missing `organization_id` filter = cross-tenant leak.
- Capability `candidates` on all pipeline reads.
- Do not put business filtering only in the frontend.

## Testing

- List with filters returns only own org.
- Capability off → 403.
- Remind creates notification/email path.
- Search min length enforced.
- `py_compile` employees + dashboard search + reminder_service.
