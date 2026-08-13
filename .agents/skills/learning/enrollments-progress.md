---
name: learning-enrollments-progress
description: >-
  Employee course start, progress, dashboard, bookmarks under /api/learning.
  Use when changing enrollments, my/courses, or progress updates.
---

# Learning — Enrollments & Progress

## Purpose

Employee enrollment lifecycle: start course, update progress, list my courses/dashboard, bookmarks.

## Location

- `backend/app/api/learning.py` — start/progress/my/bookmarks
- `backend/app/services/learning_service.py` — `start_course`, `update_progress`, dashboard helpers
- Collection: `learning_enrollments`, `learning_bookmarks`
- Frontend: employee learning page via `learningService.js`

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/learning/catalog/{uid}/start` | `RequireEmployee` |
| PUT | `/api/learning/catalog/{uid}/progress` | `RequireEmployee` + `EnrollmentProgressRequest` |
| GET | `/api/learning/my/dashboard` | `RequireEmployee` |
| GET | `/api/learning/my/courses` | `RequireEmployee` (`status` query) |
| GET/POST | `/api/learning/bookmarks` | `RequireEmployee` |
| DELETE | `/api/learning/bookmarks/{uid}` | `RequireEmployee` |

## Data Flow

```
start(uid) → validate course exists in catalog → upsert learning_enrollments
progress → update percent/status timestamps
dashboard/courses → aggregate enrollments + assignments
bookmarks → learning_bookmarks by uid
```

## Business Rules

- `uid` must refer to a real catalog course — do not invent.
- Progress payload validated by `EnrollmentProgressRequest`.
- Assignments from recruiters may create/drive enrollments (see assignments skill).
- Employee-only mutations (not recruiter pretending).

## Permissions

- `RequireEmployee` (and super_admin where dependency allows)

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/schemas/learning.py`
- `frontend/services/learningService.js`
- `frontend/app/dashboard/employee/learning/page.js`

## Modification Guide

1. New progress fields: schema + service + employee UI together.
2. Keep status filter alias `status` on `/my/courses`.
3. Bookmark uid must match catalog uid scheme.

## Do Not Break

- Enrollment org/user scoping
- Real catalog uid requirement on start
- Do not allow progress updates for other employees’ enrollments

## Testing

- Start → progress → appears in `/my/courses`
- Bookmark add/remove
- `py_compile` learning router/service
