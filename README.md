<div align="center">

# ✦ TalentAI

### The HR platform that doesn't just track people — it acts on their behalf.

*A multi-tenant hiring, onboarding, and workforce-development OS with a role-aware AI agent wired straight into the product's own service layer.*

`Next.js 16` · `React 19` · `FastAPI` · `MongoDB` · `OpenRouter / Gemini`

</div>

<br>

```
  ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
  │  Invite │ ─▶ │  Onboard  │ ─▶ │  Provi-  │ ─▶ │   Employ    │ ─▶ │  Develop  │
  │  & Hire │    │ + verify  │    │  sion IT │    │  + support  │    │  & grow   │
  └─────────┘    └───────────┘    └──────────┘    └────────────┘    └──────────┘
        every stage reachable through the UI  —  or through natural language
```

---

## Why this exists

Most HR systems are forms with a database behind them. TalentAI is built around one idea: **the same permission-checked service layer that powers the dashboard should also power a conversational agent** — so a recruiter can say *"send Sarah's offer and extend it 3 days"* and the agent executes it through the exact same code path a button click would, no shadow logic, no shortcuts.

The result is a platform with four first-class roles — **Super Admin, Recruiter, Candidate, Employee** — each with its own dashboard, its own permission set, and its own AI persona that can *see* and *act* on real data.

---

## ◆ What it does

<table>
<tr><td width="26%"><strong>Recruit</strong></td><td>Invite candidates (single or bulk import), track pipeline, manage the full offer lifecycle — generation, digital signature, expiry, extensions, reminders.</td></tr>
<tr><td><strong>Onboard</strong></td><td>Multi-step candidate wizard with autosave, document upload with OCR field-extraction (resumes, IDs, bank slips), recruiter verification queue.</td></tr>
<tr><td><strong>Provision</strong></td><td>IT equipment/account kits fire automatically on hire; batch provisioning links and IT service-request tickets.</td></tr>
<tr><td><strong>Employ</strong></td><td>Candidates graduate into full employee profiles with company email, dashboard, and directory presence.</td></tr>
<tr><td><strong>Develop</strong></td><td>AI-driven learning recommendations against a <em>live</em> Coursera + Microsoft Learn catalog, skill-gap detection, certificates, and career-track/promotion-ladder progression defined per organization.</td></tr>
<tr><td><strong>Support</strong></td><td>IT and HR support tickets with activity trails; internal messaging threads between employees/candidates and recruiters.</td></tr>
<tr><td><strong>Administer</strong></td><td>A Super Admin runs the whole platform — every tenant organization, every recruiter, platform-wide health — from a hidden, unguessable login route.</td></tr>
</table>

---

## ◆ The AI agent layer

This is the part worth reading closely.

`backend/app/services/agent_service.py` implements a small, auditable loop — not a black box:

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
| `agent_tools.py` | Core recruiter/candidate/employee tools + shared self-serve tools |
| `agent_tools_parity.py` | Extended tools bringing the agent to full dashboard parity — a deliberate module split, not duplicate code |
| `agent_tools_super_admin.py` | Platform-level tools for the Super Admin persona |

Read-only tools are tracked separately (`READONLY_TOOLS`) so the agent never wastes a step re-querying data it already has mid-turn — and every tool is scoped to exactly one role's tool list, so a candidate's agent session physically cannot reach a recruiter tool.

On the frontend, `lib/ai/` holds per-role context builders and insight generators; `components/ai-experience/` renders the actual widget set — an orb avatar, activity panel, OCR scan overlay, confirm cards, save toasts, and a typewriter-style auto-fill coach for forms.

---

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
                                                              │   70+ collections       │
                                                              └──────────────────────┘
                                                                          │
                                        ┌─────────────────────────────────┼─────────────────────────────────┐
                                        ▼                                 ▼                                 ▼
                              Cloudinary / Supabase                  SMTP (email)               Coursera / MS Learn
                                    (storage)                                                     (live catalog APIs)
