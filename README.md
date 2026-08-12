# TalentAI

A multi-tenant hiring, onboarding, and workforce-development platform with a role-aware AI agent built directly into the product's permission-checked service layer, rather than layered on top as a separate chatbot.

**Stack:** Next.js 16 / React 19 · FastAPI · MongoDB · JWT + RBAC · OpenRouter / Gemini

---

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Roles](#roles)
- [The AI Agent Layer](#the-ai-agent-layer)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Roles & Permissions](#roles--permissions)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Testing & Scripts](#testing--scripts)
- [Security Notes](#security-notes)
- [Design Decisions](#design-decisions)
- [Working Conventions](#working-conventions)
- [Roadmap](#roadmap)

---

## Overview

Most HR systems separate their user-facing forms from any conversational layer, which forces the AI on top to duplicate business logic. TalentAI is built the other way around: the same permission-checked service layer that powers each dashboard also powers the AI agent, so a request like *"send Sarah's offer and extend it 3 days"* executes through the exact code path a button click would. There is no shadow logic and no separate rule set to keep in sync.

The platform is organized around four roles — Super Admin, Recruiter, Candidate, Employee — each with its own dashboard, its own permission set, and its own AI persona scoped to what that role is allowed to see and do.

```
Invite & Hire → Onboard & Verify → Provision IT → Employ & Support → Develop & Grow
```

Each stage is reachable through the UI or through natural language.

---

## Core Capabilities

| Area | Description |
|---|---|
| **Recruit** | Invite candidates individually or via bulk spreadsheet import, track the full pipeline, and manage the offer lifecycle — generation, digital signature, configurable expiry, extensions, and reminders. |
| **Onboard** | A multi-step candidate wizard with autosave, document upload with OCR field extraction (resumes, IDs, bank slips), and a recruiter-facing verification queue. |
| **Provision** | IT equipment and account-provisioning kits fire automatically once a candidate is hired, with batch provisioning links and a dedicated IT service-request flow. |
| **Employ** | Candidates transition cleanly into full employee profiles with a company email, personalized dashboard, and directory entry, without re-entering onboarding data. |
| **Develop** | Learning recommendations from a live Coursera + Microsoft Learn catalog sync, skill-gap detection against role requirements, certificate tracking, and per-organization career progression. |
| **Support** | IT and HR tickets with full activity/audit trails, plus internal messaging between employees/candidates and recruiters. |
| **Administer** | Super Admin manages every tenant organization and recruiter account, and views platform-wide health, from a hidden login route not exposed in the public UI. |

---

## Roles

**Super Admin** — platform owner
- Onboards new tenant organizations and manages recruiter accounts across them
- Views platform-wide statistics and organization health
- Triages support tickets escalated above individual organizations
- Signs in through a deliberately unlinked route, never through `/login`

**Recruiter** — runs hiring and post-hire operations for one organization
- Invites candidates individually or via bulk import; tracks the pipeline end to end
- Reviews and verifies uploaded onboarding documents
- Generates, sends, and manages offer letters, including extensions and reminders
- Manages the employee directory and IT provisioning
- Configures the organization's career framework: departments, roles, skills, promotion rules
- Has per-module capabilities an admin can toggle independently of the base role

**Candidate** — pre-hire, completing onboarding
- Accepts an invitation via tokenized link
- Completes a multi-step onboarding wizard with autosave
- Uploads documents with OCR-assisted extraction
- Views and digitally signs the offer letter
- Transitions into the Employee role on hire, without losing captured data

**Employee** — post-hire, ongoing lifecycle
- Full profile management and a personalized dashboard
- Learning module: course catalog, recommendations, skill-gap tracking, certificates
- Career module: track, level, and readiness against the promotion framework
- Applies to open internal roles
- Raises IT/HR support tickets and messages recruiters directly

---

## The AI Agent Layer

This is the architectural core of the product, implemented in `backend/app/services/agent_service.py` as a small, auditable loop:

1. **Build prompt** — role system prompt, tool catalog, a fresh state snapshot, recent conversation history, and the user's new message.
2. **Ask the LLM** — OpenRouter primary, Gemini fallback. The model must return a single strict-JSON action: call a tool, or reply.
3. **Execute** — against the same permission-checked service layer the REST API uses. No parallel logic path.
4. **Observe & loop** — the tool result feeds back in as an observation, bounded at four steps so the agent can't wander.
5. **Persist** — the conversation turn is saved; the reply and any UI hints (buttons, routes — never raw paths in prose) are returned.

If no LLM key is configured, a deterministic fallback still answers status questions, so the feature degrades gracefully instead of taking the dashboard down with it.

Tools are split across three files, assembled per role:

| File | Contains |
|---|---|
| `agent_tools.py` | Core recruiter/candidate/employee tools, plus shared self-serve tools |
| `agent_tools_parity.py` | Extended tools bringing the agent to full dashboard parity (a deliberate module split, not duplication) |
| `agent_tools_super_admin.py` | Platform-level tools for the Super Admin persona |

Read-only tools are tracked separately so the agent doesn't waste a step re-querying data it already has mid-turn. Every tool is scoped to exactly one role's tool list, so a candidate's session cannot invoke a recruiter tool regardless of what the conversation contains.

On the frontend, `lib/ai/` holds per-role context builders and insight generators; `components/ai-experience/` renders the widget set — an avatar, an activity panel showing agent actions, an OCR scan overlay, confirmation cards for write actions, save toasts, and a typewriter-style auto-fill coach for long forms.

**What distinguishes this from a support chatbot:** every tool call passes through the same RBAC dependency chain a REST request would. The agent cannot see another organization's data, act outside its role's permission set, or be prompted into bypassing a check the UI itself couldn't bypass.

---

## Architecture

```
┌───────────────────────────┐      HTTPS / JSON      ┌────────────────────────────┐
│   Next.js 16 Frontend      │ ─────────────────────▶ │    FastAPI Backend         │
│   (App Router · React 19)  │ ◀───────────────────── │    (async · Uvicorn)       │
│                            │                         │                            │
│  proxy.js — cookie-gated   │                         │  app/api/*      routers   │
│  auth on protected routes  │                         │  app/schemas/*  pydantic  │
│                            │                         │  app/services/* business  │
│  4 role dashboards:        │                         │  app/core/*     auth ·    │
│  super-admin · recruiter · │                         │                 db · rbac │
│  candidate · employee      │                         │                            │
│                            │                         │  agent_service.py ─────────┼──▶ OpenRouter / Gemini
│  AI widgets (lib/ai/,      │                         │  agent_tools*.py           │
│  ai-experience)            │                         └─────────────┬──────────────┘
└────────────────────────────┘                                       │
                                                                       ▼
                                                          ┌──────────────────────┐
                                                          │      MongoDB          │
                                                          │  (Motor · async)      │
                                                          │  65+ collections      │
                                                          └───────────┬──────────┘
                                                                      │
                                    ┌─────────────────────────────────┼─────────────────────────────────┐
                                    ▼                                 ▼                                 ▼
                          Cloudinary / Supabase                  SMTP (email)               Coursera / MS Learn
                               (storage)                                                     (live catalog APIs)
```

The frontend never talks to MongoDB or third-party APIs directly. Every request routes through FastAPI, which enforces auth and RBAC through shared dependencies before any business logic runs. There is no separate admin or internal API — every role uses the same routers, gated by different permission dependencies.

---

## Tech Stack

**Frontend**

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | CSS Modules + Tailwind v4 (PostCSS plugin) |
| Animation | framer-motion |
| Icons | lucide-react |
| HTTP | axios |
| Notifications | react-toastify |
| Spreadsheets | xlsx (bulk invite import/export) |
| Session | Cookie-based, enforced by `proxy.js` middleware |

**Backend**

| | |
|---|---|
| Framework | FastAPI (async) on Uvicorn |
| Database | MongoDB via Motor + Beanie/PyMongo — no ORM abstraction |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Rate limiting | slowapi |
| Logging | loguru / rich |
| File storage | Cloudinary and/or Supabase |
| LLM | OpenRouter (primary) + Gemini (fallback) |
| Document intelligence | PyMuPDF, python-docx, EasyOCR, Pytesseract, openpyxl — all lazy-imported |

---

## Repository Structure

```
Talent-main/
├── backend/
│   └── app/
│       ├── api/        one router per domain — parses request, checks auth, calls a service, returns
│       ├── core/        config.py · database.py · security.py (JWT + shared auth deps) · rbac.py · crypto.py
│       ├── schemas/     pydantic request/response contracts, one file per domain
│       ├── services/    all business logic
│       └── static/
├── backend/scripts/     one-off migration / backfill / verification scripts (run manually)
├── backend/tests/       pytest suite
└── frontend/
    ├── app/              Next.js App Router — routes nested under app/dashboard/{role}/...
    ├── components/       grouped by role/domain: recruiter, employee, candidate, super-admin,
    │                     onboarding, offers, ai, ai-experience, mascot, shared, ui
    ├── hooks/            cross-role shared hooks: session, sidebar, notifications, global search
    ├── lib/              apiClient + lib/ai/ (per-role AI context/insight builders)
    ├── services/         thin API wrapper modules — the only layer that calls the backend
    ├── utils/            nav configs, validation helpers
    └── proxy.js          cookie-based auth gate
```

**Notable routes**

| Path | Purpose |
|---|---|
| `/login`, `/register` | Standard auth |
| `/portal-root-x9f3` | Unguessable Super Admin login, never linked from the public UI |
| `/invite/[token]` | Candidate accepts a recruiter's invitation |
| `/onboarding` | Candidate onboarding wizard |
| `/offer` | Offer letter viewing/signing |
| `/documents` | Standalone document upload/verification flow |
| `/it-setup/[token]`, `/it-setup/batch/[token]` | IT provisioning intake |
| `/it-support/[token]` | IT service-request intake |
| `/dashboard/{role}/...` | Authenticated dashboards, one tree per role |

---

## Roles & Permissions

RBAC is defined in code (`backend/app/core/rbac.py`) and mirrored into MongoDB at startup purely for querying and auditing. Code is always the source of truth, never the database copy.

| Role | Home | Representative Permissions |
|---|---|---|
| `super_admin` | `/dashboard/super-admin` | Everything — platform-wide oversight |
| `recruiter` | `/dashboard/recruiter` | `recruitment.*`, `onboarding.manage`, `documents.review`, `offers.manage`, `learning.access`, `ai.access`, `reporting.view` |
| `candidate` | `/dashboard/candidate` | `onboarding.self`, `documents.self`, `offers.self`, `profile.view` |
| `employee` | `/dashboard/employee` | `onboarding.self`, `documents.self`, `offers.self`, `learning.access`, `profile.view` |

Recruiters also carry per-module capabilities — a finer toggle layer on top of role permissions, letting an organization disable one module for a specific recruiter without touching their role.

---

## Getting Started

**Prerequisites:** Node.js (Next.js 16 / React 19 compatible), Python 3.11+, a MongoDB instance. Optional but recommended: Redis, a Cloudinary or Supabase account, an OpenRouter or Gemini API key, SMTP credentials.

**1 · Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env       # fill in — see table below
uvicorn app.main:app --reload --port 8000
```

**2 · Frontend**
```bash
cd frontend
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

On first boot, the backend automatically:

1. Creates MongoDB indexes.
2. Migrates legacy employee IDs to the `EMP-xxxx` format.
3. Seeds RBAC roles/permissions, org taxonomy, and universities reference data.
4. Seeds default learning providers.
5. Creates a default organization if none exists yet.
6. Hydrates and starts a background refresh loop for the Coursera catalog cache.

**3 · First login** — run `backend/scripts/seed_super_admin.py` to create the first Super Admin account, sign in at `/portal-root-x9f3`, then invite recruiters, who in turn invite candidates through the normal `/login` flow.

---

## Environment Variables

Documented here for reference only — never commit real secret values. Actual secrets belong in local, git-ignored `.env` files.

**Backend — `backend/.env`**

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY`, `JWT_SECRET` | Yes | `JWT_SECRET` is validated at startup — under 32 characters or a known placeholder (`secret`, `changeme`, `test`, …) crashes the app on boot |
| `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE`, `JWT_EXPIRE_MINUTES` | Yes | Token config |
| `MONGODB_URI`, `DATABASE_NAME` | Yes | Supports `mongodb+srv://`; auto-switches to public DNS resolvers (8.8.8.8 / 1.1.1.1) since some routers block SRV lookups |
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET` | Optional | Storage backend; degrades gracefully if unset |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | Optional | Primary file/image storage |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_MAX_TOKENS`, `GEMINI_MODEL` | Optional | Powers the AI agent; without either key the agent falls back to deterministic replies |
| `REDIS_URL` | Yes | |
| `ALLOWED_ORIGINS` | Yes | Comma-separated; first entry also builds email/redirect links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS`, `MAIL_USE_SSL` | Yes | Gmail app-password spaces are auto-stripped |
| `FRONTEND_URL`, `BACKEND_URL` | Yes | Builds invite/offer/IT-setup links |
| `ENABLE_OCR`, `OCR_LANG`, `OCR_USE_GPU` | Optional | Document extraction toggles |
| `ENABLE_EMBEDDINGS`, `EMBEDDING_MODEL` | Optional | Forward-looking embeddings prep, off by default |
| `BANKING_ENCRYPTION_KEY` | Optional | Fernet key for banking-detail encryption; derived from `SECRET_KEY` if unset |
| `IT_MANAGER_EMAIL`, `IT_PROVISIONING_EXPIRE_DAYS` | Optional | IT provisioning defaults |
| `OFFER_EXPIRE_DAYS`, `OTP_EXPIRE_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `INVITATION_EXPIRE_HOURS` | Optional | Business-rule defaults with sensible fallbacks |

**Frontend — `frontend/.env.local`**

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | Base URL of the FastAPI backend, no trailing slash |

---

## Database

MongoDB is accessed directly through Motor — no ORM, no schema-migration tool. Pydantic schemas define the API-boundary shape; `app/core/database.py` owns index creation. 65+ collections, grouped as:

| Group | Collections |
|---|---|
| Identity & access | `recruiters`, `employees`, `candidates`, `super_admins`, `users`, `pending_users`, `organizations`, `roles`, `permissions`, `refresh_tokens`, `login_attempts`, `otp_verifications`, `company_email_password_otps`, `invitations` |
| Hiring & onboarding | `offer_letters`, `documents`, `it_provisioning_batches`, `it_provisioning_requests`, `it_kits` |
| Learning | `learning_courses`, `learning_enrollments`, `learning_assignments`, `learning_certificates`, `learning_skill_gaps`, `learning_skill_assessments`, `learning_ai_recommendations`, `learning_catalog_cache`, `learning_providers`, `learning_role_matches`, `learning_career_goals`, `learning_bookmarks` |
| Career & org framework | `career_tracks`, `career_levels`, `employee_career_assignments`, `employee_career_events`, `org_framework_departments`, `org_framework_roles`, `org_framework_skills`, `org_framework_courses`, `org_framework_certifications`, `org_framework_promotion_rules`, `org_framework_roadmaps`, `org_framework_versions`, `org_taxonomy` |
| Talent management | `talent_competency_evaluations`, `talent_development_plans`, `internal_opportunities`, `internal_opportunity_applications`, `employee_skills` |
| AI agent | `agent_conversations` |
| Support & comms | `tickets`, `ticket_replies`, `ticket_activity`, `ticket_audit_logs`, `it_service_requests`, `hr_threads`, `notifications`, `announcements`, `org_email_templates` |
| Ops | `audit_logs`, `counters`, `migrations`, `universities` |

---

## Testing & Scripts

```bash
cd backend && pytest
```

Covers agent support-ticket tools, authorization/audit behavior, banking-endpoint security, career-framework logic, JWT token typing, org-wide recruiter access scoping, profile/email flows, provider support, and search taxonomy. There is no automated frontend suite yet; `npm run lint` (ESLint, Next.js core-web-vitals config) is the available static check.

**Operational scripts — `backend/scripts/`** (run manually, not part of the request lifecycle)

| Script | Purpose |
|---|---|
| `seed_super_admin.py` | Bootstrap the first Super Admin account |
| `backfill_dual_role_recruiters.py`, `reconcile_dual_role_profiles.py`, `verify_dual_role.py` | Recruiter/employee dual-role data migrations |
| `backfill_org_scoping.py`, `backfill_organization_tenancy.py` | Multi-tenancy backfills |
| `migrate_providers.py` | Learning provider migration |
| `check_career_data.py` | Career framework data sanity check |
| `test_api_endpoints.py`, `test_learning_ai.py`, `test_openrouter.py`, `e2e_import_single_course_test.py`, `e2e_step2_backfill_match_test.py` | Manual integration/e2e checks (not pytest-collected) |

---

## Security Notes

- `JWT_SECRET` is validated at startup — weak or placeholder values crash the app rather than run insecurely.
- Access tokens are typed (`access` vs `refresh`) to block refresh-token replay as an access token.
- Passwords are hashed with bcrypt via passlib; accounts lock 15 minutes after 5 failed logins.
- Banking and other sensitive employee data is Fernet-encrypted at rest.
- Super Admin login sits at an unguessable, unlinked path instead of `/admin`.
- CORS currently allows all origins with `allow_credentials=False` (`backend/app/main.py`) — tighten for production deployments handling real user data.
- The AI agent is hard-scoped to the calling user's role and the same permission-checked service layer as the REST API; it cannot access another user's data or bypass RBAC regardless of what the conversation attempts.

---

## Design Decisions

- **No ORM.** MongoDB is accessed directly through Motor, with Pydantic schemas doing shape validation at the API boundary instead of a heavier ORM layer. This keeps queries close to the metal but makes index management and data-shape discipline manual — see `app/core/database.py`.
- **RBAC lives in code, not the database.** The `roles`/`permissions` collections are a seeded, queryable mirror of what's defined in `app/core/rbac.py`, refreshed on every boot. If they disagree, code wins.
- **The agent has no privileged path.** Every tool it calls is the same service function a REST endpoint would call, behind the same permission dependency — a deliberate constraint that keeps the agent auditable.
- **Multi-tenancy is row-level, not database-level.** All organizations share one MongoDB database, isolated by an `organization_id` field per document rather than separate databases per tenant. This keeps operations simple at the current scale but means every new query must remember to scope by tenant.
- **Optional dependencies degrade, they don't block.** OCR, embeddings, and LLM integrations lazy-import and fail soft, so the platform stays usable even without one of those optional pieces configured.

---

## Working Conventions

This codebase involves heavy AI-agent participation in its development, so a few conventions are load-bearing:

- **Inspect before you change.** Read the existing implementation and follow its patterns before writing anything new.
- **Preserve behavior unless the task says otherwise.** Business logic, API contracts, auth/permission checks, and validations stay put unless explicitly asked to change.
- **Stay in scope.** No unrelated refactors, renames, reformatting, or speculative improvements riding along with a focused change.
- **Reuse before you build.** Search for an existing service function, hook, or component before adding a new one.
- **Validate before calling it done.** Run whatever applies — compile, lint, build, test — and check imports/references after any rename or move.

See `AGENTS.md` for the full, tool-level version of this contract used by autonomous coding agents working in this repo.

---

## Roadmap

The following are potential directions based on the current architecture, not scheduled deliverables:

- Tighten CORS to an explicit allowlist for production deployments.
- Introduce a shared type contract (e.g. TypeScript types generated from the FastAPI OpenAPI schema) so frontend/backend contract drift fails at build time instead of runtime.
- Add automated frontend test coverage alongside the existing pytest backend suite.
- Offer a formal database-per-tenant option for organizations that need harder data isolation than row-level scoping provides.