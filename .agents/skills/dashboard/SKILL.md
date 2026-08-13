---
name: dashboard
description: >-
  TalentAI role home dashboards — recruiter overview/activity and
  candidate/employee homes. Use when changing dashboard APIs or home pages.
scope: dashboard
related_skills:
  - dashboard/recruiter-overview-activity
  - dashboard/candidate-employee-homes
  - notifications-announcements/SKILL
primary_files:
  - backend/app/api/dashboard.py
  - backend/app/services/dashboard_service.py
  - frontend/app/dashboard/recruiter/overview/page.js
  - frontend/app/dashboard/candidate/page.js
  - frontend/app/dashboard/employee/page.js
---

# Dashboard (overview)

## Purpose

Role home and summary surfaces. Recruiter overview/activity are capability-gated; candidate/employee homes aggregate onboarding/profile/learning entry points.

## Location

| Role | Typical page | Data |
|------|--------------|------|
| Recruiter | `/dashboard/recruiter/overview`, `/activity` | `/api/dashboard/summary`, `/activity` |
| Candidate | `/dashboard/candidate` | `/api/dashboard/candidate` (+ offer/docs) |
| Employee | `/dashboard/employee` | `/api/employees/me`, announcements, docs |
| Shared | shells | `/api/notifications`, announcements |

Router: `backend/app/api/dashboard.py`. Service: `dashboard_service.py`.

## Entry Points

Role `ROLE_HOME` redirects after login; shell nav items.

## Data Flow

```
Home page → services/*.js → dashboard/employee APIs → Mongo aggregates (tenant-scoped)
```

## Business Rules

- Recruiter page→capability map in `frontend/lib/recruiterPageCapabilities.js` (overview→`overview`, activity→`reporting`).
- Summaries must filter by `organization_id` / recruiter scope.

## Permissions

Recruiter endpoints require matching capabilities. Candidate/employee require their roles.

## APIs (real)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/dashboard/summary` | cap `overview` |
| GET | `/api/dashboard/activity` | cap `reporting` |
| GET | `/api/dashboard/candidate` | candidate home |
| POST | `/api/dashboard/recruiter-mascot/brief` | optional LLM brief |
| GET | `/api/notifications` | all roles |
| GET | `/api/announcements` | role-filtered |

## Important Files

- `dashboard.py`, `dashboard_service.py`
- `recruiterPageCapabilities.js`
- Role home pages under `frontend/app/dashboard/*`

## Modification Guide

1. New widget → extend service summary DTO + FE page together.
2. Keep capability gates aligned with nav.
3. Do not put heavy LLM work on critical home path without lazy/cache.

## Do Not Break

- Tenant scoping on aggregates.
- Capability checks on recruiter dashboard routes.
- Home redirects in `ROLE_HOME` / `ROLE_REDIRECTS`.

## Testing

- Each role lands on correct home with data.
- Recruiter without `reporting` → activity denied.
- `py_compile` dashboard service/router.
