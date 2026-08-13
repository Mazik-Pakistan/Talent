# TalentAI — AI Agent Master Instructions

> Master instruction file for AI coding agents working in this repository.
> Deep, module-level knowledge lives under `.agents/skills/` and `.agents/architecture/`.
> Root `AGENTS.md` remains the short field guide; **this file + skills are the full knowledge layer**.

---

## 0 · Prime directive

**Understand, then act. Stay in scope. Never weaken auth, permissions, or tenant isolation. Validate before calling anything done.**

If a change is unclear in scope, narrow it or ask — do not guess big.

**Before modifying any feature:** load the matching skill from `.agents/skills/README.md`, then inspect the listed primary files in the repo. The repository is always the source of truth over this documentation.

---

## 1 · Project overview

### What it is

**TalentAI** is a multi-tenant HR operating system: invite → offer → onboarding → IT provisioning → employee lifecycle → learning → talent/career growth — with a role-aware conversational agent that calls the **same** permission-checked service layer as the REST API.

### Core business purpose

- Run hiring and onboarding for an organization (recruiter)
- Capture candidate data and documents with OCR assistance
- Provision IT accounts/assets via public token links
- Graduate candidates into employees without re-entry
- Develop people via learning catalogs, skill gaps, career frameworks, internal opportunities
- Operate multiple tenant organizations from a hidden Super Admin portal

### Major user roles

| Role | Home | Purpose |
|------|------|---------|
| `super_admin` | `/portal-root-x9f3` login → `/dashboard/super-admin` | Platform orgs, recruiters, admin tickets |
| `recruiter` | `/dashboard/recruiter` | Hiring, employees, IT, learning admin, org config, talent |
| `candidate` | `/dashboard/candidate` | Offer, onboarding, documents, messages |
| `employee` | `/dashboard/employee` | Profile, learning, career, talent, IT support, messages |

### Major modules

Auth · Invitations · Offers · Onboarding · Documents/OCR · Employees · IT Provisioning · IT Service Requests · Learning · Talent · Career Framework · Organization Framework · Messages · Announcements/Notifications · Tickets · Email Templates · In-app Agent · Frontend AI mascots/copilot · Super Admin

### High-level architecture

```
Browser → Next.js 16 (proxy.js cookie gate) → frontend/services/*.js (axios)
                                              ↓
                              FastAPI routers (backend/app/api/*)
                                              ↓
                         Depends(require_roles / require_permissions / capabilities)
                                              ↓
                              Services (backend/app/services/*)
                     ┌────────────┼──────────────┐
                  MongoDB    Cloudinary      OpenRouter/Gemini
                  (Motor)    (+ optional       (llm_service)
                              Supabase)
```

### Technology stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 / React 19, CSS Modules + Tailwind 4, axios, react-toastify |
| Backend | FastAPI, Uvicorn, Pydantic, Motor (async MongoDB) |
| Auth | JWT (typed access/refresh), bcrypt, OTP email verification |
| AI | OpenRouter primary, Gemini fallback; product agent + learning AI + mascot briefs |
| Storage | Cloudinary (docs/photos); optional Supabase client |
| Infra | Docker Compose (mongo, redis, omniroute, backend, frontend); optional nginx gateway |
| Email | SMTP HTML via `email_service` + org-overridable templates |

---

## 2 · Repository structure

```
Talent/
├── AGENTS.md                 # Short agent field guide (workspace rule)
├── README.md                 # Product/architecture overview
├── .agents/                  # THIS knowledge system
│   ├── AGENTS.md             # Master instructions (you are here)
│   ├── architecture/         # Cross-cutting architecture docs
│   └── skills/               # Fine-grained, actionable module skills
├── backend/
│   ├── app/
│   │   ├── main.py           # App factory, CORS, lifespan seeds, router mount
│   │   ├── api/              # Thin routers only
│   │   ├── core/             # config, database, security, rbac, crypto
│   │   ├── schemas/          # Pydantic contracts
│   │   ├── services/         # All business logic
│   │   └── static/
│   ├── scripts/              # Seeds, backfills, smoke tests
│   ├── tests/                # pytest
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                  # App Router pages
│   ├── components/           # Role + shared UI
│   ├── services/             # API wrappers (never raw axios in pages)
│   ├── hooks/, lib/, utils/
│   ├── proxy.js              # Auth cookie gate
│   └── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
└── nginx/
```

---

## 3 · Architecture rules

### Layering (hard)

