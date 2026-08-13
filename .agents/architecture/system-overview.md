# System overview

TalentAI is a multi-tenant hiring → onboarding → employee platform: **FastAPI + Motor/MongoDB** backend, **Next.js 16 / React 19** frontend, and an in-app **AI agent** that calls the same permission-checked service layer as the REST API.

```
related_skills: authentication/, authorization/, multi-tenancy/, offers/, learning/
```

## Layers

```
Browser
  └─ Next.js App Router (frontend/app/)
       └─ proxy.js (cookie gate: access_token)
            └─ frontend/services/*.js + lib/apiClient.js (axios + Bearer)
                 └─ FastAPI routers (backend/app/api/*.py)
                      └─ Depends(require_roles / require_permissions / require_capabilities)
                           └─ Services (backend/app/services/*.py)
                                ├─ MongoDB (Motor) — app/core/database.py
                                ├─ Cloudinary — storage_service.py
                                ├─ SMTP — email_service.py
                                └─ OpenRouter / OmniRoute / Gemini — llm_service.py
```

| Layer | Path | Rule |
|-------|------|------|
| Routers | `backend/app/api/` | Parse request, auth dep, call one service, return. No business `if`s. |
| Services | `backend/app/services/` | All business logic, tenant filters, side effects. |
| Schemas | `backend/app/schemas/` | Pydantic contracts; **no shared codegen** with frontend. |
| Core | `backend/app/core/` | `config`, `database`, `security`, `rbac`, `crypto`. |
| Frontend pages | `frontend/app/dashboard/{role}/` | Role UI; call `services/*.js` only. |
| Shared UI | `frontend/components/shared/` | Shell chrome, toasts patterns, cross-role widgets. |

## Request lifecycle

1. Browser hits a Next route. `frontend/proxy.js` redirects to `/login` if no `access_token` cookie and path is not public.
2. Client code stores JWTs in **localStorage** and mirrors `access_token` into a cookie for the proxy.
3. `lib/apiClient.js` attaches `Authorization: Bearer <access_token>`; on 401 it posts `/api/auth/refresh`.
4. FastAPI `get_current_user` rejects non-`access` tokens, resolves profile + role, loads org modules ∩ recruiter capabilities.
5. Router dependency (`RequireRecruiter`, local capability deps, etc.) may deny → audited where wired.
6. Service runs Mongo queries scoped by `organization_id` / `recruiter_people_scope` as appropriate.
7. Response shape must match what the corresponding `services/*.js` caller expects.

## Roles

| Role | Home (`ROLE_HOME`) | Notes |
|------|-------------------|--------|
| `super_admin` | `/dashboard/super-admin` | Platform owner; login UI at `/portal-root-x9f3` only. |
| `recruiter` | `/dashboard/recruiter` | Org-bound; module **capabilities** gate features. |
| `candidate` | `/dashboard/candidate` | Pre-hire: onboarding, docs, offers. |
| `employee` | `/dashboard/employee` | Post-hire: learning, talent, messages, AI. |

Source of truth: `backend/app/core/rbac.py` (`ROLE_PERMISSIONS`). Mongo `roles`/`permissions` are a seeded mirror via `rbac_seed.py`.

## Module map (product domains)

| Domain | Backend | Frontend (typical) |
|--------|---------|-------------------|
| Auth / session | `api/auth.py`, `auth_service.py` | `/login`, `/register`, verify/reset |
| Invitations | `api/invitations.py` | `/dashboard/recruiter/invite`, `/invite/[token]` |
| Offers | `api/offers.py`, `offer_service.py` | `/offer`, recruiter invite/candidates |
| Onboarding | `api/onboarding.py`, `employees.py` | `/onboarding`, candidate/employee profile |
| Documents / OCR | `api/documents.py`, `document_*`, `ocr_service.py` | `/documents`, DocumentManager |
| Employees | `api/employees.py` | `/dashboard/recruiter/employees` |
| IT provisioning | `api/it_provisioning.py` | `/it-setup/[token]`, recruiter IT pages |
| IT service requests | `api/it_service_requests.py` | `/it-support/[token]` |
| Learning | `api/learning.py`, large `learning_*.py` | recruiter/employee learning pages |
| Org framework | `api/organization_framework.py` | `/dashboard/recruiter/organization-config` |
| Career framework | `api/career_framework.py` | employee career, talent readiness |
| Talent | `api/talent.py` | recruiter/employee talent pages |
| Messages | `api/messages.py` | recruiter/employee messages |
| Dashboard / notifs | `api/dashboard.py` | overview, announcements, search |
| Agent | `api/agent.py`, `agent_service.py` | `*/ai-assistant` pages |
| Tickets | `api/tickets.py`, `admin_tickets.py` | recruiter support; super-admin tickets |
| Super admin | `api/super_admin.py` | orgs, recruiter caps |
| Universities | `api/universities.py` | onboarding education autocomplete |

## Sharp edges (do not “fix” casually)

- **CORS** in `main.py` is `allow_origins=["*"]`, `allow_credentials=False` — intentional for current stage.
- **`JWT_SECRET`** validated at import; weak/short secrets crash boot (`config.py`).
- **No mock Mongo** — live `MONGODB_URI` required for app start.
- **`mongodb+srv://`** DNS shim in `database.py` (8.8.8.8 / 1.1.1.1).
- **OCR / embeddings** lazy-import behind `ENABLE_OCR` / `ENABLE_EMBEDDINGS`.
- **Banking fields** Fernet-encrypted (`crypto.py`); never log plaintext.
- **Two different `RequireCandidate` meanings** — see `api.md`.
- **Agent tools** must call services, not raw DB; split across `agent_tools*.py` is intentional.
- Large service files (`learning_service.py`, `agent_tools_parity.py`, …) are normal — do not split unless asked.

## Startup (backend lifespan)

`backend/app/main.py` → `lifespan`: indexes → employee-id migration → RBAC seed → org taxonomy → universities → learning providers → default org → Coursera cache/refresh → yield → stop Coursera + close Mongo.

## Agent checklist

1. Read the domain’s router + service before editing.
2. Preserve authz + `organization_id` filters.
3. Mirror schema changes in `frontend/services/*.js`.
4. Validate with `py_compile` / lint / build as appropriate.
