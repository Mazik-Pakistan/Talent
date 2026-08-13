---
name: career-framework
description: >-
  Career tracks, levels, employee assignments, promotion reports, CSV import/export
  under /api/career-framework. Recruiter needs talent or learning capability.
---

# Career Framework

## Purpose

Define career tracks/levels, assign employees, log discussions, report promotion readiness, and CSV import/export. Assignments can sync learning paths into `learning_assignments`.

## Location

- Router: `backend/app/api/career_framework.py` — prefix **`/api/career-framework`**
- Service: `backend/app/services/career_framework_service.py`
- Schema: `backend/app/schemas/career_framework.py`
- Frontend: `frontend/services/careerService.js`

## Entry Points

| Area | Paths |
|------|--------|
| Tracks | `/tracks`, `/tracks/{track_id}` |
| Levels | `/levels`, `/levels/{level_id}` |
| Assign | `/employees/{id}/assign`, `/employees/{id}`, discussion, `/bulk-assign`, `/assignments` |
| Self | `/my-career`, `/my-career/progress` |
| Reports | `/reports/promotion-readiness`, `/reports/career-progress` |
| CSV | `/export`, `/import`, `/template` |

## Data Flow

```
tracks + levels (org) → assign employee → employee_career_assignments
  → optional sync learning_assignments (assignment_source org_career_path)
employee my-career → progress
reports → promotion readiness / career progress aggregates
CSV import/export ↔ tracks/levels
```

## Business Rules

- Soft-delete tracks/levels; block delete when active assignments exist.
- All CRUD org_id scoped.
- Recruiter auth: `require_any_capability("talent", "learning")`.
- `GET /template` is unauthenticated PlainTextResponse — keep intentional or protect deliberately if changing.

## Permissions

- `RequireRecruiterWithTalentOrLearning`
- Employee self: `RequireEmployee`

## Real APIs

Base **`/api/career-framework`**. See fine-grained skills.

## Important Files

- `backend/app/api/career_framework.py`
- `backend/app/services/career_framework_service.py`
- `frontend/services/careerService.js`
- `backend/tests/test_career_framework.py`

## Modification Guide

1. Track/level field changes: schema + CSV columns + UI together.
2. Preserve `_sync_career_path_to_learning_assignments` side effect on assign.
3. Soft-delete guards stay intact.

## Do Not Break

- Soft-delete + assignment guards
- Org scoping
- Dual capability talent|learning
- Learning assignment sync contract

## Testing

- `backend/tests/test_career_framework.py`
- Manual assign → my-career + learning assignment
- `py_compile` career framework modules

## Related

- `tracks-levels-assignments.md`, `promotion-reports.md`