1. **Routers** (`app/api/`): parse request → auth dependency → call one service → return. No business `if` that decides outcomes.
2. **Services** (`app/services/`): all business logic, DB access, emails, notifications.
3. **Schemas** (`app/schemas/`): request/response contracts. Frontend has **no** shared codegen — contract drift fails at runtime.
4. **Core** (`app/core/`): config, DB, security deps, RBAC source of truth, crypto.
5. **Frontend pages** call **`services/*.js` only** — never inline `fetch`/`axios` for backend APIs.
6. **Agent tools** call services (same as REST) — never shortcut DB reads that bypass RBAC.

### Dependency rules

- Import shared `Require*` aliases from `app/core/security.py` when they fit; if a router needs a composed check (role + capability), define a **local clearly-named** dependency and document it.
- Never assume two symbols both named `RequireCandidate` are the same — `offers.py` vs `employees.py` differ.
- Recruiter features: check **role + capability** (`has_capability`). Capabilities alone do **not** block candidates/employees.
- New list/search queries: always filter by `organization_id` (or `recruiter_people_scope` / `organization_record_scope`) unless Super Admin cross-org.

### Import / code size norms

- Large single-file services (`learning_service.py`, `agent_tools*.py`, `employee_service.py`) are intentional — do not split as a side effect of an unrelated task.
- `agent_tools.py` vs `agent_tools_parity.py` is an intentional split (core vs dashboard-parity). Do not merge.

---

## 4 · Development rules

### Modify existing functionality

1. Find the skill → open primary files → mirror existing patterns.
2. Change the smallest surface that satisfies the task.
3. If API shape changes, update **backend schema + frontend `services/*.js` + consumers** in the same pass.

### Add new functionality

**Backend endpoint:** extend domain router → schema → service → correct `Require*` → register in `main.py` if new router → `py_compile` / OpenAPI check.

**Frontend page:** `app/.../page.js` → shell/nav → `services/*.js` → capability gate if recruiter → if public, add to `proxy.js` `PUBLIC_PATHS`.

**Agent tool:** correct `agent_tools*.py` → service call → role list → `READONLY_TOOLS` if read-only → no raw routes in prose.

### Refactor safely

- Prefer extract-within-file over new parallel modules.
- Do not “fix” CORS (`allow_origins=["*"]`) or rename `/portal-root-x9f3` unless asked.
- Do not turn lazy OCR/embedding imports into hard top-level imports.

### Errors, validation, loading, toasts (frontend)

- Field errors: inline (`FieldError` / `lib/formFeedback.js`).
- Operation failures: `toast.error(getApiErrorMessage(err, fallback))`.
- Success toasts only after backend confirms.
- Loading/empty/error states: follow the page’s existing pattern (shell loaders, inline notes).

### Backward compatibility

- Preserve JWT `type=access` vs `type=refresh` checks.
- Preserve legacy rows without `organization_id` via `recruiter_people_scope` where used.
- Do not break public token flows (`/invite`, `/offer`, `/it-setup`, `/it-support`).

---

## 5 · AI / LLM rules

Two product AI systems (plus coding agents reading this doc):

| System | Where | Role |
|--------|-------|------|
| **Autonomous agent** | `agent_service.py` + `agent_tools*.py` + `/api/agent/*` + `*/ai-assistant` pages | Tool-calling loop, max 4 steps |
| **Frontend AI UX** | `frontend/lib/ai/*`, `components/ai-experience/*`, role mascots | Context/insights, OCR overlays, form coach — not a second backend |
| **Learning AI** | `learning_ai_service.py` | Rank catalog courses, skill gaps (must use real UIDs) |
| **Mascot brief** | `recruiter_mascot_service.py` | Dashboard brief via LLM |

### Rules

- LLM via `llm_service.call_llm_json` — OpenRouter primary, Gemini fallback; strict JSON.
- No LLM key → deterministic `_fallback_reply` must keep working.
- Tools go through real services + RBAC; never invent catalog URLs/UIDs.
- Agent prose: natural language only; navigation via UI hints/buttons, never raw path strings like `/offer`.
- New read-only tools → add to `READONLY_TOOLS`.
- Confirm gate for destructive/bulk tools (`needs_confirm`).
- Do not put AI business rules only in the frontend; backend remains authoritative.

See: `.agents/architecture/ai.md`, skills `ai-agent/`, `ai-frontend/`, `llm/`.

---

## 6 · Security rules

- Never commit secrets (`.env`, keys). Never hardcode credentials.
- Never log/print/return banking or IT temp passwords in plaintext outside designated decrypt/reveal paths (Fernet in `app/core/crypto.py`).
- JWT: reject refresh tokens on API auth; keep lockout logic in `auth_service`.
- Super Admin route `/portal-root-x9f3` — do not link from public UI.
- OTP, invite tokens, IT tokens are capability-equivalent secrets — treat as such.
- Provider API secrets stored encrypted (`api_key_enc`, etc.) — do not return on connection tests.
- Audit: authz failures write `audit_logs`; do not remove audit calls casually.
- File access: signed Cloudinary URLs; verify ownership/org on download/verify.

