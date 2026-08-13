---
name: learning-assignments-analytics
description: >-
  Recruiter course assignments, reminders, employee learning profile, and analytics
  under /api/learning/assignments and /analytics. Use when changing assign or metrics.
---

# Learning — Assignments & Analytics

## Purpose

Recruiters assign courses, remind learners, view assignments, employee learning profiles, and org analytics.

## Location

- `backend/app/api/learning.py`
- `learning_service.py` — `assign_courses`, remind, `get_analytics`, profile
- Collections: `learning_assignments`, enrollments; cache `learning_recruiter_profile_cache`
- Career framework may sync assignments with `assignment_source: "org_career_path"`
- Frontend: recruiter learning assignments/analytics tabs

## Entry Points

| Method | Path |
|--------|------|
| POST | `/api/learning/assignments` |
| POST | `/api/learning/assignments/remind` |
| GET | `/api/learning/assignments` |
| GET | `/api/learning/employees/{employee_id}/profile` |
| GET | `/api/learning/analytics` |

## Data Flow

```
CourseAssignRequest (real uids + employee ids) → learning_assignments
  → employee sees in my courses / notifications/email remind
analytics(?department) → aggregates enrollments/completions org-scoped
```

## Business Rules

- Assignment course UIDs must be real catalog/managed ids.
- Org-wide recruiter access still filtered by `organization_id`.
- Remind payload targets existing assignments — no silent create of fake courses.
- Analytics optional `department` filter.

## Permissions

- All: `RequireRecruiterWithLearning` (`recruiter|super_admin` + `learning`)

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/schemas/learning.py` (`CourseAssignRequest`)
- `frontend/services/learningService.js`
- `frontend/app/dashboard/recruiter/learning/`

## Modification Guide

1. New assign fields: schema + service + recruiter UI + email templates if used.
2. Preserve sync from career framework (`_sync_career_path_to_learning_assignments`) when touching assignment shape.
3. Profile endpoint: keep parity with what Talent/Learning dashboards expect.

## Do Not Break

- Org scope on list/analytics/profile
- Real course UIDs only
- `learning` capability
- Do not weaken remind to spam unrelated orgs

## Testing

- `backend/tests/test_org_wide_recruiter_access.py`
- Assign → employee enrollment/assignment visible
- Analytics for department filter
- Capability 403 without `learning`
