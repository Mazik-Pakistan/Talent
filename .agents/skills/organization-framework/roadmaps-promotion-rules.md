---
name: organization-framework-roadmaps-promotion-rules
description: >-
  Org framework roadmaps (including reorder) and promotion rules under /api/org-framework.
  Use when changing career roadmaps or promotion rule upserts.
---

# Organization Framework — Roadmaps & Promotion Rules

## Purpose

Define per-role learning roadmaps and promotion rules used by readiness and career UX.

## Location

- Routes in `organization_framework.py`
- Service roadmap/promotion helpers in `organization_framework_service.py`
- Collections: `org_framework_roadmaps`, `org_framework_promotion_rules`
- Frontend: Org Framework roadmaps UI via `orgFrameworkService.js`

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/org-framework/roadmaps` (`role_name` optional) |
| PUT | `/api/org-framework/roadmaps/reorder` |
| POST | `/api/org-framework/roadmaps` |
| PUT/DELETE | `/api/org-framework/roadmaps/{roadmap_id}` |
| GET | `/api/org-framework/promotion-rules` |
| POST | `/api/org-framework/promotion-rules` (upsert) |
| DELETE | `/api/org-framework/promotion-rules/{role_name}` |

## Data Flow

```
Create roadmap steps referencing skills/certs/courses
reorder → update sort order
promotion-rules upsert by role_name
Consumers: learning designation readiness, career progression UIs
```

## Business Rules

- Roadmap course refs should resolve to real org/learning courses (import validate uses `resolve_roadmap_catalog_refs`).
- Promotion rules keyed by role; delete by `role_name`.
- Org scoped; cascading delete when role removed.
- Learning catalog `for_roadmap` behavior excludes external API sync courses from roadmap builder.

## Permissions

- Read: framework read caps
- Write: `RequireRecruiterLearningWrite`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/organization_framework.py`
- `backend/app/services/organization_framework_service.py`
- `backend/app/services/course_sync_service.py` / catalog roadmap filters
- `frontend/services/orgFrameworkService.js`

## Modification Guide

1. New roadmap step types: validate refs on create/update and on import.
2. Reorder payload: keep atomic update pattern.
3. Promotion rule schema changes: update readiness consumers.

## Do Not Break

- Catalog ref integrity (no dangling invented course UIDs)
- Org isolation
- Upsert semantics for promotion rules
- Cascade on role delete

## Testing

- Create roadmap → reorder → list order
- Upsert promotion rule → delete
- Import validate catches bad catalog refs