---

## 7 · Database rules

- MongoDB via Motor; indexes created in `create_database_indexes()` using `_ensure_index`.
- Tenant data carries `organization_id`. Missing tenant filter = critical bug.
- Add indexes for new query patterns in `database.py`.
- Soft-delete / status fields: follow existing domain patterns (career tracks, offers, tickets).
- Banking fields encrypted at rest; IBAN uniqueness via `iban_hash`.
- No in-memory mock DB — app requires live `MONGODB_URI` to boot.
- Safe schema changes: additive fields preferred; backfill scripts live in `backend/scripts/`.

See: `.agents/architecture/database.md`, skill `database/`.

---

## 8 · UI / UX rules

- Role shells: `RecruiterShell`, `EmployeeShell`, `CandidateShell`, `SuperAdminShell`.
- Shared shell CSS via `components/shared/shell/*.module.css` + CSS Modules `composes:` — edit once, not per-role copies.
- Recruiter nav filtered by capabilities (`recruiterNav.js`).
- Design tokens in `globals.css` / `ai-theme.css` (Sora + Inter).
- Prefer existing loaders, empty notes, ConfirmDialog, StatusBadge, ProgressRing.
- AI UI: orb, activity panel, confirm cards, OCR overlays under `components/ai-experience/`.
- When working inside existing dashboards, **preserve the established visual language** (do not impose unrelated marketing-page design rules).

---

## 9 · Testing rules

- Backend: `pytest` under `backend/tests/` (JWT type, authz audit, tenant isolation, banking, career framework, agent ticket tool, providers, etc.).
- Scripts: smoke/e2e under `backend/scripts/` (not a substitute for pytest).
- Frontend: `npm run lint`, `npm run build` after UI changes.
- Critical regression areas: auth token typing, capability+role composition, tenant isolation, banking encrypt/mask, offer signing gate, agent confirm flow.
- Note pre-existing test failures before attributing them to your change.

---

## 10 · Git rules

- Do not commit unless the user asks.
- Do not force-push main/master; do not skip hooks unless asked.
- Prefer small, reviewable commits focused on why.
- Before commit: no secrets; grep renames; run relevant validation.
- Docker/env: root `.env` is compose overrides only; secrets stay in `backend/.env` (gitignored).

---

## 11 · Critical safety rules

Agents **must**:

1. Inspect existing implementation before changing it.
2. Reuse services/hooks/components — no parallel systems.
3. Avoid duplicate logic and unnecessary architecture changes.
4. Avoid breaking API contracts or silently changing business rules.
5. Avoid removing functionality “for cleanup.”
6. Avoid auth/permission changes without reading the full auth + RBAC + capability flow.
7. Avoid casual schema/index changes without migration/index updates.
8. Avoid replacing working integrations (SMTP, Cloudinary, Coursera, OmniRoute) without cause.
9. Keep CORS wide-open behavior unless explicitly tasked to change it.
10. Keep OCR/embeddings optional/lazy.

---

## 12 · How to use this knowledge system

1. Read this file (or root `AGENTS.md` for the short version).
2. Open `.agents/skills/README.md` and load **only** the skills relevant to the task.
3. Open matching `.agents/architecture/*.md` for cross-cutting context.
4. Verify against live code — docs can lag; code wins.
5. Implement → validate → report tersely.

### Lifecycle dependency map (actual)

```
Invite (+ required offer)
  → Candidate register (OTP)
  → Offer sign / negotiate (≤3 rounds)
  → Pre-hire onboarding + documents (OCR)
  → Recruiter document verify
  → IT provisioning (public token / batch)
  → Approve & activate → EMP-###### + Complete Profile
  → Learning / Talent / Career / IT service requests / HR messages
```

Cross-cuts: Document OCR → profile fields → matching → recruitment verify; Org Framework ↔ Learning courses (sync); Agent tools → same services as UI.

---

## 13 · Validation checklist

**Backend:** `python -m py_compile` touched files · app boot if startup/router touched · pytest for related tests · OpenAPI paths if routers changed · re-read RBAC/capabilities.

**Frontend:** `npm run lint` · `npm run build` · grep renames · proxy `PUBLIC_PATHS` if new public route · capability gates for recruiter pages.

**Contracts:** schema + `services/*.js` + UI updated together.
