---
name: talent
description: >-
  TalentAI talent management under /api/talent: skill matrix, journey, internal
  opportunities, competency, development plans, search, metrics. Use when changing
  talent_service or recruiter/employee talent dashboards. Capability: talent.
---

# Talent

## Purpose

Employee talent self-view (skills, journey, achievements) and recruiter talent ops (opportunities, competency, search, metrics, development plans).

## Location

- Router: `backend/app/api/talent.py` — prefix **`/api/talent`**
- Service: `backend/app/services/talent_service.py`
- Schema: `backend/app/schemas/talent.py`
- Frontend: `frontend/services/talentService.js`; `frontend/app/dashboard/employee/talent/page.js`; `frontend/app/dashboard/recruiter/talent/` (`TalentDashboard.js`, `InternalOpportunities.js`, etc.)

## Entry Points

| Actor | Key routes |
|-------|------------|
| Employee | `/skill-matrix`, `/career-progression`, `/journey`, `/achievements` |
| Shared (+ capability) | `/opportunities` GET, `/profile/{employee_id}` |
| Recruiter (+ `talent`) | opportunities write, applicants, competency, search, metrics, requirements-status, development-plan |

## Data Flow

```
employee_skills + career events + learning → skill matrix / journey / achievements
recruiters post internal_opportunities → applicants
competency evaluations + development plans → profile
search_talent → employees + optional resume_embedding cosine
metrics / requirements-status → org aggregates
```

## Business Rules

- Recruiter module capability **`talent`**.
- All employee lists/search org-scoped.
- Resume embeddings optional (`ENABLE_EMBEDDINGS`) — search must tolerate missing vectors.
- Note: `apply_to_opportunity` exists on service; REST apply route may be missing — verify `talent.py` before assuming apply API.

## Permissions

- `RequireEmployee` for self views
- `RequireRecruiterWithTalent` = `recruiter|super_admin` + capability `talent`
- Opportunities list / profile: `RequireAny` + `require_capabilities("talent")`

## Real APIs

Base **`/api/talent`** — see fine-grained skills for tables.

## Important Files

- `backend/app/api/talent.py`
- `backend/app/services/talent_service.py`
- `backend/app/schemas/talent.py`
- `frontend/services/talentService.js`

## Modification Guide

1. Thin router; logic in `TalentService`.
2. If adding apply/GET competency routes, wire service + RBAC + `talentService.js` together (frontend may already call missing paths).
3. Search changes must keep org isolation.

## Do Not Break

- Capability `talent`
- Tenant isolation
- Optional embedding degrade path
- Do not invent opportunity/apply contracts without backend route

## Testing

- `backend/tests/test_org_wide_recruiter_access.py`
- `backend/tests/test_authorization_audit.py`
- Manual employee + recruiter talent pages

## Related

- `skill-matrix-journey.md`, `internal-opportunities.md`, `competency-development-plans.md`, `talent-search-metrics.md`
