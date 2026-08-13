# Backend architecture

FastAPI app entry: `backend/app/main.py`. Business logic lives in services; routers stay thin; `app/core` is the shared spine.

```
related_skills: authentication/, authorization/, database/, multi-tenancy/
```

## `main.py` & lifespan

```python
# Order matters — see main.py lifespan
await create_database_indexes()
await migrate_employee_ids_to_emp_format()
await seed_rbac_collections()
await seed_org_taxonomy()
await seed_universities()
await seed_learning_providers()
await create_default_organization_if_needed()
# non-DEBUG: coursera_service.load_persisted_cache()
coursera_service.start_background_refresh()
# yield
# shutdown: stop Coursera refresh, mongo_client.close()
```

Routers registered in `main.py` (no prefix on app itself — each router sets its own):

`auth`, `invitations`, `it_provisioning`, `it_service_requests`, `onboarding`, `universities`, `rbac`, `super_admin`, `dashboard`, `employees`, `offers`, `documents`, `learning`, `talent`, `email_templates`, `messages`, `career_framework`, `org_framework`, `agent`, `tickets`, `admin_tickets`.

CORS middleware: `allow_origins=["*"]`, `allow_credentials=False`. Do not tighten casually.

## Router thinness

Routers (`backend/app/api/*.py`) should only:

1. Declare `APIRouter(prefix=..., tags=...)`.
2. Attach `Depends(require_roles(...))` / `require_permissions` / `require_capabilities` (or shared aliases from `security.py`).
3. Parse path/query/body via Pydantic schemas.
4. Call **one** service function and return its result.

If you write branching business rules in a router, move them to a service. Local `Annotated[...]` aliases for role+capability combos are OK (e.g. `RequireRecruiterWithInvite` in `offers.py`).

## Services

Path: `backend/app/services/`. Large files are expected (`learning_service.py`, `employee_service.py`, `agent_tools.py`, `agent_tools_parity.py`).

Patterns:

- Import `database` from `app.core.database`.
- Scope recruiter lists with `recruiter_scope` / `recruiter_people_scope` from `organization_service.py`.
- Raise/`HTTPException` consistently with existing endpoints in that domain.
- Side effects (email, Cloudinary, LLM) go through dedicated helpers (`email_service`, `storage_service`, `llm_service`).

Agent tools **must** call these services — never bypass RBAC with direct collection reads from a new shortcut.

## Schemas

Path: `backend/app/schemas/`. Examples: `auth.py`, `offer.py`, `document.py`, `learning.py`, `talent.py`, `agent.py`, `ticket.py`, `it_provisioning.py`, `career_framework.py`, …

- Request/response contracts the frontend trusts.
- Change schema + service + `frontend/services/*.js` in the same pass.
- Shared date helpers: `schemas/date_utils.py`.

## Core spine

| Module | Responsibility |
|--------|----------------|
| `app/core/config.py` | Pydantic Settings from `.env`; JWT strength validation; SMTP/Cloudinary/LLM/OCR flags; link builders (`invitation_link`, `it_provisioning_link`, …). |
| `app/core/database.py` | Motor client, optional Supabase client, `_ensure_index`, `create_database_indexes`, transactions helpers. |
| `app/core/security.py` | Password hash, JWT create/decode, `get_current_user`, `require_*`, shared `Require*` aliases, deny audit helper. |
| `app/core/rbac.py` | `PERMISSIONS`, `ROLE_PERMISSIONS`, `ROLE_HOME`, `CurrentUser` dataclass. |
| `app/core/rbac_seed.py` | Seed Mongo mirror of roles/permissions at startup. |
| `app/core/crypto.py` | Fernet encrypt/decrypt; banking payload helpers. |

## Auth dependencies (import these)

From `security.py`:

- `RequireUser` — any authenticated user
- `RequireRecruiter` — `recruiter` \| `super_admin`
- `RequireEmployee` — `employee` \| `super_admin`
- `RequireAny` — `employee` \| `recruiter` \| `super_admin`
- `RequireOnboardingSelf` — permission `onboarding.self`

Do **not** redeclare the same check under a conflicting local name without reading both sites. See `api.md` for the `RequireCandidate` gotcha.

## Validation tips

```bash
cd backend
python -m py_compile app/main.py app/api/<touched>.py app/services/<touched>.py
# If startup/lifespan touched: uvicorn app.main:app --reload --port 8000
# Confirm routes: GET /openapi.json or /docs
```

## Agent checklist

1. Prefer extending an existing domain router over a new file.
2. New router file → `include_router` in `main.py`.
3. New collection → indexes in `create_database_indexes()`.
4. Never widen `require_*` without an explicit product requirement.
