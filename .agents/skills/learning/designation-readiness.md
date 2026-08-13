---
name: learning-designation-readiness
description: >-
  Designation requirements and readiness under /api/learning/designation* and
  recruiter employee designation-readiness. Use when changing readiness scoring.
---

# Learning — Designation Readiness

## Purpose

Show employees (and recruiters) how ready they are for a designation/role based on learning, skills, and certificates.

## Location

- `backend/app/api/learning.py` — designation routes
- Logic in `learning_service.py` / related path helpers
- Inputs: org framework roles/skills/certs, enrollments, `learning_certificates`, `employee_skills`
- Frontend: employee learning designation widgets; recruiter employee learning profile

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/learning/designation/requirements` | Employee |
| GET | `/api/learning/designation/readiness` | Employee |
| GET | `/api/learning/employees/{employee_id}/designation-readiness` | `RequireRecruiterWithLearning` |

## Data Flow

```
Resolve target designation/role requirements (org framework)
  → compare skills, courses, certificates
  → readiness payload (met / missing)
Recruiter view → same for employee_id with org scope
```

## Business Rules

- Requirements come from real org framework / designation config — do not invent courses or skills.
- Recruiter view must stay organization-scoped.
- Verified certificates and completed enrollments count as evidence where implemented.

## Permissions

- Self: `RequireEmployee`
- Other employee: recruiter + capability `learning`

## Real APIs

See Entry Points. Related profile: `GET /api/learning/employees/{employee_id}/profile`.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/services/organization_framework_service.py` (requirement sources)
- `frontend/services/learningService.js`

## Modification Guide

1. Changing readiness weights: keep employee + recruiter payloads consistent.
2. New requirement types: wire org framework fields + readiness calculator + UI.
3. Do not call catalog AI here to invent missing courses — link to real recommendations instead.

## Do Not Break

- Org isolation on recruiter employee endpoints
- No invented course UIDs in missing-course suggestions
- Capability `learning` for recruiter

## Testing

- Employee readiness vs requirements
- Recruiter same-org vs cross-org
- `test_org_wide_recruiter_access.py` patterns
