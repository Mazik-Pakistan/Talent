---
name: pytest-frontend-validation
description: >-
  TalentAI concrete validation checklist — pytest modules, py_compile, npm lint
  and build, OpenAPI spot checks.
scope: testing
related_skills:
  - testing/SKILL
  - debugging/common-failure-patterns
primary_files:
  - backend/tests/
  - frontend/package.json
---

# Pytest & frontend validation

## Purpose

Concrete commands and expectations when validating a change.

## Location

- Backend: run from `backend/` — `pytest` (no pytest.ini required historically)
- Frontend: `frontend/` — `npm run lint`, `npm run build`

## Entry Points

Pre-merge / end-of-task validation.

## Data Flow

N/A.

## Business Rules

**Backend checklist**

- [ ] `python -m py_compile` on touched files
- [ ] App boots if startup/routers/`main.py` touched
- [ ] `pytest` relevant tests; note baselines
- [ ] `/openapi.json` paths/methods if routers changed
- [ ] Permission review vs `rbac.py` — no accidental widen

**Frontend checklist**

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Grep renames across `app/`, `components/`, `hooks/`, `lib/`, `services/`

**Cross**

- [ ] Schema change mirrored in `services/*.js` + consumers

## Permissions

N/A.

## APIs (real)

OpenAPI at backend `/openapi.json` or `/docs`.

## Important Files

Representative tests: jwt token type, banking crypto, `test_search_taxonomy.py`, tenant isolation, authorization audit, agent ticket, org-wide recruiter, profile/email, provider support.

## Modification Guide

1. Add tests beside peers in `backend/tests/`.
2. Prefer small focused tests over full E2E for unit concerns.
3. Document manual steps only when automation cannot cover (SMTP, Cloudinary).

## Do Not Break

- CI expectations if GitHub Actions present — keep commands compatible.
- Do not skip hooks with `--no-verify` when committing (user rules).

## Testing

```bash
cd backend && python -m py_compile app/services/agent_service.py
cd backend && pytest tests/test_search_taxonomy.py -q
cd frontend && npm run lint && npm run build
```
