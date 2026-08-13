---
name: organization-framework-departments-roles-skills
description: >-
  Org framework departments, roles, skills, certifications CRUD under /api/org-framework.
  Use when changing org structure entities or cascading deletes.
---

# Organization Framework — Departments, Roles & Skills

## Purpose

CRUD for departments, roles, skills, and certifications that drive learning gaps and roadmaps.

## Location

- `backend/app/api/organization_framework.py`
- `organization_framework_service.py` — department/role/skill/cert helpers
- Collections: `org_framework_departments`, `org_framework_roles`, `org_framework_skills`, `org_framework_certifications`
- Frontend: `orgFrameworkService.js`, Org Framework tab

## Entry Points

| Method | Path |
|--------|------|
| GET/POST | `/api/org-framework/departments` |
| PUT/DELETE | `/api/org-framework/departments/{name}` |
| GET | `/api/org-framework/roles`, `/roles/{role_id}` |
| POST/PUT/DELETE | `/api/org-framework/roles`, `/roles/{role_id}` |
| GET/POST | `/api/org-framework/skills` |
| PUT/DELETE | `/api/org-framework/skills/{skill_id}` |
| GET/POST | `/api/org-framework/certifications` |
| PUT/DELETE | `/api/org-framework/certifications/{cert_id}` |
| GET | `/api/org-framework/summary`, `/options` |
| POST | `/api/org-framework/seed` |

Optional query: `department` on roles; `role_name` on skills/certs.

## Data Flow

```
seed or create department → roles under department
skills/certs linked to roles
delete role/department → cascade dependents per service rules
summary/options → UI selectors for learning/talent
```

## Business Rules

- Unique keys per `(organization_id, …)`.
- Role graph cycle detection on updates.
- Cascading deletes remove dependent skills/certs/roadmaps/rules as implemented.
- Writes require recruiter + `org_config|learning`; reads also allow `talent`.

## Permissions

- Read: `RequireRecruiterLearning` / framework read caps
- Write: `RequireRecruiterLearningWrite`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/organization_framework.py`
- `backend/app/services/organization_framework_service.py`
- `backend/app/core/database.py` (indexes)
- `frontend/services/orgFrameworkService.js`

## Modification Guide

1. Rename department carefully — update dependents or use service rename path.
2. New role fields: service + UI + import sheet columns.
3. Keep `_org_id` required — reject users without organization.

## Do Not Break

- `organization_id` on every query
- Cascade integrity
- Cycle checks
- Seed must not mutate employees/candidates

## Testing

- Seed → list departments/roles/skills
- Delete role → dependents gone
- Cross-org id access fails
- Capability write vs read
