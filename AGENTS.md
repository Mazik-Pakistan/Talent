# AGENTS.md

> Field guide for AI coding agents working in **TalentAI** — a multi-tenant FastAPI + MongoDB backend, a Next.js 16 / React 19 frontend, and an in-app conversational agent that calls this same backend through a permission-checked tool layer.
>
> Two AI systems live in this repo: **you**, editing the code, and **the product's own agent** (`agent_service.py`), which you may be asked to extend. This document is for you. Read it fully before touching anything — this is a ~130k-line codebase with real auth, real tenants, and real money-adjacent flows (offers, banking data). Skimming costs more time than it saves.

---

## 0 · Prime directive

> **Understand, then act. Stay in scope. Never weaken auth, permissions, or tenant isolation. Validate before you call anything done.**

If you're unsure whether a change is in scope, it isn't — narrow it down or ask, don't guess big.

---

## 1 · Operating mode

Act as a fast, implementation-focused agent, not a narrator.

**Do**
- Inspect the relevant code silently before changing it.
- Follow existing project patterns and architecture — reuse existing services, hooks, utilities, and components rather than writing parallel versions.
- Make the smallest change that correctly and completely satisfies the task.
- Keep working until the task is actually done, not just analyzed.
- Check imports/references after any rename, move, or deletion.
- Validate — tests, lint, type checks, a build, whatever applies — after implementing, and fix what validation finds.

**Don't**
- Narrate internal reasoning or explain every file you read and every small decision.
- Provide long deliberation before acting, or repeatedly reconsider a straightforward decision.
- Change business logic, API contracts, auth/authz behavior, validations, or permissions **unless the task explicitly requires it.**
- Refactor unrelated code, rename things unnecessarily, reformat untouched files, add dependencies a task doesn't need, or rewrite working functionality just because another approach exists.
- Touch pages, components, or endpoints outside what was asked.

**Ask a clarifying question only when:**
- Multiple interpretations would produce materially different behavior, or
- A required piece of information is genuinely unavailable, or
- Proceeding would risk breaking important existing functionality.

Otherwise, infer the intended behavior from existing code and project patterns, and proceed.

---

## 2 · The 30-second mental model

```
Browser ──▶ Next.js (proxy.js gates auth) ──▶ frontend/services/*.js (axios)
                                                        │
                                                        ▼
                                          FastAPI routers (backend/app/api/*.py)
                                                        │
                                    Depends(require_roles / require_permissions)
                                                        │
                                                        ▼
                                        Service layer (backend/app/services/*.py)
                                                        │
                                    ┌───────────────────┼────────────────────┐
                                    ▼                   ▼                    ▼
                               MongoDB (Motor)   Cloudinary/Supabase   OpenRouter/Gemini
```

- **Routers** (`app/api/`) do three things only: parse the request, check the auth/permission dependency, call one service function, and return. No business logic here — if you find yourself writing an `if` that decides an outcome, it belongs in a service.
- **Services** (`app/services/`) hold all business logic. This is where the large majority of backend work happens.
- **Schemas** (`app/schemas/`) are Pydantic request/response contracts the frontend trusts implicitly — there is no shared type generation between frontend and backend, so a contract change on one side that isn't mirrored on the other fails silently at runtime, not at build time.
- **`app/core/`** is the spine: `config.py` (env/settings), `database.py` (Mongo/Supabase clients + index creation), `security.py` (JWT + shared FastAPI auth dependencies), `rbac.py` (roles/permissions — source of truth in code, not the DB).
- Frontend mirrors this: `app/dashboard/{role}/...` pages → `services/*.js` wrappers → backend. Role-specific UI lives under `components/{role}/`; cross-role shared UI under `components/shared/`.

---

## 3 · Environment setup

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in real values
uvicorn app.main:app --reload --port 8000

# Frontend (separate shell)
cd frontend
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

**Hard gotcha:** `app/core/config.py` validates `JWT_SECRET` at import time. Under 32 characters, or a known placeholder (`secret`, `changeme`, `test`, `password`, …), **raises and crashes the app on boot**. Generate a real one:
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

You need a live `MONGODB_URI` for the backend to start at all — there's no in-memory/mock DB mode. For a narrowly-scoped change, static validation (`python -m py_compile`, `next build`) is often sufficient; don't assume the full stack must be running for every edit.

---

## 4 · Auth, RBAC & multi-tenancy — know this cold

