---
name: talent-internal-opportunities
description: >-
  Internal opportunities CRUD and applicants under /api/talent/opportunities*.
  Use when changing internal mobility postings. Capability talent.
---

# Talent — Internal Opportunities

## Purpose

Recruiters post/edit internal roles; employees browse; recruiters view applicants.

## Location

- `backend/app/api/talent.py`
- `TalentService.list_opportunities`, `create_opportunity`, `update_opportunity`, `list_opportunity_applicants`, `apply_to_opportunity`
- Collections: `internal_opportunities`, `internal_opportunity_applications`
- Frontend: `InternalOpportunities.js`, `talentService.js` (`applyToOpportunity` may call a path not yet on router — verify)

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/talent/opportunities` | `RequireAny` + capability `talent` |
| POST | `/api/talent/opportunities` | `RequireRecruiterWithTalent` |
| PUT | `/api/talent/opportunities/{opportunity_id}` | Recruiter |
| GET | `/api/talent/opportunities/{opportunity_id}/applicants` | Recruiter |

Service also has `apply_to_opportunity` — confirm whether a REST route exists before documenting new clients.

## Data Flow

```
Recruiter create → internal_opportunities (organization_id)
Browse filtered list → employees/recruiters with talent capability
Apply (when wired) → internal_opportunity_applications
Applicants list → recruiter review
```

## Business Rules

- Org-scoped postings and applicants.
- Updates must not leak cross-tenant opportunity ids.
- Capability `talent` required even for browse.

## Permissions

- List: any role with `talent` capability check
- Write/applicants: recruiter/super_admin + `talent`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/talent.py`
- `backend/app/services/talent_service.py`
- `backend/app/schemas/talent.py` (`InternalOpportunityCreateRequest`, `UpdateRequest`)
- `frontend/app/dashboard/recruiter/talent/InternalOpportunities.js`
- `frontend/services/talentService.js`

## Modification Guide

1. If adding apply route: router + `RequireEmployee` + service + frontend in one change.
2. Status fields (open/closed): schema + list filters + UI.
3. Keep applicants endpoint org-authorized via opportunity ownership.

## Do Not Break

- `talent` capability
- Org isolation
- Do not expose applicant PII cross-org
- Do not assume apply REST exists without checking `talent.py`

## Testing

- Create opportunity → list → applicants empty
- Cross-org id should 404/403
- Capability missing → 403
