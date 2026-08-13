---
name: docker-compose-env
description: >-
  TalentAI compose services, ports, env var checklist, and Redis config-only
  note for local/prod stacks.
scope: deployment
related_skills:
  - deployment/SKILL
  - super-admin/portal-login
  - llm/openrouter-gemini
primary_files:
  - docker-compose.yml
  - docker-compose.prod.yml
  - backend/.env.example
  - .env.docker.example
---

# Docker Compose & env

## Purpose

Wire containers and environment variables correctly without inventing unused infrastructure.

## Location

Repo root compose files; `backend/.env`; `frontend/.env.local`; `.env.docker.example`.

## Entry Points

Developer laptop setup; staging/prod compose.

## Data Flow

```
.env → container environment
backend Settings (pydantic) validates at import
frontend NEXT_PUBLIC_* inlined at build for browser
```

## Business Rules

### Ports (dev compose typical)

| Service | Port |
|---------|------|
| Frontend | 3000 |
| Backend | 8000 |
| OmniRoute | 20128 |
| Mongo | 27017 |
| Redis | 6379 |

### Redis

**Redis is only required for config validation / compose today** — no in-app Redis client usage for caching sessions as of this skill. Keep `REDIS_URL` set (e.g. `redis://redis:6379/0`) so the app boots.

### Required-ish backend settings

`APP_NAME`, `DEBUG`, `SECRET_KEY`, `JWT_SECRET`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE`, `JWT_EXPIRE_MINUTES`, `MONGODB_URI`, `DATABASE_NAME`, `REDIS_URL`, `ALLOWED_ORIGINS`, SMTP_*, `FRONTEND_URL`, `BACKEND_URL`

### Optional / feature

Cloudinary, Supabase, Gemini/OpenRouter (`OPENROUTER_*`, `GEMINI_*`), `BANKING_ENCRYPTION_KEY`, OCR/RAG flags, IT emails/expiry.

### CORS

Hardcoded in `main.py`: `allow_origins=["*"]`, `allow_credentials=False` — intentional-for-now.

## Permissions

Protect `.env` files; use secrets in real deployments.

## APIs (real)

Health via backend docs; portal `/portal-root-x9f3` on frontend.

## Important Files

- `docker-compose.yml`, `docker-compose.prod.yml`
- `backend/app/core/config.py`
- `backend/app/main.py` CORS

## Modification Guide

1. Add env → example files + Settings model + compose `environment`.
2. Prod: ensure nginx routes `/api` to backend and static to frontend.
3. Generate JWT: `python -c "import secrets; print(secrets.token_urlsafe(64))"`

## Do Not Break

- JWT_SECRET strength validation
- Compose mongo/redis service names in URIs
- Seed super admin one-liner in docs

## Testing

```bash
docker compose up --build
docker compose exec backend python -m scripts.seed_super_admin
# open http://localhost:3000 and http://localhost:8000/docs
```
