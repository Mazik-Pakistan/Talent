---
name: learning
description: >-
  TalentAI learning module under /api/learning: catalog (Coursera/MS Learn/managed),
  enrollments, certificates, skills/gaps, career path AI (must not invent course UIDs),
  designation readiness, assignments, analytics. Use when changing learning_service or learning UI.
---

# Learning

## Purpose

Employee learning catalog, progress, certificates, skill gaps, AI recommendations, recruiter assignments/analytics, and managed/org course administration.

## Location

- Router: `backend/app/api/learning.py` — prefix **`/api/learning`**
- Core services: `learning_service.py`, `learning_ai_service.py`, `learning_path_service.py`, `catalog_service.py`, `managed_learning_service.py`, `provider_service.py`, `import_engine_service.py`, `course_sync_service.py`, `org_taxonomy_service.py`
- Providers: Coursera / Microsoft Learn / managed `learning_providers`
- Frontend: `frontend/services/learningService.js`; `frontend/app/dashboard/employee/learning/page.js`; `frontend/app/dashboard/recruiter/learning/page.js`

## Entry Points

| Area | Paths |
|------|--------|
| Catalog | `/catalog`, `/catalog/facets`, `/catalog/sources`, `/catalog/{uid}`, start/progress |
| Me | `/my/dashboard`, `/my/courses`, bookmarks |
| Certs | `/certificates*` |
| Skills/gap | `/skills*`, `/skill-gap` |
| Path/AI | `/career-goal`, `/career-path`, `/role-matches`, `/recommendations` |
| Designation | `/designation/*`, `/employees/{id}/designation-readiness` |
| Recruiter | `/assignments*`, `/analytics`, `/managed/*`, `/providers*`, `/import/*` |

## Data Flow

```
Catalog sources (MS Learn / Coursera / managed) → browse/start/progress → learning_enrollments
Certificates upload → pending → recruiter verify
Skills + org framework → skill-gap / designation readiness
AI recommendations ← live catalog UIDs only (never invent)
Recruiter assign → learning_assignments → employee enrollments
Org framework courses ↔ course_sync_service ↔ learning_courses
```

## Business Rules

- **Learning AI must never invent course UIDs/titles/URLs** — only rank/filter real catalog candidates (`learning_ai_service`; drops unknown UIDs).
- Catalog reads need capability `learning`; employee mutations use `RequireEmployee`.
- Recruiter admin: `RequireRecruiterWithLearning` = `recruiter|super_admin` + capability `learning`.
- Certificate upload requires `source_url` http/https; optional file ≤10MB pdf/png/jpg.
- Org-scoped managed courses; `for_roadmap=true` excludes API sync Coursera/MS Learn from roadmap builder.

## Permissions

- `RequireAny` + `require_capabilities("learning")` for catalog reads
- `RequireEmployee` for enrollments, certs, skills, career path
- `RequireRecruiterWithLearning` for verify, assign, analytics, managed import

## Real APIs

Base: **`/api/learning`**. See fine-grained skills for full route tables. OpenAPI: `/openapi.json` tag `Learning`.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/services/learning_ai_service.py`
- `backend/app/schemas/learning.py`
- `frontend/services/learningService.js`

## Modification Guide

1. Extend `learning.py` thinly; put logic in services.
2. New read-only agent tools → also add to `READONLY_TOOLS` if exposing via product agent.
3. Any AI ranking change must keep `valid_uids` filter.
4. Mirror schema changes in `learningService.js` + dashboard tabs.

## Do Not Break

- Never invent course UIDs in AI output.
- Capability `learning` gates.
- Tenant `organization_id` on managed/org learning collections.
- Lazy optional deps elsewhere do not apply here, but do not hard-require OCR for learning.

## Testing

- `backend/tests/test_provider_support.py`
- `backend/tests/test_org_wide_recruiter_access.py` (assign/list org scope)
- `backend/tests/test_authorization_audit.py` (`RequireRecruiterWithLearning`)
- `backend/scripts/test_learning_ai.py`
- `py_compile` touched learning modules

## Related fine-grained skills

Listed in this folder: catalog, enrollments, certificates, skills-gap, career-path, designation, assignments-analytics, managed-catalog.
