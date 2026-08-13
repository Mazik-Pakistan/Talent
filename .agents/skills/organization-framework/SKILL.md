---
name: organization-framework
description: >-
  Organization framework under /api/org-framework: departments, roles, skills,
  roadmaps, promotion rules, versions, import/export, course sync to learning.
  Capabilities org_config|learning|talent (read); writes need recruiter + org_config|learning.
---

# Organization Framework

## Purpose

Tenant org structure and career/learning requirements: departments, roles, skills, certifications, courses, roadmaps, promotion rules, versioning, workbook import/export. Courses sync into learning catalog.

## Location

- Router: `backend/app/api/organization_framework.py` — prefix **`/api/org-framework`**
- Service: `backend/app/services/organization_framework_service.py`
- Sync: `backend/app/services/course_sync_service.py`
- Frontend: `frontend/services/orgFrameworkService.js`; recruiter `OrgFrameworkTab.js`, `orgFrameworkTemplate.js`

## Entry Points

| Area | Paths |
|------|--------|
| Meta | `/summary`, `/options`, `POST /seed` |
| Structure | `/departments`, `/roles`, `/skills`, `/certifications`, `/courses` |
| Paths | `/roadmaps`, `/roadmaps/reorder`, `/promotion-rules` |
| Versions/IO | `/versions`, `/export`, `/import/validate`, `/import/apply` |

## Data Flow

```
seed/CRUD org_framework_* collections (organization_id)
courses CRUD → course_sync_service → learning_courses (source_kind org_framework)
roadmaps reference skills/certs/courses
import validate → apply (destructive replace)
versions snapshot metadata
```

## Business Rules

- Every query filtered by `organization_id` (`_org_id(user)`).
- Role cycle checks; cascading deletes of dependent skills/certs/roadmaps/rules.
- Import apply clears + reimports — destructive.
- Seed writes framework collections only (not people).
- Read capability any of `org_config|learning|talent`; write needs recruiter/super_admin + `org_config|learning`.

## Permissions

- `RequireFrameworkRead` / `RequireRecruiterLearning`
- `RequireRecruiterLearningWrite` via `_framework_write_user`

## Real APIs

Base **`/api/org-framework`**. See child skills.

## Important Files

- `backend/app/api/organization_framework.py`
- `backend/app/services/organization_framework_service.py`
- `backend/app/services/course_sync_service.py`
- `frontend/services/orgFrameworkService.js`

## Modification Guide

1. New entity: collection + indexes in `database.py` + service CRUD + router + frontend service.
2. Course changes must go through sync helpers.
3. Import sheet columns: validate + apply + template together.

## Do Not Break

- Tenant isolation
- Destructive import warnings/behavior
- Course ↔ learning sync ids (`org_framework_course_id`)
- Cascading delete integrity
- Capability gates

## Testing

- Capability patterns in `test_authorization_audit.py`
- Manual seed → CRUD → export → validate → apply
- Confirm learning catalog shows org_framework courses

## Related

- `departments-roles-skills.md`, `roadmaps-promotion-rules.md`, `import-export-versions.md`, `course-sync-learning.md`
