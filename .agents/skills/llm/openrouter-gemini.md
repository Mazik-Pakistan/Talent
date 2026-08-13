---
name: openrouter-gemini
description: >-
  TalentAI OpenRouter and Gemini configuration, call_llm_json behavior, env
  vars, and failure modes including 402 affordability retries.
scope: llm
related_skills:
  - llm/SKILL
  - deployment/docker-compose-env
primary_files:
  - backend/app/services/llm_service.py
  - backend/app/core/config.py
---

# OpenRouter & Gemini

## Purpose

Configure and debug the dual-provider JSON LLM client without breaking agent or learning callers.

## Location

- `backend/app/services/llm_service.py`
- Settings in `backend/app/core/config.py`
- Compose may point OpenRouter at OmniRoute (`OPENROUTER_BASE_URL`)

## Entry Points

`call_llm_json(prompt, temperature=…, timeout=…)` / `llm_configured()`.

## Data Flow

```
_call_openrouter_json
  → POST OPENROUTER_BASE_URL (OpenAI-compatible)
  → headers: Authorization, HTTP-Referer=FRONTEND_URL
  → JSON mode / instruct to return JSON only
  → 402 afford-retry path as implemented
on failure → _call_gemini_json (Generative Language API)
```

## Business Rules

| Env | Notes |
|-----|--------|
| `OPENROUTER_API_KEY` | Primary |
| `OPENROUTER_BASE_URL` | Default OpenRouter chat completions URL; compose may use OmniRoute |
| `OPENROUTER_MODEL` | Config default often `openrouter/free` / example `auto` |
| `OPENROUTER_MAX_TOKENS` | Default `4096` |
| `GEMINI_API_KEY` | Fallback; treated usable if looks like `AIza…` / `AQ.…` |
| `GEMINI_BASE_URL` | Google Generative Language |
| `GEMINI_MODEL` | Default `gemini-2.0-flash` |
| `FRONTEND_URL` | OpenRouter `HTTP-Referer` |

## Permissions

Keys stay server-side in `.env` / compose secrets.

## APIs (real)

External: OpenRouter + Gemini HTTP APIs only (not TalentAI routes).

## Important Files

- `llm_service.py`
- `docker-compose.yml` OmniRoute service + env overrides
- `.env.example` / `.env.docker.example`

## Modification Guide

1. Adjust timeouts/tokens carefully — agent loop uses `timeout=120`.
2. When adding headers/body fields, keep JSON-object parsing tolerant of fenced markdown if already handled.
3. Document model changes in deployment skill / env examples.

## Do Not Break

- Primary→fallback order (OpenRouter then Gemini).
- `llm_configured()` semantics used by agent fallback.
- Do not log full prompts containing PII/secrets in production paths.

## Testing

- Force OpenRouter failure → Gemini path used.
- Empty keys → `llm_configured()` false.
- 402 / bad model → returns None without crashing uvicorn.
