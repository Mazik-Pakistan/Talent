---
name: organization-framework-import-export-versions
description: >-
  Org framework workbook export, import validate/apply, and versions under
  /api/org-framework/export|import/*|versions. Import apply is destructive.
---

# Organization Framework — Import, Export & Versions

## Purpose

Version snapshots and Excel workbook export/import for the full org framework.

## Location

- `backend/app/api/organization_framework.py` — export, import validate/apply, versions
- Import/export logic in `organization_framework_service.py`
- Frontend: `orgFrameworkService.js`, `orgFrameworkTemplate.js`
- Collections: `org_framework_versions` + all framework entity collections on apply

## Entry Points

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/org-framework/versions` | list |
| POST | `/api/org-framework/versions` | create snapshot metadata |
| GET | `/api/org-framework/export` | xlsx workbook |
| POST | `/api/org-framework/import/validate` | upload file — non-destructive |
| POST | `/api/org-framework/import/apply` | **destructive** replace from validated payload |

## Data Flow

```
export → workbook of departments/roles/skills/certs/courses/roadmaps/rules
validate upload → errors/warnings + resolved catalog refs
apply → clear org framework data + reimport (org scoped)
versions → record version notes / history entries
```

## Business Rules

- Always validate before apply; apply uses validated request body, not raw re-upload necessarily (follow router contract).
- Apply is destructive for the tenant’s framework collections.
- Resolve roadmap catalog refs during validate (`resolve_roadmap_catalog_refs`).
- Never apply across organizations.

## Permissions

- Export/validate/list versions: read caps
- Apply/create version: write caps (`RequireRecruiterLearningWrite`)

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/organization_framework.py`
- `backend/app/services/organization_framework_service.py`
- `frontend/services/orgFrameworkService.js`
- `frontend/app/dashboard/recruiter/learning/orgFrameworkTemplate.js` (or equivalent)

## Modification Guide

1. New sheet/column: export writer + validate + apply + template download.
2. Add confirmation UX copy when changing apply destructiveness (frontend).
3. Version create should not itself wipe data.

## Do Not Break

- Validate-before-apply
- Tenant isolation on apply wipe
- Catalog ref resolution
- Do not run apply on validate endpoint

## Testing

- Export → validate → apply round-trip
- Invalid file fails validate; apply not called
- Versions list after create
- Confirm learning sync still consistent after course sheet import
