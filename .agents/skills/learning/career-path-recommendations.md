---
name: learning-career-path-recommendations
description: >-
  Career goal, career path, role matches, and AI course recommendations under /api/learning.
  Critical: learning AI must never invent course UIDs — only rank real catalog candidates.
---

# Learning — Career Path & Recommendations

## Purpose

Employee career goal, path, role matches, and recommended courses grounded in the **live catalog**.

## Location

- `backend/app/api/learning.py` — career-goal, career-path, role-matches, recommendations
- `backend/app/services/learning_service.py`, `learning_path_service.py`
- **`backend/app/services/learning_ai_service.py`** — `rank_recommended_courses`; filters to `valid_uids`
- Collections: `learning_career_goals`, `learning_ai_recommendations`, `learning_role_matches`
- Frontend: employee learning career/recommendations UI via `learningService.js`

## Entry Points

| Method | Path |
|--------|------|
| GET/POST | `/api/learning/career-goal` |
| GET | `/api/learning/career-path` (`refresh` query) |
| GET | `/api/learning/role-matches` (`refresh`) |
| GET | `/api/learning/recommendations` (`refresh`) |

## Data Flow

```
career goal → path/role-match computation (org framework + skills)
recommendations → build real catalog candidate list
  → learning_ai_service ranks ONLY those UIDs
  → drop any model output not in valid_uids
  → return courses with real titles/URLs from catalog
```

## Business Rules

- **MUST NOT invent course UIDs, titles, or URLs.** Prompt and post-filter enforce this (`valid_uids`).
- Recommendations/career path grounded via `catalog_service` live data.
- `refresh=true` bypasses cache where implemented.
- Enrollment from path may use assignment-stored URL if course missing from live catalog — still no invented UIDs in AI output.

## Permissions

- `RequireEmployee`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/services/learning_ai_service.py` (design principle at file top)
- `backend/app/services/learning_service.py`
- `backend/app/services/learning_path_service.py`
- `backend/app/services/catalog_service.py`
- `backend/app/api/learning.py`
- `backend/scripts/test_learning_ai.py`

## Modification Guide

1. Any prompt change must keep “choose ONLY from this list” + `valid_uids` filter.
2. Do not return LLM-hallucinated courses even if the model emits them.
3. Cache keys must include org/user/goal inputs when adding refresh behavior.

## Do Not Break

- **Never invent course UIDs**
- Post-filter unknown UIDs
- Employee-only access
- Catalog grounding via `catalog_service`

## Testing

- `backend/scripts/test_learning_ai.py`
- Manual: recommendations only contain UIDs present in `/catalog`
- Force bad model output in unit/script if available — must be dropped
