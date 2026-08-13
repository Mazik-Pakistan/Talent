---
name: candidate-employee-homes
description: >-
  TalentAI candidate and employee home dashboards — data sources, announcements,
  and profile completion entry points.
scope: dashboard
related_skills:
  - dashboard/SKILL
  - notifications-announcements/announcements
  - dual-role/SKILL
primary_files:
  - frontend/app/dashboard/candidate/page.js
  - frontend/app/dashboard/employee/page.js
  - backend/app/api/dashboard.py
  - backend/app/api/employees.py
---

# Candidate & employee homes

## Purpose

Role homes that orient users to onboarding (candidate) or work/learning (employee) without becoming a second admin console.

## Location

| Role | Page | Primary APIs |
|------|------|--------------|
| Candidate | `/dashboard/candidate` | `GET /api/dashboard/candidate`; offer/docs via authService helpers |
| Employee | `/dashboard/employee` | `GET /api/employees/me`, profile-completion, announcements, docs |

Shells: `CandidateShell`, `EmployeeShell`.

## Entry Points

Post-login `ROLE_HOME` redirect; shell logo/home links.

## Data Flow

```
Home page load → parallel service calls → cards/CTAs (offer, docs, learning, messages)
Notifications hook runs in shell independently
```

## Business Rules

- Candidate home emphasizes offer → onboarding → documents.
- Employee home emphasizes profile completion, Day-1, learning/talent entry.
- Dual-role users may switch to recruiter via `RoleSwitchButton` (not on candidate).

## Permissions

Role-scoped endpoints; no recruiter capabilities on these homes.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/dashboard/candidate` |
| GET | `/api/employees/me` |
| GET | `/api/announcements` |
| GET | `/api/notifications` |

(Plus related offer/document endpoints used by home widgets.)

## Important Files

- Candidate/employee `page.js`
- `dashboard_service.py` candidate dashboard builder
- `employee_service.py` for `/me`

## Modification Guide

1. Add home widgets by reusing existing services — avoid new aggregate APIs unless needed.
2. Keep loading/empty states consistent with shell patterns.
3. Deep links should match notification `link` fields.

## Do Not Break

- Home route constants used by auth redirects.
- Candidate blocked mutations until signed offer (elsewhere) — home should not imply otherwise.
- Employee shell notification polling.

## Testing

- Fresh candidate with offer vs without.
- Employee with incomplete profile sees completion CTA.
- Announcement visible when audience matches.
