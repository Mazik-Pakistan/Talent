---
name: llm
description: >-
  TalentAI LLM layer — OpenRouter primary, Gemini fallback, call_llm_json,
  learning AI caches. Use when changing llm_service, model env vars, or AI callers.
scope: llm
related_skills:
  - llm/openrouter-gemini
  - llm/learning-ai-cache
  - ai-agent/agent-loop
primary_files:
  - backend/app/services/llm_service.py
  - backend/app/core/config.py
  - backend/app/services/learning_ai_service.py
  - backend/app/services/learning_cache_service.py
---

# LLM (overview)

## Purpose

Centralize LLM calls behind `llm_service` so agents, learning AI, mascot briefs, extraction, and taxonomy expand share one OpenRouter→Gemini path and JSON contract.

## Location

| Concern | Path |
|---------|------|
| LLM client | `backend/app/services/llm_service.py` |
| Config | `backend/app/core/config.py` / `.env` |
| Learning AI | `learning_ai_service.py` + `learning_cache_service.py` |
| Other callers | `agent_service.py`, `recruiter_mascot_service.py`, `document_extraction_service.py`, `search_taxonomy.py` |

## Entry Points

- `llm_configured()` — true if `OPENROUTER_API_KEY` **or** usable `GEMINI_API_KEY`.
- `call_llm_json(prompt, …)` — returns `dict | None`.

## Data Flow

```
Caller → call_llm_json
  → OpenRouter chat completions (JSON-only)
  → on failure → Gemini REST fallback
  → parse JSON object
```

## Business Rules

- Prefer OpenRouter; Gemini is fallback only.
- Strict JSON responses; temperature often low for agents (0.1).
- No keys → callers must degrade (agent `_fallback_reply`, learning cache/skip, etc.).
- 402/affordability: prefer free/openrouter models; do not hard-crash the API process.

## Permissions

Server-side only. Never expose API keys to the frontend.

## APIs (real)

No public “LLM” router — consumed internally. Related product APIs: `/api/agent/*`, learning endpoints, `POST /api/dashboard/recruiter-mascot/brief`.

## Important Files

- `llm_service.py` — `_call_openrouter_json`, `_call_gemini_json`
- Env: `OPENROUTER_*`, `GEMINI_*`, `FRONTEND_URL` (OpenRouter Referer)

## Modification Guide

1. New LLM feature → call `call_llm_json`, do not invent a second HTTP client.
2. Change models via env/settings, not hardcoded one-offs (unless feature-specific override already exists).
3. Preserve JSON-only parsing and None-on-failure semantics.

## Do Not Break

- Agent offline fallback when `llm_configured()` is false.
- Learning hash-cache fast path (do not force LLM on every dashboard load).
- Lazy/optional nature of OCR/embeddings remains separate from this client.

## Testing

- With only OpenRouter key / only Gemini key / neither — callers behave.
- Invalid model → graceful None + caller fallback.
- `py_compile llm_service.py` and primary callers.
