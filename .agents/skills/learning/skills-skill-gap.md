---
name: learning-skills-skill-gap
description: >-
  Employee skills CRUD, assess, and skill-gap analysis under /api/learning/skills and /skill-gap.
  Use when changing employee_skills or gap computation vs org framework.
---

# Learning — Skills & Skill Gap

## Purpose

Maintain employee skills and compute gaps against role/org framework targets.

## Location

- Routes in `backend/app/api/learning.py`
- Service methods in `learning_service.py` (`get_skill_gap`, skill upsert/assess)
- Collections: `employee_skills`, `learning_skill_assessments`, `learning_skill_gaps`
- Org inputs: `org_framework_skills` / roles via org framework + taxonomy
- Frontend: `learningService.js`, employee learning skills UI

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/learning/skills/categories` |
| GET | `/api/learning/skills` |
| POST | `/api/learning/skills/assess` |
| POST | `/api/learning/skills` |
| DELETE | `/api/learning/skills/{skill_id}` |
| GET | `/api/learning/skill-gap` |

## Data Flow

```
Upsert/assess skills → employee_skills
skill-gap → compare current skills vs target role/framework requirements
  → persist/return gap payload (learning_skill_gaps as used)
```

## Business Rules

- Categories endpoint uses `learning` capability (`RequireAny` + capability).
- Skill mutations are employee-self only.
- Gap targets come from real org/role data — do not invent required skills.
- Feeds career path / recommendations downstream.

## Permissions

- Categories: `RequireAny` + capability `learning`
- Skills CRUD/assess/gap: `RequireEmployee`

## Real APIs

See Entry Points. Related: `/api/learning/org-taxonomy` for taxonomy reads.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/services/org_taxonomy_service.py`
- `backend/app/schemas/learning.py`
- `frontend/services/learningService.js`

## Modification Guide

1. New proficiency scale: schema + UI + gap math together.
2. Keep gap grounded in org framework skill names/ids.
3. Assess endpoint should not bypass upsert validation.

## Do Not Break

- Employee ownership of skill rows
- Org-scoped gap targets
- Do not invent skill requirements in AI helpers

## Testing

- Upsert skill → gap changes when target role set
- Delete skill → gap updates
- `py_compile` + manual employee learning skills tab
