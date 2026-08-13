# TalentAI

> A multi-tenant HR operating system covering the complete employee lifecycle — **invite → offer → onboarding → IT provisioning → employee lifecycle → learning → talent/career growth** — with a role-aware AI agent built directly into the permission-checked service layer.

**Stack:** Next.js 16 / React 19 · FastAPI (async) · Motor / MongoDB · JWT + RBAC · OpenRouter / Gemini · Cloudinary

---

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [User Roles](#user-roles)
- [The AI Agent Layer](#the-ai-agent-layer)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Domain Module Map](#domain-module-map)
- [Authentication & Authorization](#authentication--authorization)
- [Multi-Tenancy](#multi-tenancy)
- [Database](#database)
- [Integrations](#integrations)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing & Validation](#testing--validation)
- [Security](#security)
- [Design Decisions](#design-decisions)
- [Working Conventions](#working-conventions)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Overview

Most HR systems separate their user-facing forms from any conversational layer, which forces the AI on top to duplicate business logic. **TalentAI is built the other way around**: the same permission-checked service layer that powers every dashboard button also powers the in-app AI agent, so a request like *"send Sarah's offer and extend it 3 days"* executes through the exact code path a button click would. There is no shadow logic, no parallel rule set, and no second backend for the conversational interface.

The platform is organized around four roles — Super Admin, Recruiter, Candidate, Employee — each with its own dashboard, its own permission set, and its own AI persona scoped to what that role is allowed to see and do.

### Core Business Purpose

- Run hiring and onboarding for an organization (recruiter)
- Capture candidate data and documents with OCR assistance
- Provision IT accounts/assets via public token links
- Graduate candidates into employees without re-entry
- Develop people via learning catalogs, skill gaps, career frameworks, internal opportunities
- Operate multiple tenant organizations from a hidden Super Admin portal

### Hiring Lifecycle

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

Cross-cutting flows: Document OCR → profile fields → recruitment verification · Organization Framework ↔ Learning course sync · Agent tools → same services as the UI. Each stage is reachable through the UI **or** through natural language.

---

## Core Capabilities

| Area | Description |
|------|-------------|
| **Recruit** | Invite candidates individually or via bulk spreadsheet import, track the full pipeline, and manage the offer lifecycle — generation, digital signature, configurable expiry, extensions (≤3 negotiation rounds), and reminders. |
| **Onboard** | Multi-step candidate wizard with autosave and AI-assisted form filling, document upload with OCR field extraction (resumes, IDs, bank slips), and a recruiter-facing verification queue. |
| **Provision** | IT equipment and account-provisioning kits fire automatically once a candidate is hired, with single and batch public-token provisioning links and a dedicated IT service-request flow. |
| **Employ** | Candidates transition cleanly into full employee profiles (new `EMP-######` ID) with a company email, personalized dashboard, and directory entry — without re-entering onboarding data. |
| **Develop** | Learning recommendations from a live Coursera + Microsoft Learn catalog sync, skill-gap detection against role requirements, certificate tracking, career tracks/levels, and per-organization promotion readiness. |
| **Support** | IT and HR tickets with full activity/audit trails, plus internal messaging between employees/candidates and recruiters. |
| **Administer** | Super Admin manages every tenant organization and recruiter account, and views platform-wide health, from a hidden login route not exposed in the public UI. |

---

## User Roles

TalentAI defines four roles in code (`backend/app/core/rbac.py`). The `roles`/`permissions` MongoDB collections are a seeded mirror for querying — **code is always the source of truth**.

| Role | Home Dashboard | Purpose |
|------|----------------|---------|
| `super_admin` | `/dashboard/super-admin` | Platform orgs, recruiters, admin tickets. Logs in at the deliberately hidden `/portal-root-x9f3`. |
| `recruiter` | `/dashboard/recruiter` | Hiring, employees, IT, learning admin, org config, talent. Gated by per-module capabilities. |
| `candidate` | `/dashboard/candidate` | Offer, onboarding, documents, messages. |
| `employee` | `/dashboard/employee` | Profile, learning, career, talent, IT support, messages. |

### Recruiter Capabilities

Recruiters carry a second, finer-grained permission layer: **per-module capabilities**. An organization can disable a module for a specific recruiter without changing their base role.

**Org module keys:** `overview`, `candidates`, `invite`, `employees`, `talent`, `learning`, `org_config`, `assistant`, `messages`, `announcements`, `it`, `reporting`, `profile`, `support`

```
effective capability = organization.modules ∩ recruiter.capabilities
```

---

## The AI Agent Layer

TalentAI ships with an in-app conversational agent that executes real business operations through the same permission-checked service layer as the REST API. It is not a support chatbot layered on top — it is a first-class product interface.

### Agent Loop (`backend/app/services/agent_service.py`)

1. **Build prompt** — role system prompt + shared cross-role rules + tool catalog + fresh state snapshot + recent conversation history (last 8 turns) + the new user message.
2. **Ask the LLM** — OpenRouter primary, Gemini fallback. The model must return **strict JSON** (`call_llm_json` in `llm_service.py`): one tool call, or a final reply.
3. **Execute** — against real, permission-checked service functions. Never a shortcut path or direct DB read.
4. **Observe & loop** — the tool result feeds back as an observation, bounded at `MAX_TOOL_STEPS = 4` so the agent cannot wander.
5. **Persist** — the turn is saved to `agent_conversations`; the reply and light UI hints are returned.

### Graceful Degradation

If no LLM key is configured, `_fallback_reply` in `agent_service.py` still answers status-style questions deterministically. This is a hard degrade-gracefully requirement — the agent must not crash the dashboard when the LLM is unavailable.

### Tool Files (Intentional Split — Do Not Merge)

| File | Purpose |
|------|---------|
| `agent_tools.py` | Core tools, `SELF_SERVE_TOOLS`, `RECRUITER_TOOLS` base, role list assembly |
| `agent_tools_parity.py` | Dashboard-parity extras — brings the agent to full feature parity with the UI (deliberate module split, not duplication) |
| `agent_tools_super_admin.py` | Platform-level tools for the Super Admin persona (lazy-loaded) |

### Read-Only Tool Tracking

Read-only tools are tracked in `READONLY_TOOLS` (`agent_service.py`) so the agent does not waste a step re-fetching the same state mid-turn. Any new read-only tool **must** be added to this set.

Current set: `get_status`, `get_my_offer`, `get_my_profile`, `list_documents`, `list_candidate_documents`, `list_person_documents`, `list_candidates`, `list_employees`, `get_candidate_status`, `get_employee_detail`, `get_dashboard_summary`, `my_learning_dashboard`, `list_opportunities`, `list_my_announcements`, `list_notifications`, `list_hr_threads`, `get_my_day1_info`.

### Agent Rules (Do Not Weaken)

- No raw routes/paths in prose (`/offer`, `offer_page=`, "open page offer") — navigation travels via UI hints/buttons.
- Never expose passwords or OTPs.
- Confirm before destructive/irreversible tools (`needs_confirm` gate).
- Do not re-call the same read-only tool twice in one turn.

### Frontend AI Surfaces

| Surface | Path | Role |
|---------|------|------|
| Context / insights builders | `frontend/lib/ai/*Context.js`, `*Insights.js`, field help, OCR helpers | Feed the floating orb / guide UX |
| AI experience components | `frontend/components/ai-experience/` (AiOrb, confirm cards, OCR overlays) | In-page UX chrome |
| Full agent chat | `components/ai/AgentChatCore.js` + per-role `ai-assistant` pages | Calls `/api/agent/*` via `agentService.js` |
| Recruiter mascot brief | Recruiter overview dashboard | `POST /api/dashboard/recruiter-mascot/brief` |

> **Mascot ≠ Hiring Agent.** The floating mascot produces tips/insights/OCR chrome and short LLM briefs — it is not the tool-calling agent. Do not route mascot calls through the agent tool loop.

**What distinguishes this from a support chatbot:** every tool call passes through the same RBAC dependency chain a REST request would. The agent cannot see another organization's data, act outside its role's permission set, or be prompted into bypassing a check the UI itself could not bypass.

---

## System Architecture

### Request Lifecycle

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

1. Browser hits a Next route. `frontend/proxy.js` redirects to `/login` if no `access_token` cookie and the path is not public.
2. Client code stores JWTs in **localStorage** and mirrors `access_token` into a cookie for the proxy.
3. `lib/apiClient.js` attaches `Authorization: Bearer <access_token>`; on 401 it posts `/api/auth/refresh`.
4. FastAPI `get_current_user` rejects non-`access` tokens, resolves profile + role, and loads org modules ∩ recruiter capabilities.
5. Router dependency (`RequireRecruiter`, local capability deps, etc.) may deny — audited where wired.
6. Service runs Mongo queries scoped by `organization_id` / `recruiter_people_scope` as appropriate.
7. Response shape must match what the corresponding `frontend/services/*.js` caller expects.

### Layer Rules (Hard)

| Layer | Path | Responsibility |
|-------|------|----------------|
| **Routers** | `backend/app/api/` | Parse request → auth dependency → call one service → return. No business `if` that decides outcomes. |
| **Services** | `backend/app/services/` | All business logic, DB access, emails, notifications. |
| **Schemas** | `backend/app/schemas/` | Pydantic request/response contracts. Frontend has **no** shared codegen — contract drift fails at runtime, not build time. |
| **Core** | `backend/app/core/` | `config` (env), `database` (Mongo/Supabase + indexes), `security` (JWT + shared auth deps), `rbac` (source of truth), `crypto` (Fernet). |
| **Frontend pages** | `frontend/app/dashboard/{role}/` | Call `services/*.js` only — never inline `fetch`/`axios` for backend APIs. |
| **Agent tools** | `backend/app/services/agent_tools*.py` | Call services (same as REST) — never shortcut DB reads that bypass RBAC. |

### Forbidden Shortcuts

- Router → raw Mongo business logic
- Agent tool → `collection.find` without service RBAC
- Frontend page → axios to backend bypassing `services/` (for domain APIs)
- Cross-org queries without Super Admin intent

### Dependency Direction (Allowed)

```
api → services → (database | crypto | email | storage | llm)
frontend pages → services/*.js → apiClient → api
lib/ai (UX) ↛ agent_tools   (context only; chat uses the agent API)
```

---

## Technology Stack

### Frontend

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | CSS Modules + Tailwind v4 (PostCSS plugin) |
| Animation | framer-motion |
| Icons | lucide-react |
| HTTP Client | axios |
| Notifications | react-toastify |
| Spreadsheets | xlsx (bulk invite import/export) |
| Session | Cookie-based, enforced by `proxy.js` middleware |

### Backend

| Component | Technology |
|-----------|-----------|
| Framework | FastAPI (async) on Uvicorn |
| Database | MongoDB via Motor (async driver) — no ORM abstraction |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Validation | Pydantic (request/response contracts) |
| LLM | OpenRouter (primary) + Gemini (fallback) via `llm_service` |
| Storage | Cloudinary (primary) + optional Supabase |
| Email | SMTP HTML via `email_service` + org-overridable templates |
| Document Intelligence | PyMuPDF, python-docx, EasyOCR, Pytesseract, openpyxl — all lazy-imported |
| Rate Limiting | slowapi |

### Infrastructure

| Component | Technology |
|-----------|-----------|
| Containerization | Docker Compose (`docker-compose.yml` + `docker-compose.prod.yml`) |
| Services | MongoDB 7, Redis (config-only), OmniRoute (LLM gateway), backend, frontend |
| Gateway | Optional nginx reverse proxy |

---

## Repository Structure

```
TalentAI/
├── AGENTS.md                         # Short agent field guide (workspace rule)
├── README.md                         # This file — product/architecture overview
├── .agents/                          # AI engineering knowledge layer
│   ├── AGENTS.md                     # Master instructions for coding agents
│   ├── architecture/                 # Cross-cutting architecture docs
│   │   ├── system-overview.md        # Layers, request lifecycle, module map
│   │   ├── backend.md                # main.py, lifespan, core spine
│   │   ├── frontend.md               # App Router, proxy, hooks, services
│   │   ├── api.md                    # Full router inventory
│   │   ├── authentication.md         # JWT typing, OTP, lockout, dual-role
│   │   ├── authorization.md          # RBAC, capabilities, audit
│   │   ├── database.md               # Collections, indexes, encryption
│   │   ├── ai.md                     # Agent loop, tool split, fallbacks
│   │   ├── integrations.md           # SMTP, Cloudinary, LLM, catalogs
│   │   ├── multi-tenancy.md          # organization_id, scopes, purge
│   │   └── dependency-map.md         # Cross-module wiring
│   └── skills/                       # Fine-grained module skills (load per task)
│       └── README.md                 # Skill index / navigation
├── backend/
│   ├── app/
│   │   ├── main.py                   # App factory, CORS, lifespan seeds, router mount
│   │   ├── api/                      # Thin routers (one per domain)
│   │   │   ├── auth.py               # /api/auth
│   │   │   ├── invitations.py        # /api/invitations
│   │   │   ├── offers.py             # /api/offers
│   │   │   ├── onboarding.py         # /api/onboarding
│   │   │   ├── employees.py          # /api/employees
│   │   │   ├── documents.py          # /api/documents
│   │   │   ├── learning.py           # /api/learning
│   │   │   ├── talent.py             # /api/talent
│   │   │   ├── career_framework.py   # /api/career-framework
│   │   │   ├── organization_framework.py # /api/org-framework
│   │   │   ├── it_provisioning.py    # /api/it-provisioning
│   │   │   ├── it_service_requests.py # /api/it-service-requests
│   │   │   ├── messages.py           # /api/messages
│   │   │   ├── dashboard.py          # /api/dashboard/*, notifications, search, announcements
│   │   │   ├── agent.py              # /api/agent
│   │   │   ├── tickets.py            # /api/tickets (recruiter support)
│   │   │   ├── admin_tickets.py      # /api/admin/tickets (super admin)
│   │   │   ├── super_admin.py        # /api/super-admin
│   │   │   ├── email_templates.py    # /api/email-templates
│   │   │   ├── rbac.py               # /api/rbac (me, catalog)
│   │   │   └── universities.py       # /api/universities/search
│   │   ├── core/                     # Application spine
│   │   │   ├── config.py             # Pydantic Settings, JWT validation, link builders
│   │   │   ├── database.py           # Motor client, _ensure_index, create_database_indexes
│   │   │   ├── security.py           # Password hash, JWT, get_current_user, Require* aliases
│   │   │   ├── rbac.py               # PERMISSIONS, ROLE_PERMISSIONS, ROLE_HOME, CurrentUser
│   │   │   ├── rbac_seed.py          # Seed Mongo mirror at startup
│   │   │   └── crypto.py             # Fernet encrypt/decrypt for sensitive fields
│   │   ├── schemas/                  # Pydantic request/response contracts (one per domain)
│   │   ├── services/                 # All business logic
│   │   │   ├── agent_service.py      # Agent loop, READONLY_TOOLS, fallback reply
│   │   │   ├── agent_tools.py        # Core tools + role list assembly
│   │   │   ├── agent_tools_parity.py # Dashboard-parity tools (intentional split)
│   │   │   ├── agent_tools_super_admin.py # Platform-level tools
│   │   │   ├── auth_service.py       # Login, OTP, lockout, refresh
│   │   │   ├── invitation_service.py # Invites + required offer
│   │   │   ├── offer_service.py      # Offer lifecycle, negotiation, signing
│   │   │   ├── employee_service.py   # Convert/activate, complete profile, banking
│   │   │   ├── document_service.py   # Uploads, verify, signed downloads
│   │   │   ├── learning_service.py   # Large learning domain
│   │   │   ├── learning_ai_service.py# Course ranking, skill gaps, readiness
│   │   │   ├── talent_service.py     # Deterministic talent domain
│   │   │   ├── career_framework_service.py
│   │   │   ├── organization_framework_service.py
│   │   │   ├── organization_service.py # Org modules, recruiter_scope helpers
│   │   │   ├── it_provisioning_service.py
│   │   │   ├── it_service_requests_service.py
│   │   │   ├── message_service.py    # hr_threads
│   │   │   ├── dashboard_service.py
│   │   │   ├── ticket_service.py
│   │   │   ├── email_service.py      # SMTP + templates
│   │   │   ├── storage_service.py    # Cloudinary
│   │   │   ├── llm_service.py        # call_llm_json, OpenRouter→Gemini
│   │   │   ├── ocr_service.py        # Lazy OCR (ENABLE_OCR)
│   │   │   ├── document_extraction_service.py
│   │   │   ├── embedding_service.py  # Lazy embeddings (ENABLE_EMBEDDINGS)
│   │   │   ├── coursera_service.py   # Live catalog + cache
│   │   │   ├── ms_learn_service.py   # Live catalog + cache
│   │   │   ├── recruiter_mascot_service.py
│   │   │   ├── reminder_service.py   # Throttled nudges
│   │   │   └── ...
│   │   └── static/
│   ├── scripts/                      # Seeds, backfills, smoke tests (manual)
│   │   ├── seed_super_admin.py       # Bootstrap first Super Admin
│   │   ├── backfill_dual_role_recruiters.py
│   │   ├── reconcile_dual_role_profiles.py
│   │   ├── verify_dual_role.py
│   │   ├── backfill_org_scoping.py
│   │   ├── backfill_organization_tenancy.py
│   │   ├── migrate_providers.py
│   │   ├── check_career_data.py
│   │   └── test_api_endpoints.py     # Manual e2e checks (not pytest-collected)
│   ├── tests/                        # pytest suite
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/                          # Next.js App Router pages
│   │   ├── login/page.js
│   │   ├── register/page.js
│   │   ├── forgot-password/page.js
│   │   ├── reset-password/page.js
│   │   ├── invite/[token]/page.js    # Accept invite / register
│   │   ├── onboarding/page.js        # Candidate wizard
│   │   ├── offer/page.js             # Offer viewing/signing
│   │   ├── documents/page.js         # Standalone document flow
│   │   ├── it-setup/[token]/page.js  # IT provisioning intake
│   │   ├── it-setup/batch/[token]/page.js
│   │   ├── it-support/[token]/page.js
│   │   ├── portal-root-x9f3/page.js  # Hidden Super Admin login
│   │   ├── dashboard/
│   │   │   ├── recruiter/            # Recruiter dashboard pages
│   │   │   ├── candidate/            # Candidate dashboard pages
│   │   │   ├── employee/             # Employee dashboard pages
│   │   │   └── super-admin/          # Super Admin dashboard pages
│   │   └── ...
│   ├── components/                    # React components
│   │   ├── recruiter/                 # RecruiterShell etc.
│   │   ├── employee/                  # EmployeeShell etc.
│   │   ├── candidate/                 # CandidateShell etc.
│   │   ├── super-admin/               # SuperAdminShell etc.
│   │   ├── shared/shell/              # Cross-role chrome + CSS Modules (composes:)
│   │   ├── ai/                        # AgentChatCore, AssistantPageShell
│   │   ├── ai-experience/             # AiOrb, confirm cards, OCR overlays
│   │   ├── onboarding/                # Wizard steps
│   │   ├── offers/                    # Offer letter components
│   │   ├── documents/                 # DocumentManager
│   │   ├── learning/                  # Learning UI
│   │   ├── talent/                    # Talent management UI
│   │   ├── it/                        # IT provisioning UI
│   │   └── ui/                        # Generic primitives
│   ├── services/                      # API wrapper modules — the only layer that calls the backend
│   │   ├── authService.js
│   │   ├── invitationService.js
│   │   ├── offerService.js
│   │   ├── employeeService.js
│   │   ├── documentService.js
│   │   ├── learningService.js
│   │   ├── talentService.js
│   │   ├── careerService.js
│   │   ├── orgFrameworkService.js
│   │   ├── messageService.js
│   │   ├── agentService.js
│   │   ├── ticketService.js
│   │   ├── rbac.js
│   │   └── ...
│   ├── hooks/                         # Shared React hooks (edit once, not per shell)
│   │   ├── useUserSession.js
│   │   ├── useSidebarCollapse.js
│   │   ├── useNotificationsCenter.js
│   │   ├── useLogout.js
│   │   ├── useRoleSwitch.js
│   │   ├── useGlobalSearch.js
│   │   ├── useDocumentProcessing.js
│   │   ├── useOrgFrameworkOptions.js
│   │   └── useTalentIntelligenceData.js
│   ├── lib/                           # Utilities + AI context builders
│   │   ├── apiClient.js               # Axios instance, Bearer, refresh on 401
│   │   ├── formFeedback.js            # FieldError helpers
│   │   └── ai/                        # Per-role context/insight builders
│   ├── utils/                         # Nav configs, validation helpers
│   │   ├── recruiterNav.js            # Capability-filtered
│   │   ├── employeeNav.js
│   │   ├── candidateNav.js
│   │   └── ...
│   ├── proxy.js                       # Auth cookie gate (Next middleware)
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docker-compose.yml                 # Local development
├── docker-compose.prod.yml            # Production overlay
├── nginx/
│   └── nginx.conf                     # Reverse proxy config
└── .env.docker.example                # Docker env template
```

### Notable Frontend Routes

| Path | Purpose |
|------|---------|
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

## Domain Module Map

| Domain | Backend Router | Backend Service(s) | Frontend Pages |
|--------|----------------|--------------------|----------------|
| Auth / Session | `api/auth.py` | `auth_service.py` | `/login`, `/register`, verify/reset |
| Invitations | `api/invitations.py` | `invitation_service.py`, `bulk_invite_service.py` | `/dashboard/recruiter/invite`, `/invite/[token]` |
| Offers | `api/offers.py` | `offer_service.py` | `/offer`, recruiter invite/candidates |
| Onboarding | `api/onboarding.py` | `candidate_service.py`, `employee_service.py` | `/onboarding`, candidate/employee profile |
| Documents / OCR | `api/documents.py` | `document_service.py`, `ocr_service.py`, `document_extraction_service.py` | `/documents`, DocumentManager |
| Employees | `api/employees.py` | `employee_service.py` | `/dashboard/recruiter/employees` |
| IT Provisioning | `api/it_provisioning.py` | `it_provisioning_service.py` | `/it-setup/[token]`, recruiter IT pages |
| IT Service Requests | `api/it_service_requests.py` | `it_service_requests_service.py` | `/it-support/[token]` |
| Learning | `api/learning.py` | `learning_service.py`, `learning_ai_service.py` | Recruiter/employee learning pages |
| Organization Framework | `api/organization_framework.py` | `organization_framework_service.py` | `/dashboard/recruiter/organization-config` |
| Career Framework | `api/career_framework.py` | `career_framework_service.py` | Employee career, talent readiness |
| Talent | `api/talent.py` | `talent_service.py` (deterministic; no LLM) | Recruiter/employee talent pages |
| Messages | `api/messages.py` | `message_service.py` | Recruiter/employee messages |
| Dashboard / Notifications | `api/dashboard.py` | `dashboard_service.py` | Overview, announcements, search |
| AI Agent | `api/agent.py` | `agent_service.py`, `agent_tools*.py` | `*/ai-assistant` pages |
| Tickets | `api/tickets.py`, `api/admin_tickets.py` | `ticket_service.py` | Recruiter support; super-admin tickets |
| Super Admin | `api/super_admin.py` | `organization_service.py` | Orgs, recruiter caps |
| Universities | `api/universities.py` | — | Onboarding education autocomplete |

---

## Authentication & Authorization

### JWT Token System

Authentication uses **typed** JWT tokens.

| Token Type | Claim `type` | Use |
|-----------|--------------|-----|
| Access | `"access"` | API `Authorization: Bearer` header |
| Refresh | `"refresh"` | `POST /api/auth/refresh` only |

`get_current_user` **rejects** any JWT whose `type != "access"`. This check must be preserved when touching verification code — a refresh token must never be accepted where an access token is expected.

### Session Flow (Frontend)

1. On login/verify/switch: store `access_token`, `refresh_token`, `token_expires_at`, `user` in **localStorage**.
2. Mirror `access_token` into `document.cookie` so `proxy.js` can gate routes.
3. API calls use Bearer from localStorage; 401 → `/api/auth/refresh`.
4. Logout clears localStorage **and** cookies (`max-age=0`).

### Auth Endpoints (`/api/auth`)

| Flow | Endpoints | Notes |
|------|-----------|-------|
| Signup | `POST /register`, `/candidate/register`, `/recruiter/register` | Pending user + SMTP OTP |
| Verify | `POST /verify-otp`, `/verify-email` | Activates account, returns session |
| Resend | `/resend-otp`, `/resend-verification` | Cooldown: `OTP_RESEND_COOLDOWN_SECONDS` |
| Login | `POST /login` | Password; optional `remember_me` → refresh 30d vs 7d |
| Refresh | `POST /refresh` | Rotates access (+ refresh as implemented) |
| Password | `/forgot-password`, `/reset-password`, `/change-password` | 6-digit code path for forgot |
| Logout | `POST /logout` | Revokes refresh tokens |
| Bootstrap | `POST /bootstrap-super-admin` | First super admin only, OTP-gated |
| Switch Role | `POST /switch-role` | Dual-role recruiter↔employee; rotates refresh tokens |

### Lockout Policy

- **5 failed attempts** → **15-minute lockout**
- Counter keyed by canonical email in `login_attempts` collection
- Company email and personal email can map to the same employee account; lockout uses the canonical identity
- Forgot-password OTP is the unlock/reset path

### Public Token Routes (No JWT)

These bypass login but use unguessable, capability-equivalent tokens:

| Backend | Frontend | Purpose |
|---------|----------|---------|
| `GET /api/invitations/{token}` | `/invite/[token]` | Accept invite / register |
| `GET|POST /api/it-provisioning/{token}`, `/batch/{token}` | `/it-setup/...` | IT assigns email/assets |
| `GET|POST /api/it-service-requests/public/{token}` | `/it-support/[token]` | IT fulfills employee request |

The frontend public allowlist lives in `proxy.js` `PUBLIC_PATHS` (`/invite`, `/it-setup`, `/it-support`, `/offer`, `/onboarding`, `/documents`, `/portal-root-x9f3`, etc.). Any new **public** top-level route must be listed there or it will incorrectly force a login redirect.

### Super Admin Login

The Super Admin login UI is at **`/portal-root-x9f3`** — deliberately unguessable and unlinked from public UI. Never link to it from public pages, and never rename it to something guessable without explicit request.

### RBAC Permission Model (`backend/app/core/rbac.py`)

| Permission Code | Intent |
|----------------|--------|
| `recruitment.view` | View recruitment modules |
| `recruitment.invite` | Create invitations |
| `onboarding.self` | Complete personal onboarding |
| `onboarding.manage` | Manage candidate onboarding |
| `documents.self` | Own documents |
| `documents.review` | Verify others' documents |
| `offers.self` | View/sign own offer |
| `offers.manage` | Create/send/approve offers |
| `learning.access` | Learning modules |
| `ai.access` | AI modules (recruiter-facing) |
| `ai.coach` | AI Coach (employee) |
| `reporting.view` | Reporting |
| `profile.view` | Profile |
| `admin.access` | Platform administration |

### Role → Permission Mapping

| Role | Permissions |
|------|-------------|
| `super_admin` | All (`ALL_PERMISSIONS`) |
| `recruiter` | `recruitment.*`, `onboarding.manage`, `documents.review`, `offers.manage`, `learning.access`, `ai.access`, `reporting.view`, `profile.view` |
| `candidate` | `onboarding.self`, `documents.self`, `offers.self`, `profile.view` |
| `employee` | `onboarding.self`, `documents.self`, `offers.self`, `learning.access`, `ai.coach`, `profile.view` |

### Shared Auth Dependencies (`backend/app/core/security.py`)

Import these — never redeclare the same check locally:

| Alias | Behavior |
|-------|----------|
| `RequireUser` | Any authenticated user |
| `RequireRecruiter` | `recruiter` or `super_admin` |
| `RequireEmployee` | `employee` or `super_admin` |
| `RequireAny` | `employee` or `recruiter` or `super_admin` |
| `RequireOnboardingSelf` | Permission `onboarding.self` |

**Critical pattern:** `require_capabilities(...)` alone does **not** block candidates/employees (it early-returns for non-recruiters). Always pair capability checks with `require_roles("recruiter", "super_admin")` or use a combined `Annotated` type (e.g. `RequireRecruiterWithInvite` in `offers.py`).

### RequireCandidate Naming Gotcha

Two routers define dependencies with similar names but **different predicates** — never assume they are interchangeable:

| Location | Definition | Meaning |
|----------|------------|---------|
| `api/offers.py` | `Depends(require_roles("candidate", "super_admin"))` | Role gate for offer self-service |
| `api/employees.py` | `RequireOnboardingSelf as RequireCandidate` → `require_permissions("onboarding.self")` | Permission gate for onboarding/profile self endpoints |

Prefer the explicit name `RequireOnboardingSelf` for new code.

### Audit on Deny

`_audit_denied(user, permission, detail)` in `security.py` records denied access attempts. Denied permission/capability failures and recruiter actions write to `audit_logs`. Do not remove audit calls when adjusting dependencies.

---

## Multi-Tenancy

Organizations are the tenant boundary. All tenant data carries `organization_id`.

### Tenant Field Rules

- Present on people + ops records: recruiters, candidates, employees, invitations, tickets, learning courses, career/org-framework documents, announcements, etc.
- Indexed in `create_database_indexes()` for hot collections.
- `CurrentUser.organization_id` / `organization_name` populated in `get_current_user` for recruiter/employee/candidate.

**Rule:** any new list/search aggregation over tenant data **must** scope by organization (or a people-scope helper). A missing tenant filter is treated as a critical security bug — it is the easiest way to leak one org's data into another's dashboard.

### Tenant Scope Helpers (`organization_service.py`)

| Helper | Filter Behavior |
|--------|-----------------|
| `recruiter_scope(user)` | `super_admin` → all; recruiter with org → org filter; recruiter without org → personal ownership |
| `recruiter_people_scope(user)` | Org-wide people query **including legacy rows missing `organization_id`** but owned by a recruiter in the same org (`$or: [org_clause, legacy_owner_clause]`) |
| `recruiter_can_access` | Same-org or personal ownership |
| `recruiter_can_access_record` | Plus legacy same-org owners |
| `organization_record_scope` | Optional legacy owner field |

Prefer these helpers over hand-rolled `$or` copies.

### Purge

`purge_organization(organization_id)` is a destructive, irreversible wipe of a tenant's data (people, auth users, offers, IT, learning, documents, agent conversations, audit logs, org-framework docs, etc.). Exposed via Super Admin delete flows; agent tools must confirm before invoking.

### What Is Not Tenant-Scoped

Global/shared data: `universities` (seeded catalog), `super_admins`, some learning provider catalog caches, platform RBAC seed collections. Do not put org secrets into global collections without an org key.

---

## Database

MongoDB is accessed directly through Motor — no ORM, no schema-migration tool. There is **no in-memory/mock DB mode** — a live `MONGODB_URI` + `DATABASE_NAME` are required for boot.

### Key Collections (65+ Total)

| Group | Collections |
|-------|------------|
| **Identity & Access** | `users`, `recruiters`, `candidates`, `employees`, `super_admins`, `pending_users`, `organizations`, `roles`, `permissions`, `refresh_tokens`, `login_attempts`, `otp_verifications`, `company_email_password_otps`, `invitations` |
| **Hiring & Onboarding** | `offer_letters`, `documents`, `it_provisioning_batches`, `it_provisioning_requests`, `it_kits`, `audit_logs` |
| **Learning** | `learning_courses`, `learning_enrollments`, `learning_assignments`, `learning_certificates`, `learning_skill_gaps`, `learning_skill_assessments`, `learning_ai_recommendations`, `learning_catalog_cache`, `learning_providers`, `learning_role_matches`, `learning_career_goals`, `learning_bookmarks`, `learning_import_history`, `learning_recruiter_profile_cache`, `employee_skills` |
| **Career & Org Framework** | `career_tracks`, `career_levels`, `employee_career_assignments`, `employee_career_events`, `org_framework_departments`, `org_framework_roles`, `org_framework_skills`, `org_framework_courses`, `org_framework_certifications`, `org_framework_promotion_rules`, `org_framework_roadmaps`, `org_framework_versions`, `org_taxonomy` |
| **Talent Management** | `talent_competency_evaluations`, `talent_development_plans`, `internal_opportunities`, `internal_opportunity_applications` |
| **AI Agent** | `agent_conversations` |
| **Support & Comms** | `tickets`, `ticket_replies`, `ticket_activity`, `ticket_audit_logs`, `it_service_requests`, `hr_threads`, `notifications`, `announcements`, `org_email_templates` |
| **Ops** | `audit_logs`, `counters`, `migrations`, `universities` |

### Encryption at Rest

Sensitive fields (banking account numbers, IBANs, SWIFT codes, IT temp passwords, provider API secrets) are **Fernet-encrypted** using `BANKING_ENCRYPTION_KEY`, or deterministically derived from `SECRET_KEY` if unset.

- IBAN uniqueness is enforced via `iban_hash` (SHA-256 fingerprint), indexed at `employees.onboarding.employment.iban_hash`.
- Never log, print, or return decrypted banking fields outside designated decrypt/mask paths.

### Index Management

All indexes are created via `_ensure_index()` inside `create_database_indexes()` (`app/core/database.py`). The helper ignores benign Atlas race/conflict error codes (68, 85, 86, 276). Never use a raw `create_index` call — it can abort startup. New collections with tenant data must index + filter by `organization_id`.

### DNS Shim

`mongodb+srv://` connections automatically swap in public DNS resolvers (8.8.8.8 / 1.1.1.1) because some networks block SRV lookups. If Mongo connections mysteriously hang locally, this is often why — do not remove the shim.

---

## Integrations

### SMTP (Email)

Settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS`, `MAIL_USE_SSL`, `EMAIL_LOGO_URL`

- Services: `email_service.py` + `email_template_service.py`; org-overridable templates in `org_email_templates`.
- Used for: OTP, invites, offers, IT links, notifications, password reset, reminders.
- Password validator strips spaces (Gmail app-password paste quirk).
- Link builders on `settings`: `invitation_link`, `it_provisioning_link`, `it_provisioning_batch_link`, `it_service_request_link` (use `FRONTEND_URL`).

### Cloudinary (Primary File Storage)

Settings: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` (default `talent`)

- Service: `storage_service.py` — uploads, signed URLs (`SIGNED_URL_EXPIRE_SECONDS`), document/photo assets.
- Used by: documents, offer signatures, profile photos, ticket attachments, certificates.

### LLM (OpenRouter / OmniRoute / Gemini)

| Setting | Role |
|---------|------|
| `OPENROUTER_API_KEY` | Bearer for primary OpenAI-compatible endpoint |
| `OPENROUTER_BASE_URL` | Default OpenRouter URL; Docker Compose points at OmniRoute (`http://omniroute:20128/v1/chat/completions`) |
| `OPENROUTER_MODEL` | e.g. `openrouter/free` |
| `OPENROUTER_MAX_TOKENS` | Default 4096; 402 handling may lower |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_BASE_URL` | Fallback provider |

- Client: `llm_service.py`. `call_llm_json(prompt)` parses/salvages strict JSON; used by the agent, learning AI, and mascot brief.
- `llm_configured()` — true if either key present.

### Coursera

- Service: `coursera_service.py` — live catalog from `https://api.coursera.org/api/courses.v1`.
- In-process + Mongo-persisted cache (`learning_catalog_cache`).
- Lifespan: load persisted cache when not `DEBUG`; `start_background_refresh` / stop on shutdown.

### Microsoft Learn

- Service: `ms_learn_service.py` — `https://learn.microsoft.com/api/catalog/`.
- In-process cache TTL ~6 hours; employee "open on MS Learn" redirects to learn.microsoft.com.
- Mirrors the Coursera service shape for catalog search.

### Redis (Config-Only)

- `REDIS_URL` is required by Settings validation.
- The backend has **no Redis client usage today** — the service is kept so the env resolves in containers.
- Do not assume caching/queues on Redis unless a real client is added and documented.

### Supabase (Optional)

Settings: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET`

- Client created in `database.py` only when URL + key are set.
- Legacy/alternate storage path; Cloudinary is the primary upload path.

### OCR / Embeddings

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_OCR` | `True` | Document extraction (PyMuPDF, python-docx, EasyOCR, Pytesseract) |
| `ENABLE_EMBEDDINGS` | `False` | Resume embeddings (BGE model) |
| `ENABLE_AI_COACH` | `True` | Legacy AI Coach settings still present |

Heavy libraries are **lazy-imported** — keep boot safe when packages are missing. Never turn a lazy import into a hard top-level import.

---

## Getting Started

### Prerequisites

- Node.js (compatible with Next.js 16 / React 19)
- Python 3.11+
- A live MongoDB instance (required — no mock mode)
- Optional: Redis, Cloudinary or Supabase account, OpenRouter or Gemini API key, SMTP credentials

### 1 · Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env        # fill in — see Environment Variables below
uvicorn app.main:app --reload --port 8000
```

**Hard gotcha:** `app/core/config.py` validates `JWT_SECRET` at import time. Under 32 characters, or a known placeholder (`secret`, `changeme`, `test`, `password`, …), the app **raises and crashes on boot**. Generate a real one:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 2 · Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

### 3 · First Login

Run `backend/scripts/seed_super_admin.py` to create the first Super Admin account, sign in at `/portal-root-x9f3`, then invite recruiters, who in turn invite candidates through the normal `/login` flow.

### 4 · Docker (Alternative)

```bash
# Start all services
docker compose up --build

# Seed first super admin
docker compose exec backend python -m scripts.seed_super_admin
```

Docker Compose services:

| Service | Port | Purpose |
|---------|------|---------|
| `mongo` | 27017 | MongoDB 7 |
| `redis` | 6379 | Satisfies `REDIS_URL` |
| `omniroute` | 20128 | Local LLM gateway |
| `backend` | 8000 | FastAPI |
| `frontend` | 3000 | Next.js |

Production overlay: `docker-compose.prod.yml`. Optional nginx gateway: `nginx/nginx.conf`.

### 5 · Startup Seeding (Backend Lifespan)

On every boot, the backend automatically runs, in order:

1. Creates MongoDB indexes.
2. Migrates legacy employee IDs to the `EMP-xxxx` format.
3. Seeds RBAC roles/permissions, org taxonomy, and universities reference data.
4. Seeds default learning providers.
5. Creates a default organization if none exists yet.
6. Hydrates and starts a background refresh loop for the Coursera catalog cache (non-DEBUG).

---

## Environment Variables

Documented for reference — **never commit real secret values**. Secrets belong in local, git-ignored `.env` files. Root `.env` is for Docker Compose overrides only.

### Backend — `backend/.env`

| Variable | Required | Notes |
|----------|----------|-------|
| `SECRET_KEY`, `JWT_SECRET` | Yes | `JWT_SECRET` validated at startup — under 32 chars or a known placeholder crashes boot |
| `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE`, `JWT_EXPIRE_MINUTES` | Yes | Token config |
| `MONGODB_URI`, `DATABASE_NAME` | Yes | Supports `mongodb+srv://`; auto-switches to public DNS (8.8.8.8 / 1.1.1.1) for SRV lookups |
| `REDIS_URL` | Yes | Required by Settings; no client usage yet |
| `ALLOWED_ORIGINS` | Yes | Comma-separated; first entry also builds email/redirect links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `MAIL_USE_TLS`, `MAIL_USE_SSL` | Yes | Gmail app-password spaces auto-stripped |
| `FRONTEND_URL`, `BACKEND_URL` | Yes | Builds invite/offer/IT-setup links |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` | Optional | Primary file/image storage |
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET` | Optional | Alternate storage backend; degrades gracefully if unset |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_MAX_TOKENS` | Optional | Primary LLM; without either key the agent falls back to deterministic replies |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` | Optional | Fallback LLM provider |
| `ENABLE_OCR`, `OCR_LANG`, `OCR_USE_GPU` | Optional | Document extraction toggles |
| `ENABLE_EMBEDDINGS`, `EMBEDDING_MODEL` | Optional | Forward-looking embeddings prep, off by default |
| `BANKING_ENCRYPTION_KEY` | Optional | Fernet key for banking-detail encryption; derived from `SECRET_KEY` if unset |
| `IT_MANAGER_EMAIL`, `IT_PROVISIONING_EXPIRE_DAYS` | Optional | IT provisioning defaults |
| `OFFER_EXPIRE_DAYS`, `OTP_EXPIRE_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `INVITATION_EXPIRE_HOURS` | Optional | Business-rule defaults with sensible fallbacks |

### Frontend — `frontend/.env.local`

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | Base URL of the FastAPI backend, no trailing slash (default `http://localhost:8000`) |

---

## Testing & Validation

### Backend

```bash
cd backend
python -m py_compile app/main.py app/api/<touched>.py app/services/<touched>.py   # syntax/import check
pytest                                                                             # full suite
```

The pytest suite covers: agent support-ticket tools, authorization/audit behavior, banking-endpoint security, career-framework logic, JWT token typing, org-wide recruiter access scoping, profile/email flows, provider support, and search taxonomy.

### Frontend

```bash
cd frontend
npm run lint    # ESLint (Next.js core-web-vitals config)
npm run build   # Production build
```

There is no automated frontend suite yet; lint + build are the available static checks.

### Critical Regression Areas

Auth token typing · capability + role composition · tenant isolation · banking encrypt/mask · offer signing gate · agent confirm flow. Note pre-existing test failures *before* starting a change so you do not misattribute an unrelated, already-broken test.

### Operational Scripts — `backend/scripts/`

Run manually; not part of the request lifecycle, and not a substitute for pytest.

| Script | Purpose |
|--------|---------|
| `seed_super_admin.py` | Bootstrap the first Super Admin account |
| `backfill_dual_role_recruiters.py`, `reconcile_dual_role_profiles.py`, `verify_dual_role.py` | Recruiter/employee dual-role data migrations |
| `backfill_org_scoping.py`, `backfill_organization_tenancy.py` | Multi-tenancy backfills |
| `migrate_providers.py` | Learning provider migration |
| `check_career_data.py` | Career framework data sanity check |
| `test_api_endpoints.py`, `test_learning_ai.py`, `test_openrouter.py`, `e2e_import_single_course_test.py`, `e2e_step2_backfill_match_test.py` | Manual integration/e2e checks (not pytest-collected) |

---

## Security

- **JWT_SECRET validation** — weak or placeholder values crash the app at startup rather than run insecurely.
- **Typed tokens** — access vs refresh; refresh tokens are rejected on API auth, blocking replay.
- **Password hashing** — bcrypt via passlib; accounts lock 15 minutes after 5 failed logins.
- **Encryption at rest** — banking and other sensitive fields Fernet-encrypted; IBAN uniqueness via `iban_hash`.
- **Hidden Super Admin path** — `/portal-root-x9f3` instead of `/admin`; never linked from public UI.
- **Token secrecy** — OTP, invite tokens, and IT tokens are capability-equivalent secrets; never expose passwords/OTPs via the agent.
- **Tenant isolation** — every list/search query filters by `organization_id`; a missing filter is a critical bug.
- **Audit trail** — authz failures and recruiter actions write to `audit_logs`; audit calls are not removed casually.
- **Signed file access** — Cloudinary signed URLs with ownership/org verification on download/verify.
- **Agent hard-scoping** — every tool call passes through the same RBAC chain as REST; the agent cannot see another org's data or bypass checks regardless of conversation content.
- **CORS** — currently `allow_origins=["*"]`, `allow_credentials=False` (`backend/app/main.py`). Intentional for the current deployment stage; tighten for production deployments handling real user data. Do not "fix" this incidentally.

---

## Design Decisions

- **No ORM.** MongoDB is accessed directly through Motor, with Pydantic schemas doing shape validation at the API boundary. This keeps queries close to the metal but makes index management and data-shape discipline manual — see `app/core/database.py`.
- **RBAC lives in code, not the database.** The `roles`/`permissions` collections are a seeded, queryable mirror of `app/core/rbac.py`, refreshed on every boot. If they disagree, code wins.
- **The agent has no privileged path.** Every tool it calls is the same service function a REST endpoint would call, behind the same permission dependency — a deliberate constraint that keeps the agent auditable.
- **Multi-tenancy is row-level, not database-level.** All organizations share one MongoDB database, isolated by an `organization_id` field per document. Keeps operations simple at current scale, but every new query must scope by tenant.
- **Optional dependencies degrade, they don't block.** OCR, embeddings, and LLM integrations lazy-import and fail soft, so the platform stays usable without those optional pieces configured.
- **Large single-file services are normal.** `learning_service.py`, `agent_tools_parity.py`, `agent_tools.py`, and `employee_service.py` run tens of thousands of lines by design. Splitting them is a deliberate, out-of-scope refactor, not a cleanup.
- **`agent_tools.py` vs `agent_tools_parity.py` is an intentional split** (core vs dashboard-parity). Do not merge them.

---

## Working Conventions

This codebase involves heavy AI-agent participation in its development, so a few conventions are load-bearing (see `AGENTS.md` for the full contract):

- **Inspect before you change.** Read the existing implementation and follow its patterns before writing anything new.
- **Preserve behavior unless the task says otherwise.** Business logic, API contracts, auth/permission checks, and validations stay put unless explicitly asked to change.
- **Stay in scope.** No unrelated refactors, renames, reformatting, or speculative improvements riding along with a focused change.
- **Reuse before you build.** Search for an existing service function, hook, or component before adding a new one.
- **Validate before calling it done.** Run whatever applies — compile, lint, build, test — and check imports/references after any rename or move.
- **Contracts change together.** When an API shape changes, update the backend schema + `frontend/services/*.js` wrapper + consuming components in the same pass — mismatches fail silently at runtime.

The `.agents/` knowledge layer (master instructions, architecture docs, and per-module skills) is the deep reference used by coding agents working in this repository. Load the matching skill before changing a module; the repository code is always the source of truth over the documentation.

---

## Troubleshooting

| Symptom | Likely Cause / Fix |
|---------|-------------------|
| Backend crashes on boot with a JWT error | `JWT_SECRET` is under 32 characters or a placeholder. Generate a real one: `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| Backend won't start | A live `MONGODB_URI` is required — there is no in-memory/mock DB mode |
| Mongo connections hang locally | `mongodb+srv://` SRV lookups blocked on the network; `database.py` swaps in public DNS resolvers (8.8.8.8 / 1.1.1.1) — verify this shim is intact |
| New public page forces a login redirect | The route is missing from `PUBLIC_PATHS` in `frontend/proxy.js` |
| Agent returns generic/status-only answers | No LLM key configured; `_fallback_reply` is the expected degrade-gracefully path |
| Contract mismatch between UI and API | Backend schema + `services/*.js` + component were not updated together — there is no shared codegen between stacks |
| Redis errors in containers | `REDIS_URL` is required by Settings but the backend has no Redis client yet — the service exists so env resolves |

---

## Roadmap

The following are potential directions based on the current architecture, not scheduled deliverables:

- Tighten CORS to an explicit allowlist for production deployments.
- Introduce a shared type contract (e.g. TypeScript types generated from the FastAPI OpenAPI schema) so frontend/backend contract drift fails at build time instead of runtime.
- Add automated frontend test coverage alongside the existing pytest backend suite.
- Offer a formal database-per-tenant option for organizations that need harder data isolation than row-level scoping provides.
