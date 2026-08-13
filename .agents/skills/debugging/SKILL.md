---
name: debugging
description: >-
  TalentAI common failure patterns — JWT boot, Mongo SRV DNS, CORS, OCR lazy
  imports, SMTP, LLM 402, Redis config-only, dual-role drift.
scope: debugging
related_skills:
  - debugging/common-failure-patterns
  - deployment/docker-compose-env
  - llm/openrouter-gemini
primary_files:
  - backend/app/core/config.py
  - backend/app/core/database.py
  - backend/app/main.py
---

# Debugging (overview)

## Purpose

Diagnose recurring TalentAI failures quickly using known sharp edges from AGENTS.md and ops experience.

## Location

Symptoms usually involve `config.py`, `database.py`, `main.py` CORS, `llm_service.py`, SMTP settings, dual-role scripts.

## Entry Points

App won’t boot; hang on Mongo; 401/403 surprises; LLM/agent offline; email silent; dual-role profile mismatch.

## Data Flow

N/A — troubleshooting skill.

## Business Rules

Prefer reading logs + settings validation errors over speculative refactors. Do not “fix” intentional CORS while debugging an unrelated bug.

## Permissions

N/A.

## APIs (real)

Health is implicit via boot + `/docs`. Auth/LLM/email failures surface on their domain routes.

## Important Files

- `.env` / `.env.example` (never commit secrets)
- `docker-compose.yml`
- `scripts/verify_dual_role.py`

## Modification Guide

When you permanently fix a sharp edge, update `common-failure-patterns.md` and AGENTS.md known edges if needed.

## Do Not Break

- SRV DNS shim while “simplifying” network code
- Lazy OCR/embedding imports
- JWT secret strength checks

## Testing

Reproduce with minimal env change; confirm fix with the specific smoke path that failed.