- **Four roles**: `super_admin`, `recruiter`, `candidate`, `employee`. Defined in `backend/app/core/rbac.py` — **code is the source of truth**; the `roles`/`permissions` Mongo collections are a seeded mirror for querying, never authoritative.
- **Shared permission dependencies** live in `app/core/security.py` as `Annotated[CurrentUser, Depends(require_roles(...))]` aliases (`RequireRecruiter`, `RequireEmployee`, `RequireAny`, etc.). Import these — never redeclare the same check locally in a new router.
- **Watch for same-name, different-rule dependencies.** This codebase has had two router-local dependencies both named `RequireCandidate` that checked *different* predicates (`require_permissions("onboarding.self")` in one router, `require_roles("candidate", "super_admin")` in another). Never assume two same-named checks are interchangeable — read the actual predicate before touching either.
- **Recruiter capabilities** are a second, finer-grained layer on top of role permissions (`CurrentUser.has_capability("...")`) — lets an org disable one module for one recruiter without touching their role. Check both when gating a recruiter-only feature.
- **Multi-tenancy**: most collections carry an `organization_id`. Any new query or aggregation that lists/searches records **must** scope by the current user's `organization_id` unless it's an explicit Super Admin cross-org view. Treat a missing tenant filter as seriously as a SQL-injection bug — it's the easiest way to leak one org's data into another's dashboard.
- **Super Admin login is at `/portal-root-x9f3`** — deliberately unlinked and unguessable. Never link to it from public UI, never rename it to something guessable without being explicitly asked.
- **JWT tokens are typed** (`access` vs `refresh`) — a refresh token must never be accepted where an access token is expected. If you touch token-verification code, keep this check intact.
- Session lives in a cookie (`access_token`) enforced client-side by `frontend/proxy.js`'s route matcher. Adding a new top-level **public** route means adding it to `PUBLIC_PATHS`/`PUBLIC_EXTENSIONS` there, or it will incorrectly force a login redirect.

---

## 5 · Extending the product's own AI agent

If your task touches `backend/app/services/agent_service.py` or the `agent_tools*.py` files, internalize the loop first:

1. Prompt = role system prompt + shared cross-role rules + tool catalog + fresh state snapshot + recent conversation history + the new user message.
2. The LLM must return **strict JSON**: one tool call, or a reply (`call_llm_json` in `llm_service.py`).
3. Tool calls execute against the **real, permission-checked service layer** — never a shortcut path or a direct DB read from inside a tool. If a tool needs data a service function doesn't expose yet, extend the service function properly.
4. The loop is bounded at `MAX_TOOL_STEPS = 4`. Read-only tools are tracked in `READONLY_TOOLS` specifically so the agent doesn't burn steps re-fetching the same state mid-turn — **any new read-only tool must be added to that set.**
5. No LLM key configured → a deterministic fallback still answers status questions. Preserve this path when editing; it's a real degrade-gracefully requirement, not dead code.

