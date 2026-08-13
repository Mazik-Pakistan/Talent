---
name: career-framework-tracks-levels-assignments
description: >-
  Career tracks/levels CRUD and employee career assignments under /api/career-framework.
  Use when changing assign, bulk-assign, or track/level models.
---

# Career Framework — Tracks, Levels & Assignments

## Purpose

Maintain track/level hierarchy and assign employees (including bulk and discussion log).

## Location

- `backend/app/api/career_framework.py`
- `career_framework_service.py` — track/level CRUD, `assign_career`, `bulk_assign`, `log_career_discussion`, `ensure_org_career_assignment`
- Collections: `career_tracks`, `career_levels`, `employee_career_assignments`
- Frontend: `careerService.js`

## Entry Points

| Method | Path |
|--------|------|
| POST/GET | `/api/career-framework/tracks` |
| GET/PUT/DELETE | `/api/career-framework/tracks/{track_id}` |
| POST/GET | `/api/career-framework/levels` |
| GET/PUT/DELETE | `/api/career-framework/levels/{level_id}` |
| POST | `/api/career-framework/employees/{employee_id}/assign` |
| GET/PUT | `/api/career-framework/employees/{employee_id}` |
| POST | `/api/career-framework/employees/{employee_id}/discussion` |
| POST | `/api/career-framework/bulk-assign` |
| GET | `/api/career-framework/assignments` |
| GET | `/api/career-framework/my-career` |
| GET | `/api/career-framework/my-career/progress` |

## Data Flow

```
Create track → create levels under track
assign/bulk-assign → employee_career_assignments
  → sync courses to learning_assignments when path configured
discussion → append notes on assignment
employee my-career → read own assignment + progress
```

## Business Rules

- Soft-delete; cannot delete track/level with active assignments.
- Org_id on every query.
- Assign syncs learning path courses (`assignment_source: "org_career_path"`).
- Employee endpoints only return self.

## Permissions

- Recruiter routes: `RequireRecruiterWithTalentOrLearning`
- my-career*: `RequireEmployee`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/career_framework.py`
- `backend/app/services/career_framework_service.py`
- `backend/app/schemas/career_framework.py`
- `frontend/services/careerService.js`

## Modification Guide

1. Level requirements fields must align with CSV import columns and promotion readiness inputs.
2. Bulk-assign: validate all employee ids in-org before partial writes (follow existing transactionality).
3. Keep learning sync in service, not router.

## Do Not Break

- Soft-delete guards
- Org isolation
- Learning assignment sync
- Dual capability check

## Testing

- `backend/tests/test_career_framework.py`
- Create track/level → assign → my-career
- Delete with active assignment blocked
