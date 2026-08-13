---
name: learning-managed-catalog-providers-import
description: >-
  Managed learning courses, providers, and import engine under /api/learning/managed*
  and provider/import routes. Use when changing managed catalog or bulk import.
---

# Learning — Managed Catalog, Providers & Import

## Purpose

Org-managed courses/providers CRUD, archive/restore, bulk actions, and CSV/import preview-commit for the learning catalog.

## Location

- `backend/app/api/learning.py` — `/managed/*`, `/providers*`, `/import/*` (as implemented)
- `managed_learning_service.py`, `provider_service.py`, `import_engine_service.py`, `learning_provider_seed.py`
- Collections: `learning_courses`, `learning_providers`, `learning_import_history`
- Frontend: recruiter learning managed/import UI, `courseImportTemplates.js`
- Org sync: `course_sync_service.py` links org-framework courses

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/learning/managed/courses` |
| POST | `/api/learning/managed/courses` |
| PUT | `/api/learning/managed/courses/{course_id}` |
| POST | `/api/learning/managed/courses/{course_id}/archive` |
| POST | `/api/learning/managed/courses/{course_id}/restore` |
| DELETE | `/api/learning/managed/courses/{course_id}` |
| POST | `/api/learning/managed/courses-bulk/action` |
| GET/POST | `/api/learning/managed/providers` |
| GET | `/api/learning/managed/facets` |
| POST | `/api/learning/managed/import/preview` |
| POST | `/api/learning/managed/import/commit` |

Also provider/import engine routes registered on the same router (`/providers*`, `/import/*`, sync) — confirm in `learning.py` before editing.

## Data Flow

```
Create/update managed course → learning_courses (organization_id)
Import preview → validate rows → commit → upsert courses + import history
Providers registry → catalog sources list
Org framework course CRUD → course_sync_service ↔ learning_courses (source_kind org_framework)
```

## Business Rules

- All managed data tenant-scoped by `organization_id`.
- Import commit only after preview validation.
- Archive vs delete: preserve restore path.
- `for_roadmap=true` catalog behavior excludes external API sync courses from roadmap builder.

## Permissions

- `RequireRecruiterWithLearning`

## Real APIs

See Entry Points; open `/openapi.json` for full provider/import engine paths.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/managed_learning_service.py`
- `backend/app/services/import_engine_service.py`
- `backend/app/services/provider_service.py`
- `backend/app/services/course_sync_service.py`
- `backend/app/schemas/learning.py`, `provider.py`, `import_engine.py`
- `frontend/services/learningService.js`

## Modification Guide

1. New import columns: preview validator + commit mapper + template download together.
2. Keep `source_kind` / provider ids stable for catalog filters.
3. When syncing with org framework, update `course_sync_service` not duplicate write logic in the router.

## Do Not Break

- Org isolation on every managed query
- Preview-before-commit
- Catalog UID stability for enrollments/AI
- Do not invent UIDs during import — generate deterministic real ids per existing scheme

## Testing

- `backend/tests/test_provider_support.py`
- Preview invalid CSV → errors; commit valid → courses listed
- Archive/restore round-trip
- Capability gate
