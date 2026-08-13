---
name: organization-framework-course-sync-learning
description: >-
  Bidirectional sync between org_framework courses and learning_courses via
  course_sync_service. Use when changing /api/org-framework/courses or learning managed links.
---

# Organization Framework — Course Sync with Learning

## Purpose

Keep `org_framework_courses` and `learning_courses` aligned so roadmaps and the learning catalog share real course UIDs/ids.

## Location

- Org routes: `GET/POST /api/org-framework/courses`, `PUT/DELETE /courses/{course_id}`
- `backend/app/services/course_sync_service.py` — `sync_to_learning`, `sync_delete_from_learning`, reverse `sync_to_framework` / `sync_delete_from_framework`
- `organization_framework_service.create_course` / `update_course` / `delete_course` / `list_courses`
- Learning side: `learning_courses` with `source_kind: "org_framework"`, `org_framework_course_id`
- Frontend: org framework courses UI + learning catalog showing managed/org courses

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/org-framework/courses` |
| POST | `/api/org-framework/courses` |
| PUT | `/api/org-framework/courses/{course_id}` |
| DELETE | `/api/org-framework/courses/{course_id}` |

Learning catalog browse also surfaces synced courses via `/api/learning/catalog` / managed lists.

## Data Flow

```
create/update org course → sync_to_learning → upsert learning_courses
delete org course → sync_delete_from_learning
list_courses → merge org_framework_courses + org learning_courses
reverse sync when managed learning course linked to framework
```

## Business Rules

- Synced learning rows carry `organization_id` and `org_framework_course_id`.
- Do not invent catalog UIDs — sync generates/uses real ids per existing scheme.
- Roadmap builder prefers org/managed courses; external Coursera/MS Learn excluded when `for_roadmap=true`.
- Delete must remove or detach learning counterpart to avoid orphans.

## Permissions

- Same as org framework course CRUD (read/write capability gates)

## Real APIs

Org: see Entry Points. Learning consumers: `/api/learning/catalog`, `/api/learning/managed/courses`.

## Important Files

- `backend/app/services/course_sync_service.py`
- `backend/app/services/organization_framework_service.py`
- `backend/app/api/organization_framework.py`
- `backend/app/api/learning.py`
- `frontend/services/orgFrameworkService.js`
- `frontend/services/learningService.js`

## Modification Guide

1. Change course fields in org service **and** sync mapper together.
2. Never write `learning_courses` directly from the org router — use `course_sync_service`.
3. Import apply for courses must trigger the same sync path.

## Do Not Break

- `source_kind` / `org_framework_course_id` linkage
- Org isolation
- Real UIDs for learning enrollments and AI recommendations
- Orphan prevention on delete

## Testing

- Create org course → appears in learning catalog/managed
- Update title → both sides updated
- Delete → removed from learning
- Import courses sheet → sync holds
