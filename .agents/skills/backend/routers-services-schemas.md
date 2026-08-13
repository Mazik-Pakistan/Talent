---
name: routers-services-schemas
description: >-
  TalentAI recipe for adding endpoints — thin routers, service logic, Pydantic
  schemas, and frontend contract mirroring.
scope: backend
related_skills:
  - backend/SKILL
  - frontend/services-api-client
  - authorization/SKILL
primary_files:
  - backend/app/api/
  - backend/app/services/
  - backend/app/schemas/
  - backend/app/core/security.py
---

# Routers, services & schemas

## Purpose

Add or change HTTP APIs without putting business logic in routers or drifting FE contracts.

## Location

Domain files under `api/`, `services/`, `schemas/`. Auth aliases in `core/security.py`.

## Entry Points

New feature work usually starts from an existing domain router (prefer extend over new file).

## Data Flow

```
Request body/query → Pydantic schema
  → Require* dependency
  → service_function(user, payload)
  → response schema / dict matching FE expectations
```

## Business Rules

- One service call per handler when possible.
- Tenant list/search queries must filter `organization_id` (or documented scope helper).
- Watch same-named local deps (e.g. historical `RequireCandidate` differences).

## Permissions

Import shared `RequireUser`, `RequireRecruiter`, `RequireEmployee`, `RequireAny`, `RequireOnboardingSelf`, `RequireSuperAdmin`. Add `require_capabilities("…")` for recruiter modules.

## APIs (real)

Follow existing prefix for the domain. Register new routers in `main.py`.

## Important Files

- Example thin router pattern: `messages.py`, `agent.py`, `tickets.py`
- `rbac.py` for permission codes

## Modification Guide

1. Schema in `schemas/` if request/response is non-trivial.
2. Logic in `services/`.
3. Router: parse → auth → call → return.
4. Update `frontend/services/*.js` + consumers same change set.
5. If agent should do it too → add tool calling the same service.

## Do Not Break

- Thin router rule.
- FE contract parity.
- Capability + role checks on recruiter features.

## Testing

- OpenAPI shows method/path.
- Call as allowed and forbidden roles.
- `py_compile` router+service+schema.
