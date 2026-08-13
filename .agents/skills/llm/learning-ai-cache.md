---
name: learning-ai-cache
description: >-
  TalentAI learning AI hash caches — skill assessments, gaps, role matches,
  recommendations; invalidate on profile change. Use when changing learning AI.
scope: llm
related_skills:
  - llm/SKILL
  - llm/openrouter-gemini
  - learning/SKILL
primary_files:
  - backend/app/services/learning_cache_service.py
  - backend/app/services/learning_ai_service.py
  - backend/app/services/learning_service.py
  - frontend/services/learningService.js
---

# Learning AI cache

## Purpose

Avoid re-calling the LLM on every learning dashboard load. Cache by content hashes; refresh only when inputs change or caller passes `refresh`.

## Location

- Cache: `backend/app/services/learning_cache_service.py`
- LLM prompts: `backend/app/services/learning_ai_service.py`
- Orchestration: `backend/app/services/learning_service.py`
- Frontend: `frontend/services/learningService.js` (`refresh` / `lazy` flags)

## Entry Points

Learning endpoints that assess skills, skill gap, career path, role matches, recommendations, employee learning profile; plus `invalidateLearningCaches()`.

## Data Flow

```
Inputs: resume / skills / verified certs
  → resumeHash, skillsHash, certificationsHash
  → lookup learning_* cache collections
  → hit: return stored AI result
  → miss/refresh: learning_ai_service.* via call_llm_json → store
invalidate_user_ai_caches(user_id) clears AI-derived docs
```

## Business Rules

- Collections include: `learning_skill_assessments`, `learning_skill_gaps`, `learning_role_matches`, `learning_ai_recommendations`, `learning_recruiter_profile_cache`; also clears `ai_path` / `skill_matrix` on `learning_career_goals`.
- LLM helpers: `rank_recommended_courses`, `analyze_skill_gap`, `build_skill_matrix`, `extract_skills_from_certificate`, `predict_promotion_readiness`.
- Must use **real catalog UIDs/URLs** — never invent courses.
- Fast path must not block dashboard when LLM is slow/unavailable (follow existing lazy/refresh patterns).

## Permissions

Employee self + recruiter learning capabilities as on learning routers (unchanged by cache layer).

## APIs (real)

Learning routes under `/api/learning/*` (see learning skill). Client flags: `assessSkills(…, refresh, lazy)`, `getSkillGap`, `getCareerPath`, `getRoleMatches`, `getRecommendations`, `getEmployeeLearningProfile`, `invalidateLearningCaches`.

## Important Files

- `learning_cache_service.py` — hash + get/store/invalidate
- `learning_ai_service.py` — JSON LLM prompts
- `learning_service.py` — wiring

## Modification Guide

1. New AI artifact → new collection or field + hash inputs + invalidate path.
2. Always invalidate on profile/skills/cert mutations that feed hashes.
3. Keep `call_llm_json` as the only LLM entry.

## Do Not Break

- Hash invalidation on relevant profile changes.
- Catalog UID fidelity in recommendations.
- Lazy/fast path when `refresh` is false.

## Testing

- Same inputs twice → second call serves cache (no LLM needed).
- Change skills → cache miss / new result.
- `invalidate_user_ai_caches` clears docs for user.
