---
name: common-failure-patterns
description: >-
  TalentAI symptom→cause table for boot failures, Mongo DNS, CORS, OCR, SMTP,
  LLM 402, unused Redis, and dual-role drift.
scope: debugging
related_skills:
  - debugging/SKILL
  - deployment/docker-compose-env
  - dual-role/switch-role-profile-sync
  - llm/openrouter-gemini
primary_files:
  - backend/app/core/config.py
  - backend/app/core/database.py
  - backend/app/main.py
  - backend/app/services/llm_service.py
---

# Common failure patterns

## Purpose

Map frequent symptoms to known causes before deep debugging.

## Location

See files in frontmatter; also `email_service.py`, dual-role scripts, compose files.

## Entry Points

On-call / local setup / post-deploy issues.

## Data Flow

N/A.

## Business Rules — symptom → cause

| Symptom | Likely cause |
|---------|----------------|
| App won’t boot / import error on settings | Weak/short `JWT_SECRET`; missing required settings including **`REDIS_URL`** (validated even if unused as client) |
| Mongo hang on Atlas `mongodb+srv` | SRV DNS — public resolver shim in `database.py` (8.8.8.8 / 1.1.1.1) |
| Browser CORS confusion | Middleware is `allow_origins=["*"]`, `allow_credentials=False` — intentional for now; `ALLOWED_ORIGINS` is separate |
| Boot crash importing OCR/embeddings | Hard top-level import — must stay lazy behind `ENABLE_OCR` / `ENABLE_EMBEDDINGS` |
| SMTP auth fail (Gmail) | Spaces in app password — stripped in validator; check TLS vs SSL flags |
| Agent “offline” / thin answers | No `OPENROUTER_API_KEY` / usable `GEMINI_API_KEY` → `_fallback_reply` |
| LLM 402 / empty JSON | Model affordability — prefer free OpenRouter models; OmniRoute/OpenRouter degrade path |
| Redis “not used” but required | No Redis client in app code currently — **config validation / compose only** |
| Dual-role name/photo drift | Missing `mirror_profile_fields`; run reconcile script |
| Private page redirect loop | Path missing from `proxy.js` `PUBLIC_PATHS` |
| Recruiter feature 403 | Capability off or org module clamp |
| Refresh works but API 401 | Sending refresh token as Bearer — must use access token |

## Permissions

N/A.

## APIs (real)

Use failing route + `/docs` to confirm deployment actually mounted routers.

## Important Files

- `config.py`, `database.py`, `main.py`, `llm_service.py`, `proxy.js`
- `scripts/reconcile_dual_role_profiles.py`, `verify_dual_role.py`

## Modification Guide

1. Fix the root cause; avoid disabling security validations.
2. Document new recurring issues in this table.
3. For CORS changes, require an explicit product decision.

## Do Not Break

- JWT strength checks
- DNS shim
- Lazy optional imports
- Confirm intentional CORS before altering

## Testing

After fix: reboot backend, hit the failing endpoint, and run the narrowest pytest/lint applicable.
