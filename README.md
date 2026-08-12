<div align="center">

# ✦ TalentAI

### The HR platform that doesn't just track people — it acts on their behalf.

A multi-tenant hiring, onboarding, and workforce-development operating system, built around a role-aware AI agent wired directly into the product's own permission-checked service layer — not a chatbot bolted on top of one.

<br>

![Frontend](https://img.shields.io/badge/frontend-Next.js%2016%20%2F%20React%2019-black?style=flat-square&logo=next.js)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square&logo=fastapi)
![Database](https://img.shields.io/badge/database-MongoDB-47A248?style=flat-square&logo=mongodb)
![AI](https://img.shields.io/badge/LLM-OpenRouter%20%2F%20Gemini-8A2BE2?style=flat-square)
![Auth](https://img.shields.io/badge/auth-JWT%20%2B%20RBAC-orange?style=flat-square)
![Tenancy](https://img.shields.io/badge/architecture-multi--tenant-blue?style=flat-square)

</div>

<br>

```
  ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
  │  Invite │ ─▶ │  Onboard  │ ─▶ │  Provi-  │ ─▶ │   Employ    │ ─▶ │  Develop  │
  │  & Hire │    │ + verify  │    │  sion IT │    │  + support  │    │  & grow   │
  └─────────┘    └───────────┘    └──────────┘    └────────────┘    └──────────┘
        every stage reachable through the UI  —  or through natural language
```

<br>

## Table of contents

- [Why this exists](#-why-this-exists)
- [What it does](#-what-it-does)
- [Product walkthrough by role](#-product-walkthrough-by-role)
- [The AI agent layer](#-the-ai-agent-layer)
- [Architecture](#-architecture)
- [Tech stack](#-tech-stack)
- [Repository map](#-repository-map)
- [Roles & permissions](#-roles--permissions)
- [Getting started](#-getting-started)
- [Environment variables](#-environment-variables)
- [Database](#-database)
- [Testing & scripts](#-testing--scripts)
- [Security notes](#-security-notes)
- [Design decisions worth knowing](#-design-decisions-worth-knowing)
- [Working conventions](#-working-conventions)
- [Roadmap ideas](#-roadmap-ideas)

<br>

## ◆ Why this exists

Most HR systems are forms with a database behind them. TalentAI is built around one idea: **the same permission-checked service layer that powers the dashboard should also power a conversational agent** — so a recruiter can type *"send Sarah's offer and extend it 3 days"* and the agent executes it through the exact same code path a button click would. No shadow logic. No shortcuts. No separate "AI version" of the business rules to keep in sync.

The result is a platform with four first-class roles — **Super Admin, Recruiter, Candidate, Employee** — each with its own dashboard, its own permission set, and its own AI persona that can *see* and *act* on real data, scoped to exactly what that role is allowed to touch.

<br>

## ◆ What it does

<table>
<tr>
<td width="26%" valign="top"><strong>🎯 Recruit</strong></td>
<td>Invite candidates one at a time or via bulk spreadsheet import, track them through the pipeline, and manage the full offer lifecycle — generation, digital signature, configurable expiry, extensions, and automated reminders.</td>
</tr>
<tr>
<td valign="top"><strong>📋 Onboard</strong></td>
<td>A multi-step candidate wizard with autosave at every step, document upload with OCR field-extraction (resumes, IDs, bank slips), and a recruiter-facing verification queue before anything is marked complete.</td>
</tr>
<tr>
<td valign="top"><strong>💻 Provision</strong></td>
<td>IT equipment and account-provisioning kits fire automatically once a candidate is hired, with batch provisioning links and a dedicated IT service-request ticketing flow.</td>
</tr>
<tr>
<td valign="top"><strong>👤 Employ</strong></td>
<td>Candidates graduate cleanly into full employee profiles with a company email, a personalized dashboard, and a place in the employee directory — without re-entering data already captured during onboarding.</td>
</tr>
<tr>
<td valign="top"><strong>📈 Develop</strong></td>
<td>Learning recommendations sourced from a <em>live</em> Coursera + Microsoft Learn catalog sync, skill-gap detection against role requirements, certificate tracking, and career-track/promotion-ladder progression defined per organization.</td>
</tr>
<tr>
<td valign="top"><strong>🎫 Support</strong></td>
<td>IT and general HR support tickets with full activity/audit trails, plus internal messaging threads between employees/candidates and recruiters.</td>
</tr>
<tr>
<td valign="top"><strong>🛡️ Administer</strong></td>
<td>A Super Admin runs the entire platform — every tenant organization, every recruiter account, platform-wide health — from a hidden, unguessable login route that never appears in the public UI.</td>
</tr>
</table>

<br>

## ◆ Product walkthrough by role

<details>
<summary><strong>🛡️ Super Admin</strong> — platform owner, sees everything</summary>
<br>

- Onboards new tenant organizations onto the platform.
- Invites and manages recruiter accounts across every organization.
- Views platform-wide statistics and organization health.
- Triages support tickets that escalate above individual organizations.
- Signs in through a deliberately unlinked, unguessable route — never through the standard `/login` page.

</details>

<details>
<summary><strong>🎯 Recruiter</strong> — runs hiring and post-hire operations for one organization</summary>
<br>

- Invites candidates individually or via bulk spreadsheet import.
- Tracks the full candidate pipeline from invitation to hire.
- Reviews and verifies uploaded onboarding documents.
- Generates, sends, and manages offer letters, including extensions and reminders.
- Manages the employee directory, IT provisioning, and IT kits post-hire.
- Configures the organization's own career framework: departments, roles, skills, promotion rules.
- Has per-module **capabilities** an admin can toggle independently of their base role — e.g. a recruiter can be fully role-permitted but still have a specific module switched off for them.

</details>

<details>
<summary><strong>📋 Candidate</strong> — pre-hire, completing onboarding</summary>
<br>

- Accepts an invitation via a tokenized link.
- Completes a multi-step onboarding wizard that autosaves as they go.
- Uploads documents with OCR-assisted field extraction to reduce manual typing.
- Views and digitally signs their offer letter.
- Once hired, transitions into the Employee role without losing any captured data.

</details>

<details>
<summary><strong>👤 Employee</strong> — post-hire, ongoing lifecycle</summary>
<br>

- Full profile management and a personalized dashboard.
- Learning module: live course catalog, recommendations, skill-gap tracking, certificates.
- Career module: sees their track, level, and readiness against the organization's promotion framework.
- Internal opportunities: applies to open internal roles.
- Raises IT support requests and general HR support tickets.
- Messages recruiters/HR directly through internal threads.

</details>

<br>

## ◆ The AI agent layer

This is the part worth reading closely — it's the architectural core of the product, not a feature bolted on at the end.

`backend/app/services/agent_service.py` implements a small, auditable loop:

```
 1. build prompt   → role system prompt + tool catalog + fresh state snapshot
                      + recent conversation history + the user's new message

 2. ask the LLM    → OpenRouter primary, Gemini fallback — must return ONE
                      strict-JSON action: call a tool, or reply

 3. execute        → against the SAME permission-checked service layer the
                      REST API uses. No back door. No parallel logic.

 4. observe & loop → tool result feeds back in as an observation
                      (bounded at 4 steps, so the agent can't wander)

 5. persist        → conversation turn saved, reply + UI hints returned
                      (buttons/routes — never raw paths in agent prose)
```

If no LLM key is configured, a deterministic fallback still answers status questions — the feature **degrades gracefully** instead of taking the dashboard down with it.

Tools are split across three files and assembled per role:

| File | Contains |
|---|---|
| `agent_tools.py` | Core recruiter/candidate/employee tools, plus shared self-serve tools |
| `agent_tools_parity.py` | Extended tools bringing the agent to full dashboard parity — a deliberate module split, not duplicate code |
| `agent_tools_super_admin.py` | Platform-level tools for the Super Admin persona |

Read-only tools are tracked separately so the agent never wastes a step re-querying data it already has mid-turn — and every tool is scoped to exactly one role's tool list, so a candidate's agent session physically cannot invoke a recruiter tool, regardless of what the conversation says.

On the frontend, `lib/ai/` holds per-role context builders and insight generators; `components/ai-experience/` renders the actual widget set — an orb avatar, an activity panel showing what the agent is doing, an OCR scan overlay, confirmation cards for write actions, save toasts, and a typewriter-style auto-fill coach that helps fill out long forms conversationally.

**What makes this different from a support chatbot:** every tool call goes through the identical RBAC dependency chain a REST request would. The agent cannot see another organization's data, cannot act outside its role's permission set, and cannot be prompted into bypassing a check that the UI itself couldn't bypass.

<br>

## ◆ Architecture

```
┌──────────────────────────┐        HTTPS / JSON        ┌───────────────────────────┐
│    Next.js 16 Frontend    │  ─────────────────────────▶ │     FastAPI Backend        │
│    (App Router · React 19)│  ◀───────────────────────── │     (async · Uvicorn)      │
│                           │                              │                            │
│  proxy.js                 │                              │  app/api/*      routers    │
│   cookie-gated auth on    │                              │  app/schemas/*  pydantic   │
│   every protected route   │                              │  app/services/* business   │
│                           │                              │  app/core/*     auth · db · │
│  4 role dashboards        │                              │                 rbac · cfg  │
│   super-admin · recruiter │                              │                            │
│   · candidate · employee  │                              │  agent_service.py  ────────┼──▶ OpenRouter / Gemini
│                           │                              │  agent_tools*.py           │
│  AI widgets               │                              │                            │
│   (lib/ai/, ai-experience)│                              └─────────────┬──────────────┘
└──────────────────────────┘                                            │
                                                                          ▼
                                                              ┌──────────────────────┐
                                                              │       MongoDB          │
                                                              │   (Motor · async)       │
                                                              │   65+ collections       │
                                                              └──────────────────────┘
                                                                          │
                                        ┌─────────────────────────────────┼─────────────────────────────────┐
                                        ▼                                 ▼                                 ▼
                              Cloudinary / Supabase                  SMTP (email)               Coursera / MS Learn
                                    (storage)                                                     (live catalog APIs)
```

The frontend **never** talks to MongoDB or third-party APIs directly. Every request routes through FastAPI, which enforces auth and RBAC through shared dependencies before a single line of business logic runs. There is no separate "admin API" or "internal API" — every role uses the same routers, gated by different permission dependencies.

<br>

## ◆ Tech stack

<table>
<tr><td valign="top" width="50%">

**Frontend**

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | CSS Modules + Tailwind v4 (PostCSS plugin) |
| Animation | `framer-motion` |
| Icons | `lucide-react` |
| HTTP | `axios` |
| Notifications | `react-toastify` |
| Spreadsheets | `xlsx` (bulk invite import/export) |
| Session | Cookie-based, enforced by `proxy.js` middleware |

</td><td valign="top" width="50%">

**Backend**

| | |
|---|---|
| Framework | FastAPI (async) on Uvicorn |
| Database | MongoDB via Motor + Beanie/PyMongo — no ORM abstraction |
| Auth | JWT (`python-jose`) + `bcrypt` (`passlib`) |
| Rate limiting | `slowapi` |
| Logging | `loguru` / `rich` |
| File storage | Cloudinary and/or Supabase |
| LLM | OpenRouter (primary) + Gemini (fallback) |
| Document intelligence | PyMuPDF, `python-docx`, EasyOCR, Pytesseract, `openpyxl` — all lazy-imported |

</td></tr>
</table>

<br>

## ◆ Repository map

```
Talent-main/
├── backend/
│   └── app/
│       ├── api/         one router per domain — parses request, checks auth, calls a service, returns
│       ├── core/         config.py · database.py · security.py (JWT + shared auth deps) · rbac.py · crypto.py
│       ├── schemas/      pydantic request/response contracts, one file per domain
│       ├── services/     ALL business logic lives here — the real weight of the backend
│       └── static/
├── backend/scripts/       one-off migration / backfill / verification scripts (run manually)
├── backend/tests/         pytest suite
└── frontend/
    ├── app/                Next.js App Router — routes nested under app/dashboard/{role}/...
    ├── components/         grouped by role/domain: recruiter, employee, candidate, super-admin,
    │                       onboarding, offers, ai, ai-experience, mascot, shared, ui
    ├── hooks/              cross-role shared hooks: session, sidebar, notifications, global search
    ├── lib/                apiClient + lib/ai/ (per-role AI context/insight builders)
    ├── services/           thin API wrapper modules — the ONLY layer that calls the backend
    ├── utils/              nav configs, validation helpers
    └── proxy.js            cookie-based auth gate
```

<details>
<summary><strong>Notable routes</strong></summary>
<br>

| Path | Purpose |
|---|---|
| `/login`, `/register` | Standard auth |
| `/portal-root-x9f3` | Deliberately unguessable Super Admin login — never linked from public UI |
| `/invite/[token]` | Candidate accepts a recruiter's invitation |
| `/onboarding` | Candidate onboarding wizard |
| `/offer` | Offer letter viewing/signing |
| `/documents` | Standalone document upload/verification flow |
| `/it-setup/[token]`, `/it-setup/batch/[token]` | IT provisioning intake |
| `/it-support/[token]` | IT service-request intake |
| `/dashboard/{role}/...` | Authenticated dashboards, one tree per role |

</details>

<br>

## ◆ Roles & permissions

RBAC is defined **in code** (`backend/app/core/rbac.py`) and mirrored into MongoDB at startup purely for querying/auditing — code is always the source of truth, never the database copy.

| Role | Home | Representative permissions |
|---|---|---|
| `super_admin` | `/dashboard/super-admin` | Everything — platform-wide oversight |
| `recruiter` | `/dashboard/recruiter` | `recruitment.*` · `onboarding.manage` · `documents.review` · `offers.manage` · `learning.access` · `ai.access` · `reporting.view` |
| `candidate` | `/dashboard/candidate` | `onboarding.self` · `documents.self` · `offers.self` · `profile.view` |
| `employee` | `/dashboard/employee` | `onboarding.self` · `documents.self` · `offers.self` · `learning.access` · `profile.view` |

Recruiters also carry per-module **capabilities** — a finer toggle layer on top of role permissions, letting an org disable one module for one specific recruiter without touching their role.

<br>

## ◆ Getting started

**Prerequisites:** Node.js (Next.js 16 / React 19 compatible), Python 3.11+, a MongoDB instance. Optional but recommended: Redis, a Cloudinary or Supabase account, an OpenRouter or Gemini API key, SMTP credentials.

<table>
<tr><td valign="top" width="50%">

**1 · Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env       # fill in — see table below
uvicorn app.main:app --reload --port 8000
```

</td><td valign="top" width="50%">

**2 · Frontend**
```bash
cd frontend
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

</td></tr>
</table>

On first boot, the backend automatically:

1. Creates MongoDB indexes.
2. Migrates legacy employee IDs to the `EMP-xxxx` format.
3. Seeds RBAC roles/permissions, org taxonomy, and universities reference data.
4. Seeds default learning providers.
5. Creates a default organization if none exists yet.
6. Hydrates and starts a background refresh loop for the Coursera catalog cache.

**3 · First login** — run `backend/scripts/seed_super_admin.py` to create your first Super Admin account, sign in at `/portal-root-x9f3`, then invite recruiters, who in turn invite candidates through the normal `/login` flow.

<br>

## ◆ Environment variables

> It's good practice to document required env vars in a README — that's what's below. Treat this as a reference for *which* variables exist and what they do; never commit real secret values anywhere, including here. Actual secrets belong only in your local, git-ignored `.env` files.

<details open>
<summary><strong>Backend — <code>backend/.env</code></strong></summary>
<br>

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY`, `JWT_SECRET` | ✅ | `JWT_SECRET` is validated at startup — under 32 chars or a known placeholder (`secret`, `changeme`, `test`, …) **crashes the app on boot** |
| `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE`, `JWT_EXPIRE_MINUTES` | ✅ | Token config |
| `MONGODB_URI`, `DATABASE_NAME` | ✅ | Supports `mongodb+srv://`; auto-switches to public DNS resolvers (8.8.8.8 / 1.1.1.1) since some routers block SRV lookups |
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET` | Optional | Storage backend; degrades gracefully if unset |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | Optional | Primary file/image storage |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_MAX_TOKENS`, `GEMINI_MODEL` | Optional | Powers the AI agent; without either key the agent falls back to deterministic replies |
| `REDIS_URL` | ✅ | |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated; first entry also builds email/redirect links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS`, `MAIL_USE_SSL` | ✅ | Gmail app-password spaces are auto-stripped |
| `FRONTEND_URL`, `BACKEND_URL` | ✅ | Builds invite/offer/IT-setup links |
| `ENABLE_OCR`, `OCR_LANG`, `OCR_USE_GPU` | Optional | Document extraction toggles |
| `ENABLE_EMBEDDINGS`, `EMBEDDING_MODEL` | Optional | Forward-looking embeddings prep, off by default |
| `BANKING_ENCRYPTION_KEY` | Optional | Fernet key for banking-detail encryption; derived from `SECRET_KEY` if unset |
| `IT_MANAGER_EMAIL`, `IT_PROVISIONING_EXPIRE_DAYS` | Optional | IT provisioning defaults |
| `OFFER_EXPIRE_DAYS`, `OTP_EXPIRE_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `INVITATION_EXPIRE_HOURS` | Optional | Business-rule defaults with sensible fallbacks |

</details>

<details open>
<summary><strong>Frontend — <code>frontend/.env.local</code></strong></summary>
<br>

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | ✅ | Base URL of the FastAPI backend, no trailing slash |

</details>

<br>

## ◆ Database

MongoDB is accessed directly through Motor — no ORM, no schema-migration tool. Pydantic schemas define the API-boundary shape; `app/core/database.py` owns index creation. **65+ collections**, grouped roughly as:

<details>
<summary><strong>Full collection map</strong></summary>
<br>

| Group | Collections |
|---|---|
| Identity & access | `recruiters` · `employees` · `candidates` · `super_admins` · `users` · `pending_users` · `organizations` · `roles` · `permissions` · `refresh_tokens` · `login_attempts` · `otp_verifications` · `company_email_password_otps` · `invitations` |
| Hiring & onboarding | `offer_letters` · `documents` · `it_provisioning_batches` · `it_provisioning_requests` · `it_kits` |
| Learning | `learning_courses` · `learning_enrollments` · `learning_assignments` · `learning_certificates` · `learning_skill_gaps` · `learning_skill_assessments` · `learning_ai_recommendations` · `learning_catalog_cache` · `learning_providers` · `learning_role_matches` · `learning_career_goals` · `learning_bookmarks` |
| Career & org framework | `career_tracks` · `career_levels` · `employee_career_assignments` · `employee_career_events` · `org_framework_departments` · `org_framework_roles` · `org_framework_skills` · `org_framework_courses` · `org_framework_certifications` · `org_framework_promotion_rules` · `org_framework_roadmaps` · `org_framework_versions` · `org_taxonomy` |
| Talent management | `talent_competency_evaluations` · `talent_development_plans` · `internal_opportunities` · `internal_opportunity_applications` · `employee_skills` |
| AI agent | `agent_conversations` |
| Support & comms | `tickets` · `ticket_replies` · `ticket_activity` · `ticket_audit_logs` · `it_service_requests` · `hr_threads` · `notifications` · `announcements` · `org_email_templates` |
| Ops | `audit_logs` · `counters` · `migrations` · `universities` |

</details>

<br>

## ◆ Testing & scripts

```bash
cd backend && pytest
```

Covers: agent support-ticket tools, authorization/audit behavior, banking-endpoint security, career-framework logic, JWT token typing, org-wide recruiter access scoping, profile/email flows, provider support, and search taxonomy. There's no automated frontend suite yet — `npm run lint` (ESLint, Next.js core-web-vitals config) is the available static check.

<details>
<summary><strong>Operational scripts — <code>backend/scripts/</code></strong> (run manually, not part of the request lifecycle)</summary>
<br>

| Script | Purpose |
|---|---|
| `seed_super_admin.py` | Bootstrap the first Super Admin account |
| `backfill_dual_role_recruiters.py`, `reconcile_dual_role_profiles.py`, `verify_dual_role.py` | Recruiter/employee dual-role data migrations |
| `backfill_org_scoping.py`, `backfill_organization_tenancy.py` | Multi-tenancy backfills |
| `migrate_providers.py` | Learning provider migration |
| `check_career_data.py` | Career framework data sanity check |
| `test_api_endpoints.py`, `test_learning_ai.py`, `test_openrouter.py`, `e2e_import_single_course_test.py`, `e2e_step2_backfill_match_test.py` | Manual integration/e2e checks (not pytest-collected) |

</details>

<br>

## ◆ Security notes

- **`JWT_SECRET` is validated at startup** — weak or placeholder values crash the app rather than run insecurely.
- Access tokens are typed (`access` vs `refresh`) to block refresh-token replay as an access token.
- Passwords hashed with `bcrypt` via `passlib`; accounts lock 15 minutes after 5 failed logins.
- Banking and other sensitive employee data is Fernet-encrypted at rest.
- Super Admin login sits at an unguessable, unlinked path instead of `/admin`.
- CORS currently allows all origins with `allow_credentials=False` (`backend/app/main.py`) — tighten for production deployments handling real user data.
- The AI agent is hard-scoped to the calling user's role and the same permission-checked service layer as the REST API — it cannot access another user's data or bypass RBAC, regardless of what the conversation tries to coax it into.

<br>

## ◆ Design decisions worth knowing

- **No ORM.** MongoDB is accessed directly through Motor, with Pydantic schemas doing the shape-validation work at the API boundary instead of a heavier ORM layer. This keeps queries close to the metal but means index management and data-shape discipline are manual — see `app/core/database.py`.
- **RBAC lives in code, not the database.** The `roles`/`permissions` collections are a seeded, queryable mirror of what's defined in `app/core/rbac.py`, refreshed on every boot. If they ever disagree, code wins.
- **The agent has no privileged path.** Every tool it calls is the same service function a REST endpoint would call, behind the same permission dependency. This was a deliberate constraint, not an oversight — it's what makes the agent auditable.
- **Multi-tenancy is row-level, not database-level.** All organizations share one MongoDB database, isolated by an `organization_id` field per document rather than separate databases per tenant. This keeps operations simple at the current scale but means every new query must remember to scope by tenant.
- **Optional dependencies degrade, they don't block.** OCR, embeddings, and LLM integrations are all designed to lazy-import and fail soft — the platform stays usable even in an environment missing one of those optional pieces.

<br>

## ◆ Working conventions

This codebase is developed with heavy AI-agent involvement, so a few habits are load-bearing:

- **Inspect before you change.** Read the existing implementation and follow its patterns before writing anything new.
- **Preserve behavior unless the task says otherwise** — business logic, API contracts, auth/permission checks, and validations stay put unless explicitly asked to change.
- **Stay in scope.** No unrelated refactors, renames, reformatting, or speculative improvements riding along with a focused change.
- **Reuse before you build.** Search for an existing service function, hook, or component before adding a new one.
- **Validate before calling it done** — compile/lint/build/test, whatever applies, and check imports/references after any rename or move.

See **`AGENTS.md`** for the full, tool-level version of this contract used by autonomous coding agents working in this repo.

<br>

## ◆ Roadmap ideas

Not commitments — just directions the current architecture makes natural next steps:

- Tighten CORS to an explicit allowlist for production deployments.
- Introduce a shared type contract (e.g. generated TypeScript types from the FastAPI OpenAPI schema) so frontend/backend contract drift fails at build time instead of runtime.
- Automated frontend test coverage alongside the existing `pytest` backend suite.
- Formal database-per-tenant option for organizations that need harder data isolation than row-level scoping provides.