**Adding a new tool:**
1. Pick the right file: `agent_tools.py` (core), `agent_tools_parity.py` (dashboard-parity extras — a deliberate module split, not duplicate code, so don't "clean up" by merging them), or `agent_tools_super_admin.py` (platform-level).
2. Write the tool calling an existing (or newly-extended) service function, respecting the same RBAC the equivalent REST endpoint enforces.
3. Register it in the correct role list (`RECRUITER_TOOLS`, `CANDIDATE_TOOLS`, `EMPLOYEE_TOOLS`, `SUPER_ADMIN_TOOLS`, or the shared `SELF_SERVE_TOOLS`).
4. If it's read-only, add its name to `READONLY_TOOLS`.
5. Never let the agent surface a raw route/path string in a reply (`/offer`, `offer_page=`, "open page offer"). The shared agent rules explicitly forbid this — UI hints (buttons) carry navigation, agent prose stays natural language.

Frontend AI surfaces (`frontend/lib/ai/*`, `frontend/components/ai-experience/*`) are per-role context/insight builders feeding an orb-avatar chat widget. If a new tool should be reachable from a dashboard's floating assistant, check whether the corresponding `*Context.js` / `*Insights.js` file also needs an update.

---

## 6 · Recipes

<details open>
<summary><strong>Add a backend endpoint</strong></summary>
<br>

1. Find the right router in `app/api/`; extend an existing domain router rather than creating a new file unless the domain genuinely doesn't exist yet.
2. Add a Pydantic request/response schema in `app/schemas/` if one doesn't already fit.
3. Write the logic in `app/services/` — routers stay thin.
4. Gate it with the correct shared `Require*` dependency from `app/core/security.py`.
5. If it's a brand-new router file, register it in `app/main.py`.
6. Validate: `python -m py_compile` the touched files, boot the app, and confirm `/openapi.json` (or `/docs`) lists the route with the right method and auth.

</details>

<details open>
<summary><strong>Add a frontend page/route</strong></summary>
<br>

1. Create `app/<route>/page.js` (or nest under `app/dashboard/{role}/...`).
2. If it must be authenticated, confirm `proxy.js`'s matcher covers it (it does by default — only *public* routes need explicit listing).
3. Reuse the role's shell/nav (`components/{role}/*Shell.js`, `utils/{role}Nav.js`) instead of building new chrome.
4. Call the backend only through a `services/*.js` wrapper — never a raw `fetch`/`axios` call inline in a component.
5. Validate: `npm run lint` and `npm run build`.

</details>

<details open>
<summary><strong>Touch shared dashboard-shell logic</strong></summary>
<br>

Sidebar collapse, session sync, notifications, logout, and (recruiter) global search are centralized in `frontend/hooks/` — edit the hook once, not per-role-shell. Shared, byte-identical CSS lives in `components/shared/shell/*.module.css`, consumed via CSS Modules `composes:` — check there before duplicating a style rule across role stylesheets. If you find genuinely identical logic or CSS repeated across `RecruiterShell` / `EmployeeShell` / `CandidateShell`, that's a signal to extract it the same way, not to leave a third copy.

</details>

<details open>
<summary><strong>Add or modify a MongoDB collection</strong></summary>
<br>

1. Add index creation to `create_database_indexes()` in `app/core/database.py`, using the existing `_ensure_index()` helper (it already ignores benign Atlas race/conflict error codes — reuse it, don't write a raw `create_index` call).
2. Add the Pydantic schema.
3. If it's tenant-scoped data, make sure every read path filters by `organization_id`.

</details>

---

## 7 · Validation checklist

**Backend**
- [ ] `python -m py_compile <changed files>` (or import the app module directly) — no syntax/import errors.
- [ ] App boots cleanly (`uvicorn app.main:app`) if you touched startup/lifespan code, routers, or `main.py` imports.
- [ ] `pytest` in `backend/` — note any pre-existing failures *before* you start so you don't misattribute an unrelated, already-broken test to your change.
- [ ] If you touched routers: confirm `/openapi.json` still lists the expected paths/methods, with nothing missing or duplicated.
- [ ] Every new or changed permission check reviewed against `app/core/rbac.py` — did you accidentally widen access?

**Frontend**
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Grep for every usage of anything you renamed or moved, across `app/`, `components/`, `hooks/`, `lib/`, `services/`.

**Either side**
- [ ] Changed an API contract (request/response shape)? Confirm the corresponding `services/*.js` call and consuming component were updated in the same pass — mismatches here are silent until runtime, since there's no shared type generation between the two stacks.

---

## 8 · Known sharp edges

- **CORS is currently wide open** (`allow_origins=["*"]`, `allow_credentials=False` in `app/main.py`). Don't "fix" this incidentally while doing an unrelated task — flag it instead of silently changing it, since it may be intentional for the current deployment stage.
- **`mongodb+srv://` DNS**: `database.py` swaps in public DNS resolvers (8.8.8.8 / 1.1.1.1) automatically, because some networks can't resolve SRV records. If Mongo connections mysteriously hang locally, this is often why — don't remove the shim.
- **OCR/embedding libraries are optional at runtime.** `document_extraction_service.py` and `embedding_service.py` lazy-import them and degrade gracefully behind `ENABLE_OCR` / `ENABLE_EMBEDDINGS` flags. Don't turn a lazy import into a hard top-level import — that reintroduces a boot-time crash risk for environments where those libs aren't installed.
- **Banking and other sensitive fields are Fernet-encrypted** (`BANKING_ENCRYPTION_KEY`, derived from `SECRET_KEY` if unset). Never log, print, or return these fields in plaintext outside their designated decrypt path.
- **Large single-file services are normal here**, not a mistake waiting to be split. Files like `learning_service.py`, `agent_tools_parity.py`, `agent_tools.py`, and `employee_service.py` run tens of thousands of lines by design. Splitting them is a large, deliberate, out-of-scope refactor unless explicitly requested — don't do it as a side effect of an unrelated task.
- **`agent_tools.py` and `agent_tools_parity.py` look like duplication from the names alone.** They aren't — it's an intentional split (core vs. dashboard-parity extras). Don't merge them.

---

## 9 · Final response format

When a task is complete, report back tersely — no chain-of-thought, no per-file play-by-play, no restating the request:

```
### Completed
- What changed, in which files, in one or two lines.

### Validation
- What you actually ran (tests / build / lint) and the result.

### Remaining Issues
- Genuine open items, or `None.`
```

Act first, report last. Keep the final response short enough to read in a few seconds.
