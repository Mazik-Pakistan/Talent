---
name: recruiter-overview-activity
description: >-
  TalentAI recruiter overview summary and activity feed APIs, pages, and
  capability gates (overview, reporting).
scope: dashboard
related_skills:
  - dashboard/SKILL
  - search/global-search-taxonomy
primary_files:
  - backend/app/api/dashboard.py
  - backend/app/services/dashboard_service.py
  - frontend/app/dashboard/recruiter/overview/page.js
  - frontend/app/dashboard/recruiter/activity/page.js
---

# Recruiter overview & activity

## Purpose

Change recruiter KPI overview and activity timelines without leaking other orgs or bypassing capabilities.

## Location

- Pages: `frontend/app/dashboard/recruiter/overview/page.js`, `activity/page.js`
- APIs: `GET /api/dashboard/summary`, `GET /api/dashboard/activity`
- Caps: `overview`, `reporting` (`recruiterPageCapabilities.js`)
- Agent: `get_dashboard_summary`, `get_activity` (read-only where listed)

## Entry Points

Recruiter nav Overview / Activity; agent status questions.

## Data Flow

```
RequireRecruiter + capability
  → DashboardService summary/activity
  → org/recruiter-scoped Mongo aggregations
```

## Business Rules

- Activity is reporting-oriented (audit-like events), overview is counts/pipeline snapshot — keep concerns separate.
- Global search is separate (`GET /api/search`) but lives in the same shell.

## Permissions

- Summary: capability `overview`
- Activity: capability `reporting`

## APIs (real)

| Method | Path | Cap |
|--------|------|-----|
| GET | `/api/dashboard/summary` | overview |
| GET | `/api/dashboard/activity` | reporting |

## Important Files

- `dashboard_service.py`
- `frontend/lib/recruiterPageCapabilities.js`
- Recruiter shell + nav

## Modification Guide

1. Add metrics in the service, then wire overview cards.
2. New activity event types → ensure writers exist and filters stay indexed.
3. Keep agent tool read-only registration in sync.

## Do Not Break

- Capability separation of overview vs reporting.
- Organization/recruiter scoping.
- Performance: avoid unbounded activity queries (respect limit/pagination patterns).

## Testing

- Cap off → 403 and nav hidden if applicable.
- Summary numbers match list pages roughly.
- Activity returns newest-first with stable shape for FE.