```

The frontend **never** talks to MongoDB or third-party APIs directly. Every request routes through FastAPI, which enforces auth and RBAC through shared dependencies before a single line of business logic runs.

---

## ◆ Tech stack

<table>
<tr><td valign="top" width="50%">

**Frontend**
- Next.js 16 (App Router) + React 19
- CSS Modules + Tailwind v4 (PostCSS plugin)
- `framer-motion` · `lucide-react` · `axios` · `react-toastify` · `xlsx`
- Cookie-based session, enforced by `proxy.js` middleware

</td><td valign="top" width="50%">

**Backend**
- FastAPI (async) on Uvicorn
- MongoDB via Motor + Beanie/PyMongo — no ORM abstraction
- JWT auth (`python-jose`) + `bcrypt` (`passlib`)
- `slowapi` rate limiting, `loguru` / `rich` logging
- Cloudinary and/or Supabase for storage
- OpenRouter (primary) + Gemini (fallback) for LLM calls
- PyMuPDF, `python-docx`, EasyOCR, Pytesseract, `openpyxl` — all lazy-imported

</td></tr>
</table>

---

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
    ├── lib/                apiClient + lib/ai/ (every AI context/insight builder)
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

---

## ◆ Roles & permissions

RBAC is defined **in code** (`backend/app/core/rbac.py`) and mirrored into MongoDB at startup purely for querying/auditing — code is always the source of truth.

| Role | Home | Representative permissions |
|---|---|---|
| `super_admin` | `/dashboard/super-admin` | Everything — platform-wide oversight |
| `recruiter` | `/dashboard/recruiter` | `recruitment.*` · `onboarding.manage` · `documents.review` · `offers.manage` · `learning.access` · `ai.access` · `reporting.view` |
| `candidate` | `/dashboard/candidate` | `onboarding.self` · `documents.self` · `offers.self` · `profile.view` |
| `employee` | `/dashboard/employee` | `onboarding.self` · `documents.self` · `offers.self` · `learning.access` · `ai.coach` · `profile.view` |

Recruiters also carry per-module **capabilities** — a finer toggle layer on top of role permissions, letting an org disable one module for one recruiter without touching their role (`CurrentUser.has_capability(...)`).

---

## ◆ Getting started

**Prerequisites:** Node.js (Next.js 16 / React 19 compatible), Python 3.11+, a MongoDB instance. Optional: Redis, Cloudinary/Supabase, an OpenRouter or Gemini key, SMTP credentials.

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

On first boot, the backend automatically: creates MongoDB indexes → migrates legacy employee IDs to `EMP-xxxx` format → seeds RBAC roles/permissions, org taxonomy, universities, and default learning providers → creates a default organization if none exists → hydrates and starts a background refresh of the Coursera catalog cache.

**3 · First login** — run `backend/scripts/seed_super_admin.py` to create your first Super Admin, sign in at `/portal-root-x9f3`, then invite recruiters, who invite candidates through the normal `/login` flow.

---

## ◆ Environment variables

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
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_MAX_TOKENS`, `GEMINI_MODEL` | Optional | Powers the agent + AI Coach; without either key the agent falls back to deterministic replies |
| `REDIS_URL` | ✅ | |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated; first entry also builds email/redirect links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS`, `MAIL_USE_SSL` | ✅ | Gmail app-password spaces are auto-stripped |
| `FRONTEND_URL`, `BACKEND_URL` | ✅ | Builds invite/offer/IT-setup links |
| `ENABLE_OCR`, `OCR_LANG`, `OCR_USE_GPU` | Optional | Document extraction toggles |
| `ENABLE_EMBEDDINGS`, `EMBEDDING_MODEL` | Optional | Phase-3 embeddings prep, off by default |
| `ENABLE_AI_COACH`, `RAG_TOP_K`, `RAG_CANDIDATE_LIMIT`, `RAG_CHUNK_CHARS`, `RAG_CHUNK_OVERLAP`, `RAG_MAX_CONTEXT_CHARS`, `AI_COACH_HISTORY_TURNS`, `AI_COACH_MAX_MESSAGE_CHARS` | Optional | Employee AI Coach RAG tuning |
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

---

## ◆ Database

MongoDB is accessed directly through Motor — no ORM, no schema-migration tool. Pydantic schemas define the API-boundary shape; `app/core/database.py` owns index creation. **70+ collections**, grouped roughly as:

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
| AI agent & knowledge | `agent_conversations` · `ai_coach_messages` · `ai_coach_knowledge_docs` · `kb_chunks` |
| Support & comms | `tickets` · `ticket_replies` · `ticket_activity` · `ticket_audit_logs` · `it_service_requests` · `hr_threads` · `notifications` · `announcements` · `org_email_templates` |
| Ops | `audit_logs` · `counters` · `migrations` · `universities` |

</details>

---

## ◆ Testing & scripts

```bash
cd backend && pytest
```

Covers: agent support-ticket tools, authorization/audit behavior, banking-endpoint security, career-framework logic, JWT token typing, org-wide recruiter access scoping, profile/email flows, provider support, search taxonomy. No automated frontend suite — `npm run lint` (ESLint, Next.js core-web-vitals) is the available static check.

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

---

## ◆ Security notes

- **`JWT_SECRET` is validated at startup** — weak or placeholder values crash the app rather than run insecurely.
- Access tokens are typed (`access` vs `refresh`) to block refresh-token replay as an access token.
- Passwords hashed with `bcrypt` via `passlib`; accounts lock 15 minutes after 5 failed logins.
- Banking/sensitive employee data is Fernet-encrypted at rest.
- Super Admin login sits at an unguessable, unlinked path (`/portal-root-x9f3`) instead of `/admin`.
- CORS currently allows all origins with `allow_credentials=False` (`backend/app/main.py`) — tighten for production deployments handling real user data.
- The AI agent is hard-scoped to the calling user's role and the same permission-checked service layer as the REST API — it cannot access another user's data or bypass RBAC.

---

## ◆ Working conventions

This codebase is developed with heavy AI-agent involvement, so a few habits are load-bearing:

- **Inspect before you change.** Read the existing implementation and follow its patterns before writing anything new.
- **Preserve behavior unless the task says otherwise** — business logic, API contracts, auth/permission checks, and validations stay put unless explicitly asked to change.
- **Stay in scope.** No unrelated refactors, renames, reformatting, or speculative improvements riding along with a focused change.
- **Reuse before you build.** Search for an existing service function, hook, or component before adding a new one.
- **Validate before calling it done** — compile/lint/build/test, whatever applies, and check imports/references after any rename or move.

See **`AGENTS.md`** for the full, tool-level version of this contract used by autonomous coding agents working in this repo.
