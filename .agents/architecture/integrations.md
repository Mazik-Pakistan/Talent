# Integrations

External systems wired through `backend/app/core/config.py` settings and dedicated services. Prefer existing clients; do not add parallel SDKs for the same concern.

```
related_skills: learning/, authentication/, database/
```

## SMTP (email)

Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS` / `MAIL_USE_SSL`, `EMAIL_LOGO_URL`.

- Service: `email_service.py` (+ `email_template_service.py`, org templates collection `org_email_templates`).
- Password validator strips spaces (Gmail app-password paste quirk).
- Used for: OTP, invites, offers, IT links, notifications, password reset.

Link builders on `settings`: `invitation_link`, `it_provisioning_link`, `it_provisioning_batch_link`, `it_service_request_link` (use `FRONTEND_URL`).

## Cloudinary (primary file storage)

Settings: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` (default `talent`).

- Service: `storage_service.py` — uploads, signed URLs (`SIGNED_URL_EXPIRE_SECONDS`), document/photo assets.
- Used by documents, offers signatures, profile photos, ticket attachments, certificates.

## OpenRouter / OmniRoute / Gemini (LLM)

| Setting | Role |
|---------|------|
| `OPENROUTER_API_KEY` | Bearer for primary OpenAI-compatible endpoint |
| `OPENROUTER_BASE_URL` | Default OpenRouter URL; Docker points at OmniRoute |
| `OPENROUTER_MODEL` | e.g. `openrouter/free` |
| `OPENROUTER_MAX_TOKENS` | Default 4096; 402 handling may lower |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_BASE_URL` | Fallback provider |

Client: `llm_service.py`. Agent, learning AI, mascot brief, extraction assists.

Docker Compose runs **OmniRoute** (`omniroute:20128`) and sets:

`OPENROUTER_BASE_URL=http://omniroute:20128/v1/chat/completions`

## Coursera

- Service: `coursera_service.py` — live catalog from `https://api.coursera.org/api/courses.v1`.
- In-process + Mongo-persisted cache (`learning_catalog_cache` / coursera snapshot id).
- Lifespan: load persisted cache when not `DEBUG`; `start_background_refresh` / stop on shutdown.
- No dedicated Coursera API key in `config.py` — public catalog API pattern.

## Microsoft Learn

- Service: `ms_learn_service.py` — `https://learn.microsoft.com/api/catalog/`.
- In-process cache TTL ~6 hours; employee “open on MS Learn” redirects to learn.microsoft.com.
- Mirrors Coursera service shape for catalog search.

Learning provider framework (Phase 1): `learning_providers`, import engine, generic API providers (`generic_api_provider_service.py` with encrypted secrets).

## Redis (config only)

- `REDIS_URL` is **required** by Settings validation.
- `docker-compose.yml` comment: backend has **no Redis client usage today** — service kept so env resolves in containers.
- Do not assume caching/queues on Redis unless you add a client and document it.

## Supabase (optional)

Settings: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET`.

- Client created in `database.py` only when URL+key set.
- Legacy/alternate storage path; Cloudinary is the primary upload path.
- Sparse unique indexes still reference `supabase_user_id` on people collections.

## OCR / embeddings flags

| Flag | Default | Service |
|------|---------|---------|
| `ENABLE_OCR` | True | `ocr_service` / `document_extraction_service` |
| `ENABLE_EMBEDDINGS` | False | `embedding_service` (`EMBEDDING_MODEL`) |
| `ENABLE_AI_COACH` | True | Legacy coach settings still present |

Lazy-import heavy libs — keep boot safe when packages missing.

## Banking encryption

`BANKING_ENCRYPTION_KEY` (Fernet) or derive from `SECRET_KEY` — see `crypto.py` / `database.md`.

## Docker services (`docker-compose.yml`)

| Service | Port | Purpose |
|---------|------|---------|
| `mongo` | 27017 | MongoDB 7 |
| `redis` | 6379 | Satisfies `REDIS_URL` |
| `omniroute` | 20128 | Local LLM gateway |
| `backend` | 8000 | FastAPI |
| `frontend` | 3000 | Next.js |

Prod overlay: `docker-compose.prod.yml`. Seed: `docker compose exec backend python -m scripts.seed_super_admin`.

## Agent checklist

1. New secret → Settings field + `.env.example` (never commit real `.env`).
2. Reuse `llm_service` / `storage_service` / `email_service` instead of new clients.
3. Treat Redis as unused until a real client lands.
4. Point Docker LLM traffic at OmniRoute via `OPENROUTER_BASE_URL`, not a second abstraction.
