---
name: talent-competency-development-plans
description: >-
  Competency evaluation POST /api/talent/competency/{employee_id} and development
  plan PUT /api/talent/development-plan/{employee_id}, plus talent profile GET.
---

# Talent — Competency & Development Plans

## Purpose

Recruiters submit competency evaluations and edit development plans; view talent profiles.

## Location

- `backend/app/api/talent.py`
- `TalentService.submit_competency_evaluation`, `update_development_plan`, `get_talent_profile`
- Collections: `talent_competency_evaluations`, `talent_development_plans`
- Frontend: `TalentProfileView.js`, `talentService.js` (may call GET competency/plan paths not on router — verify)

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/talent/competency/{employee_id}` | `RequireRecruiterWithTalent` |
| PUT | `/api/talent/development-plan/{employee_id}` | `RequireRecruiterWithTalent` |
| GET | `/api/talent/profile/{employee_id}` | `RequireAny` + capability `talent` |

## Data Flow

```
CompetencyEvaluationRequest → store evaluation for employee (org check)
DevelopmentPlanUpdateRequest → upsert plan
Profile → aggregate skills, evaluations, plans, learning highlights
```

## Business Rules

- Target `employee_id` must belong to recruiter’s organization.
- Profile is read-only aggregation — do not invent competency scores.
- Frontend GETs for competency/plan may be absent on backend; add routes explicitly if needed.

## Permissions

- Write: `RequireRecruiterWithTalent`
- Profile: capability `talent`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/talent.py`
- `backend/app/services/talent_service.py`
- `backend/app/schemas/talent.py`
- `frontend/services/talentService.js`
- `frontend/app/dashboard/recruiter/talent/TalentProfileView.js`

## Modification Guide

1. New competency dimensions: schema + service + profile UI.
2. Development plan fields: keep PUT partial-update semantics consistent.
3. Align any new GET routes with existing service read helpers.

## Do Not Break

- Org-scoped employee access
- Capability `talent`
- Do not allow employees to rewrite others’ evaluations via these recruiter routes

## Testing

- Submit competency → visible on profile
- Update plan → persisted
- Cross-org employee_id fails
- `test_org_wide_recruiter_access.py`
