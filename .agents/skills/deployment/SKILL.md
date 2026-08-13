---
name: deployment
description: >-
  TalentAI Docker Compose deployment — mongo, redis (config-only), omniroute,
  backend, frontend, prod nginx, env files. Use when changing containers or env.
scope: deployment
related_skills:
  - deployment/docker-compose-env
  - debugging/common-failure-patterns
  - llm/openrouter-gemini
primary_files:
  - docker-compose.yml
  - docker-compose.prod.yml
  - .env.docker.example
  - backend/.env.example
---

# Deployment (overview)

## Purpose

Run TalentAI locally or in compose with correct env wiring. Redis is present for **settings validation / future use**, not an application cache client today.

## Location

| File | Role |
|------|------|
| `docker-compose.yml` | mongo:7, redis:7-alpine, omniroute, backend, frontend |
| `docker-compose.prod.yml` | nginx gateway `:80`; hides backend/frontend host ports |
| `.env.docker.example` | Compose-oriented env |
| `backend/.env.example` | Backend settings template |
| `frontend/.env.example` | `NEXT_PUBLIC_API_BASE_URL` |
| Dockerfiles | `backend/Dockerfile`, `frontend/Dockerfile` |
| `nginx/` | Prod gateway config |

## Entry Points

`docker compose up`, local uvicorn + `npm run dev`, seed super admin script.

## Data Flow

```
Browser :3000 (dev) or :80 (prod nginx)
  → frontend → backend :8000
  → mongo :27017
  → redis :6379 (config-only today)
  → omniroute :20128 (optional OpenRouter proxy)
```

## Business Rules

- Compose overrides often set `MONGODB_URI`, `REDIS_URL`, `OPENROUTER_BASE_URL`.
- CORS `allow_origins=["*"]` may remain intentional at current stage.
- Never commit real `.env` secrets.

## Permissions

Ops access to secrets; seed creates first super admin.

## APIs (real)

Same `/api/*` surface; prod may expose only via nginx.

## Important Files

- compose files, env examples, `scripts/seed_super_admin.py`

## Modification Guide

1. New required setting → `config.py` + both env examples + compose.
2. Document Redis purpose if you start actually using it.
3. Keep OmniRoute optional — app must work with direct OpenRouter/Gemini.

## Do Not Break

- Redis URL still required by settings even if unused as client.
- Seed command path for first SA.
- Frontend public API base URL in each environment.

## Testing

- `docker compose up --build` smoke: login + one authenticated API.
- `docker compose exec backend python -m scripts.seed_super_admin`
