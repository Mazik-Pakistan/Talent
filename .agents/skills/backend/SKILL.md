---
name: backend
description: >-
  TalentAI FastAPI backend layering — thin routers, services, schemas, main.py
  CORS and lifespan seeds. Use when adding endpoints or touching app startup.
scope: backend
related_skills:
  - backend/routers-services-schemas
  - backend/lifespan-seeds
  - database/SKILL
  - security/SKILL
primary_files:
  - backend/app/main.py
  - backend/app/api/
  - backend/app/services/
  - backend/app/schemas/
  - backend/app/core/
---

# Backend (overview)

## Purpose

Enforce layering: routers parse/auth/call; services own logic; schemas define contracts; core holds config/DB/security/rbac/crypto.

## Location

| Layer | Path |
|-------|------|
| Entry | `backend/app/main.py` |
| Routers | `backend/app/api/*.py` |
| Services | `backend/app/services/*.py` |
| Schemas | `backend/app/schemas/*.py` |
| Core | `backend/app/core/{config,database,security,rbac,crypto}.py` |

## Entry Points

`uvicorn app.main:app` — lifespan seeds then serves routes under `/api/*`.

## Data Flow

```
HTTP → router Depends(Require*) → service → Mongo/Cloudinary/SMTP/LLM → Pydantic response
```

## Business Rules

- No business outcome `if` in routers.
- Large service files are intentional — do not split casually.
- CORS currently `allow_origins=["*"]`, `allow_credentials=False` — **intentional for now**; do not “fix” in unrelated PRs.
- `ALLOWED_ORIGINS` setting may exist for redirects/links — distinct from CORS middleware.

## Permissions

Shared `Require*` from `security.py`; compose role+capability locally with clear names when needed.

## APIs (real)

Prefixes include: `/api/auth`, `/api/super-admin`, `/api/employees`, `/api/documents`, `/api/learning`, `/api/talent`, `/api/offers`, `/api/onboarding`, `/api/org-framework`, `/api/career-framework`, `/api/agent`, `/api/tickets`, `/api/admin/tickets`, `/api/messages`, `/api/it-provisioning`, `/api/it-service-requests`, `/api/invitations`, `/api/rbac`, `/api/universities`, `/api/email-templates`, dashboard/notifications/announcements/search routes.

## Important Files

- `main.py` — router includes, CORS, lifespan
- `config.py` — `JWT_SECRET` validation at import

## Modification Guide

1. Extend domain router → schema → service → correct auth.
2. New router file → `include_router` in `main.py`.
3. Mirror FE `services/*.js` on contract changes.

## Do Not Break

- CORS intentional wide-open setting (flag, don’t silently change).
- Typed JWT access checks.
- Lifespan seed order (indexes before dependent seeds).

## Testing

- `python -m py_compile` touched modules
- Boot app; `/openapi.json` lists routes
- `pytest` in `backend/`
