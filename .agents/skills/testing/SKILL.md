---
name: testing
description: >-
  TalentAI validation — pytest backend suites and frontend lint/build. Use when
  verifying changes or adding tests.
scope: testing
related_skills:
  - testing/pytest-frontend-validation
  - debugging/common-failure-patterns
primary_files:
  - backend/tests/
  - frontend/package.json
---

# Testing (overview)

## Purpose

Validate changes with the repo’s real harnesses: backend `pytest`, frontend `lint`/`build`, plus targeted `py_compile` and scripts.

## Location

| Layer | How |
|-------|-----|
| Backend unit/integration | `backend/tests/` via `pytest` |
| Frontend | `npm run lint`, `npm run build` in `frontend/` |
| Quick syntax | `python -m py_compile <files>` |
| Scripts | `backend/scripts/test_api_endpoints.py`, `verify_dual_role.py`, … |

## Entry Points

After implementation, before calling a task done (per AGENTS.md).

## Data Flow

```
Change code → compile/lint → pytest subset → manual smoke of touched flow
```

## Business Rules

- Note pre-existing pytest failures before attributing to your change.
- No Jest suite required in `package.json` historically — don’t assume unit FE tests exist.
- Live Mongo required for full app boot; narrow changes may use static checks only.

## Permissions

Tests must not embed real production secrets; use fixtures/env samples.

## APIs (real)

Tests often import FastAPI app and call routes directly.

## Important Files

- `backend/tests/test_*.py` (jwt types, banking, search taxonomy, tenant isolation, authorization audit, career framework, agent ticket, …)
- `frontend/package.json` scripts

## Modification Guide

1. Behavior change in security/tenancy/taxonomy → add/adjust pytest.
2. FE contract change → at least lint/build + manual path.
3. Keep tests from needing real OpenRouter keys when possible (mock/`llm_configured` false).

## Do Not Break

- Tenant isolation tests’ assumptions.
- Token type tests (access vs refresh).

## Testing

Meta: run the commands listed in the child skill checklist.
