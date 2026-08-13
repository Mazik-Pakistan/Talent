---
name: talent-skill-matrix-journey
description: >-
  Employee talent skill matrix, career progression, journey timeline, achievements
  under GET /api/talent/skill-matrix|career-progression|journey|achievements.
---

# Talent — Skill Matrix & Journey

## Purpose

Employee-facing talent narrative: skills matrix, progression, timeline journey, achievements.

## Location

- `backend/app/api/talent.py` — four GET handlers
- `TalentService.skill_matrix`, `career_progression`, `journey_timeline`, `achievements`
- Reads: `employee_skills`, `employee_career_events`, `employee_career_assignments`, learning/docs as implemented
- Frontend: `frontend/app/dashboard/employee/talent/page.js`, `talentService.js`

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/talent/skill-matrix` | `RequireEmployee` |
| GET | `/api/talent/career-progression` | `RequireEmployee` |
| GET | `/api/talent/journey` | `RequireEmployee` (`types` query optional) |
| GET | `/api/talent/achievements` | `RequireEmployee` |

## Data Flow

```
Current employee id → aggregate skills/career/learning events
  → matrix / progression / filtered journey / achievements payloads
```

## Business Rules

- Self-only — no employee_id param on these routes.
- Journey `types` filters event kinds when provided.
- Data must reflect real DB state (skills, career assignments, verified certs as wired) — do not fabricate achievements in the API.

## Permissions

- `RequireEmployee`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/talent.py`
- `backend/app/services/talent_service.py`
- `frontend/services/talentService.js`
- `frontend/app/dashboard/employee/talent/page.js`

## Modification Guide

1. New journey event types: service filter + UI legend together.
2. Keep payloads stable for AI mascot/insights consumers if they read talent context.
3. Prefer reusing career framework assignment data over duplicating progression math.

## Do Not Break

- Employee self-scope
- Consistent skill level semantics with learning `employee_skills`
- Do not expose other employees’ matrices here

## Testing

- Login as employee → all four endpoints 200
- Journey with `types` filter
- `py_compile` talent api/service
