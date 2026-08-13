# TalentAI — Technical Reference

> A multi-tenant HR operating system covering the complete employee lifecycle — **invite → offer → onboarding → IT provisioning → employee lifecycle → learning → talent/career growth** — with a role-aware conversational agent built directly into the permission-checked service layer.

**Stack:** Next.js 16 / React 19 · FastAPI (async) · Motor / MongoDB · JWT + RBAC · OpenRouter / Gemini · Cloudinary

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Capabilities — Deep Dive](#2-core-capabilities--deep-dive)
3. [User Roles & Permission Model](#3-user-roles--permission-model)
4. [The Conversational Agent Layer](#4-the-conversational-agent-layer)
5. [System Architecture](#5-system-architecture)
6. [Technology Stack](#6-technology-stack)
7. [Repository Structure](#7-repository-structure)
8. [Domain Module Map](#8-domain-module-map)
9. [Authentication System](#9-authentication-system)
10. [Authorization & RBAC](#10-authorization--rbac)
11. [Multi-Tenancy](#11-multi-tenancy)
12. [Database Design](#12-database-design)
13. [API Reference](#13-api-reference)
14. [Integrations](#14-integrations)
15. [Getting Started](#15-getting-started)
16. [Environment Variables](#16-environment-variables)
17. [Testing & Validation](#17-testing--validation)
18. [Security](#18-security)
19. [Design Decisions](#19-design-decisions)
20. [Deployment Architecture](#20-deployment-architecture)
21. [Monitoring & Observability](#21-monitoring--observability)
22. [Extensibility Points](#22-extensibility-points)
23. [Troubleshooting](#23-troubleshooting)
24. [Roadmap](#24-roadmap)

---

## 1. Overview

### 1.1 What Is TalentAI?

TalentAI is a **multi-tenant HR operating system** that unifies hiring, onboarding, IT provisioning, employee lifecycle management, learning & development, talent management, and internal communication into a single platform. Its defining architectural characteristic: the **same permission-checked service layer** that powers the REST API also powers the in-app conversational agent. There is no shadow logic, no parallel rule set, and no second backend for the conversational interface.

### 1.2 Core Philosophy

- **Single Source of Truth**: Business logic lives once — in `backend/app/services/`. Routers, agent tools, and frontend services all delegate to these functions.
- **Zero Trust by Default**: Every data access is scoped by `organization_id`. Every endpoint is gated by RBAC + capability checks. The agent inherits the exact same constraints as a human user.
- **Degrade Gracefully**: Optional subsystems (OCR, embeddings, LLM) lazy-import and fail soft. The platform remains functional without them.
- **Tenant Isolation is Non-Negotiable**: A missing `organization_id` filter is treated as a critical security bug.

### 1.3 Hiring Lifecycle Flow

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

Cross-cutting flows: Document OCR → profile fields → recruitment verification · Organization Framework ↔ Learning course sync · Agent tools → same services as the UI.

---

## 2. Core Capabilities — Deep Dive

### 2.1 Recruitment & Invitation Management

#### Individual Invitations
- **Mandatory Offer Coupling**: An invitation cannot be created without an associated offer letter (`offer_service.create_for_invitation`).
- **Token Generation**: Cryptographically secure, unguessable tokens (`secrets.token_urlsafe(32)`) stored in `invitations.token` with unique index.
- **Expiry**: Configurable via `INVITATION_EXPIRE_HOURS` (default 168h/7 days). Expired invitations are filtered by `expires_at` index.
- **Status Lifecycle**: `pending` → `accepted` → `completed` / `expired` / `revoked`.
- **Candidate Creation**: On acceptance, a `candidates` document is created with `organization_id` inherited from the inviting recruiter.

#### Bulk Invite Import
- **Format**: `.xlsx` spreadsheets parsed via `xlsx` library (`bulk_invite_service.py`).
- **Preview/Dry-Run**: Validates all rows before sending — checks email format, duplicate detection, required columns.
- **Column Mapping**: Flexible mapping (email, first_name, last_name, role, department, custom fields).
- **Per-Row Offer Templates**: Each row can specify a different offer template or inherit a default.
- **Agent-Assisted Upload**: The conversational agent can parse uploaded spreadsheets and present a confirmation card before sending.

#### Pipeline Tracking
- **Statuses**: `invited` → `registered` → `offer_sent` → `offer_viewed` → `negotiating` → `signed` → `onboarding` → `documents_pending` → `documents_verified` → `it_provisioning` → `hired` / `declined` / `withdrawn`.
- **Global Search**: `/api/search` with taxonomy-based filters (department, role, location, status, date range, skill tags).
- **Recruiter Scope**: All lists filtered by `recruiter_people_scope(user)` which includes legacy rows missing `organization_id` but owned by recruiters in the same org.

#### Offer Lifecycle
- **Templates**: Organization-configurable templates with merge fields (`{{candidate_name}}`, `{{role}}`, `{{salary}}`, `{{start_date}}`, etc.).
- **Digital Signature**: Draw (canvas) or upload image. Stored in Cloudinary, reference saved on `offer_letters.signature_url`.
- **Expiry**: Default 7 days (`OFFER_EXPIRE_DAYS`), configurable per offer.
- **Negotiation**: Max 3 rounds (`offer_service.negotiate`). Each round creates an `audit_logs` entry with old/new values.
- **Reminders**: Automated via `reminder_service` (1h throttle per candidate).
- **Statuses**: `draft` → `sent` → `viewed` → `negotiating` → `signed` / `declined` / `expired` / `revoked`.

### 2.2 Onboarding Wizard

#### Multi-Step Progressive Wizard
Steps (enforced server-side via `onboarding_service.get_required_keys`):
1. **personal_info** — Legal name, DOB, gender, nationality, CNIC/passport
2. **contact_info** — Personal email, phone, address, emergency contact
3. **education** — Degrees, institutions, graduation years, certificates
4. **experience** — Employers, roles, dates, responsibilities
5. **documents** — Identity, education, bank slip, resume uploads
6. **banking** — Account holder name, bank name, account number, IBAN, SWIFT
7. **review** — Summary with edit links per section

#### Autosave & Concurrency
- **Mechanism**: `PATCH /api/onboarding/progress` with `step` + `data` + `version` (optimistic locking).
- **Conflict Resolution**: 409 if version mismatch; frontend fetches latest and merges.
- **AI-Assisted Fill**: Typewriter-style coach (`frontend/lib/ai/formCoach.js`) + per-field insights from `*Insights.js` builders.

#### Document Upload & OCR Pipeline
- **Upload**: Direct to Cloudinary via signed URL (`storage_service.get_upload_signature`), then `POST /api/documents` with `cloudinary_public_id`.
- **OCR Trigger**: `document_extraction_service.process_document` (lazy-imported, `ENABLE_OCR`).
- **Extractors**:
  - **CNIC/Passport**: Regex + EasyOCR/Pytesseract → `cnic`, `passport_number`, `expiry`
  - **Bank Slip**: Table extraction → `bank_name`, `account_title`, `account_number`, `iban`
  - **Resume**: PDF/DOCX parsing → skills, experience, education (feeds `embedding_service` if `ENABLE_EMBEDDINGS`)
  - **Certificates**: Degree name, institution, year, credential ID
- **Confidence Scoring**: Each extracted field has `confidence` (0–1). Fields < 0.7 flagged for manual review.
- **Pre-fill**: Extracted data auto-populates onboarding steps via `document_extraction_service.apply_to_onboarding`.

#### Recruiter Verification Queue
- **Endpoint**: `GET /api/documents?status=pending_verification` (requires `documents.review` permission).
- **Viewer**: Side-by-side document image + extracted fields with confidence badges.
- **Actions**: `Approve` (sets `status=verified`), `Reject` (sets `status=rejected`, requires `rejection_reason`), `Request Re-upload`.
- **Audit**: Every action writes to `audit_logs` with recruiter ID, document ID, old/new status.

### 2.3 IT Provisioning

#### Provisioning Kits
- **Definition**: `it_kits` collection — `name`, `description`, `category` (laptop/phone/access/software), `specifications` (JSON), `default_quantity`.
- **Assignment**: Recruiter assigns kits to a candidate during hiring flow; creates `it_provisioning_requests` with `kit_items` array.

#### Public Token Provisioning
- **Single**: `GET /api/it-provisioning/{token}` → candidate selects company email prefix, asset preferences, receives encrypted temp password.
- **Batch**: `GET /api/it-provisioning/batch/{token}` → handles multiple hires in one session (used for cohort onboarding).
- **Token**: Unique, unguessable, stored in `it_provisioning_requests.token` with `expires_at` (default 30 days, `IT_PROVISIONING_EXPIRE_DAYS`).

#### Encrypted Temporary Passwords
- **Generation**: `crypto.fernet_encrypt(generated_password)` stored in `it_provisioning_requests.temp_password_enc`.
- **Reveal**: Candidate requests reveal → OTP sent to personal email → `crypto.fernet_decrypt` returned in response (never logged).
- **Rotation**: On first login, candidate sets permanent password via `/api/auth/change-password`.

#### IT Service Requests (Post-Hire)
- **Public Intake**: `GET|POST /api/it-service-requests/public/{token}` — employee raises request without login.
- **Categories**: Hardware, Software, Access, Network, Security, Other.
- **SLA**: Priority-based (Critical: 4h, High: 8h, Medium: 24h, Low: 72h).
- **Fulfillment**: IT staff update status, add resolution notes, close with satisfaction survey.

### 2.4 Employee Lifecycle

#### Candidate-to-Employee Conversion
- **Trigger**: `employee_service.create_from_candidate(candidate_id, recruiter_id)` called after offer signed + documents verified + IT provisioned.
- **ID Format**: `EMP-######` (6-digit zero-padded, from `counters` collection atomic increment).
- **Data Migration**: All onboarding data copied to `employees` document; `candidate.status = 'converted'`.
- **History Preservation**: Original `candidate` document retained; `people_history` entry created with `cycle_group_key`.

#### Complete Profile (Post-Hire)
- **Steps**: Emergency contacts → Tax info → Benefits enrollment → Policy acknowledgments → Equipment receipt.
- **Validation**: Required fields per org config (`organization_framework` roadmaps).

#### Directory & Org Chart
- **Search**: `GET /api/employees?search=&dept=&role=&location=` (recruiter: org-scoped; employee: own org).
- **Org Chart**: Hierarchical rendering from `manager_id` references; drill-down to profile.

#### Career Events Timeline
- **Collection**: `employee_career_events` — `employee_id`, `event_type` (promotion/transfer/role_change/compensation/certification), `effective_date`, `details` (JSON), `approved_by`.
- **Readiness Reports**: `career_framework_service.get_promotion_readiness(employee_id)` computes gap against next level.

### 2.5 Learning & Development

#### Live Catalog Sync
- **Coursera**: `coursera_service.sync_catalog()` → `https://api.coursera.org/api/courses.v1` → upserts `learning_courses` with `provider_id=coursera`.
- **Microsoft Learn**: `ms_learn_service.sync_catalog()` → `https://learn.microsoft.com/api/catalog/` → upserts with `provider_id=ms_learn`.
- **Caching**: In-process LRU + Mongo `learning_catalog_cache` (snapshot ID for invalidation).
- **Background Refresh**: Non-DEBUG mode starts `coursera_service.start_background_refresh()` (interval: 6h).

#### Provider Framework
- **Managed Providers**: `learning_providers` collection — `name`, `slug`, `type` (coursera/ms_learn/generic_api), `config` (encrypted secrets for generic).
- **Generic API Providers**: Custom catalog endpoints with auth headers, pagination config, field mapping.
- **Import Engine**: `learning_service.import_courses_from_provider(provider_id)` with progress tracking in `learning_import_history`.

#### Enrollment & Assignments
- **Self-Enroll**: `POST /api/learning/enroll` — employee selects course, creates `learning_enrollments` with `status=enrolled`.
- **Recruiter Assignment**: `POST /api/learning/assign` — mandatory courses with `due_date`, creates `learning_assignments`.
- **Progress**: `PATCH /api/learning/progress` — updates `completion_percentage`, `last_accessed_at`.
- **Completion**: Auto-creates `learning_certificates` on 100% (if course offers certificate).

#### Skill-Gap Analysis (LLM-Powered)
- **Input**: Employee skills (`employee_skills`) + target role requirements (`org_framework_roles.skills` + `career_framework` tracks).
- **Service**: `learning_ai_service.analyze_skill_gap(employee_id, target_role_id)`.
- **Output**: Prioritized gaps with `severity`, `recommended_courses` (real `learning_courses._id`), `estimated_hours`.
- **Caching**: Results stored in `learning_skill_gaps` with TTL; invalidated on skill/role change.

#### Certificate Management
- **Upload**: `POST /api/learning/certificates` — file to Cloudinary, OCR extracts `credential_id`, `issuer`, `issue_date`, `expiry_date`.
- **Verification**: Recruiter reviews (`documents.review` permission) → `status=verified`.
- **Expiry Tracking**: `reminder_service` nudges 30/7/1 days before expiry.

#### Career Framework
- **Entities**: `career_tracks` → `career_levels` (per track) → `employee_career_assignments` (employee ↔ level).
- **Promotion Rules**: `career_framework_promotion_rules` — `from_level`, `to_level`, `required_skills`, `required_certifications`, `min_tenure_months`.
- **Readiness**: `career_framework_service.get_readiness_report(employee_id)` — % complete per rule, blockers.

### 2.6 Talent & Internal Mobility

#### Internal Opportunities
- **Posting**: Recruiter creates `internal_opportunities` — `title`, `department`, `role_id`, `description`, `requirements`, `application_deadline`, `hiring_manager_id`.
- **Matching**: `talent_service.match_opportunities(employee_id)` scores against profile skills, career goals, tenure.
- **Application**: `POST /api/talent/opportunities/{id}/apply` → `internal_opportunity_applications` with `status=applied`.
- **Review**: Hiring manager reviews, interviews, hires/rejects with feedback.

#### Competency Evaluations
- **Structure**: `talent_competency_evaluations` — `employee_id`, `evaluator_id`, `competency_id`, `rating` (1–5), `evidence`, `evaluation_date`.
- **Aggregation**: Department/role-level heatmaps via `talent_service.get_skill_matrix(department_id)`.

#### Development Plans
- **Creation**: `talent_service.create_development_plan(employee_id, goals[])` → `talent_development_plans` with milestones.
- **Milestones**: `course_id` / `certification_id` / `experience_target` + `target_date` + `status`.
- **Tracking**: Dashboard shows % complete, overdue items, mentor check-ins.

#### Skill Matrix & Journey
- **Matrix**: `talent_service.get_skill_matrix()` — rows=employees, columns=skills, cells=proficiency (1–5).
- **Journey**: Per-employee timeline of skill acquisitions, certifications, role changes with achievement badges.

### 2.7 Support & Communication

#### HR Threads
- **Model**: `hr_threads` — `participants[]` (candidate/employee + recruiter), `subject`, `status` (open/closed), `priority`, `created_at`, `last_message_at`.
- **Messages**: Embedded `messages[]` array with `sender_id`, `sender_role`, `body`, `attachments[]`, `read_by[]`.
- **Notifications**: Real-time via polling (`useNotificationsCenter` hook) + email fanout for high priority.

#### Tickets
- **Recruiter Support**: `/api/tickets` — categories (Platform, Billing, Feature, Bug), SLA by priority.
- **Super Admin Platform**: `/api/admin/tickets` — cross-org, escalation from recruiter tickets.
- **Audit**: `ticket_audit_logs` — every status change, assignment, comment, SLA breach.

#### Announcements
- **Audience Targeting**: `announcements.audience` — `roles[]`, `departments[]`, `locations[]`, `organization_id` (for Super Admin cross-org).
- **Scheduling**: `publish_at`, `expire_at`; draft → scheduled → published → expired.
- **Email Fanout**: `email_service.send_announcement` with unsubscribe link.

#### Notifications
- **Types**: `info`, `success`, `warning`, `error`, `action_required`.
- **Channels**: In-app (real-time poll), email (for `action_required` + high priority).
- **Grouping**: Deduplication via `toastId` (frontend) + `notification_key` (backend).

### 2.8 Super Admin Platform Operations

#### Organization Management
- **CRUD**: `POST|GET|PUT|DELETE /api/super-admin/organizations` — `name`, `slug`, `status` (active/suspended/archived), `modules` (object of 14 boolean flags), `branding` (logo, colors), `custom_email_templates`.
- **Purge**: `DELETE /api/super-admin/organizations/{id}?confirm=yes` → `organization_service.purge_organization()` (irreversible, returns summary).

#### Recruiter Management
- **Invite**: `POST /api/super-admin/recruiters` — email, org_id, capabilities[] → sends invitation with `/portal-root-x9f3` link.
- **Capabilities**: `PUT /api/super-admin/recruiters/{id}/capabilities` — full replace or `PATCH` for incremental.
- **Templates**: `POST /api/super-admin/capability-templates` — named presets (e.g., "Hiring Only", "Full Access").

#### Platform Health
- **Stats**: `GET /api/super-admin/stats` — org count, recruiter count, candidate/employee totals, active offers, storage usage.
- **Audit Aggregation**: `GET /api/super-admin/audit-logs` — cross-org filterable by date, action, actor.

---

## 3. User Roles & Permission Model

### 3.1 Role Definitions (Code-Sourced)

Defined in `backend/app/core/rbac.py`:

| Role | Home | `ROLE_HOME` | Permissions (from `ROLE_PERMISSIONS`) |
|------|------|-------------|---------------------------------------|
| `super_admin` | `/dashboard/super-admin` | `/dashboard/super-admin` | `ALL_PERMISSIONS` |
| `recruiter` | `/dashboard/recruiter` | `/dashboard/recruiter` | `recruitment.*`, `onboarding.manage`, `documents.review`, `offers.manage`, `learning.access`, `ai.access`, `reporting.view`, `profile.view` |
| `candidate` | `/dashboard/candidate` | `/dashboard/candidate` | `onboarding.self`, `documents.self`, `offers.self`, `profile.view` |
| `employee` | `/dashboard/employee` | `/dashboard/employee` | `onboarding.self`, `documents.self`, `offers.self`, `learning.access`, `ai.coach`, `profile.view` |

**Mongo Mirror**: `roles`/`permissions` collections seeded at startup via `rbac_seed.py` for querying only.

### 3.2 Recruiter Capabilities (Module-Level Gates)

**Org Module Keys** (`ORG_MODULE_KEYS` in `organization_service.py`):
```
overview, candidates, invite, employees, talent, learning, org_config,
assistant, messages, announcements, it, reporting, profile, support
```

**Effective Capability Calculation**:
```python
effective = org.modules ∩ recruiter.capabilities
```

**`CurrentUser.has_capability(key)` Logic**:
```python
if user.role != "recruiter": return True
if not user.capabilities: return True  # backward compat
return user.capabilities.get(key, True)
```

**Enforcement Pattern** (always pair with role check):
```python
RequireRecruiterWithTalent = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("talent")),
]
```

### 3.3 Permission Codes (Full List)

| Code | Description | Roles |
|------|-------------|-------|
| `recruitment.view` | View recruitment dashboard | recruiter, super_admin |
| `recruitment.invite` | Create/send invitations | recruiter, super_admin |
| `onboarding.self` | Complete own onboarding | candidate, employee, super_admin |
| `onboarding.manage` | Manage candidate onboarding | recruiter, super_admin |
| `documents.self` | Upload/view own documents | candidate, employee, super_admin |
| `documents.review` | Verify others' documents | recruiter, super_admin |
| `offers.self` | View/sign own offer | candidate, employee, super_admin |
| `offers.manage` | Create/send/approve offers | recruiter, super_admin |
| `learning.access` | Access learning modules | recruiter, employee, super_admin |
| `ai.access` | Recruiter AI modules | recruiter, super_admin |
| `ai.coach` | Employee AI coach | employee, super_admin |
| `reporting.view` | View reports/analytics | recruiter, super_admin |
| `profile.view` | View profile | all |
| `admin.access` | Platform administration | super_admin |

---

## 4. The Conversational Agent Layer

### 4.1 Architecture Overview

The agent is a **tool-calling loop** (`agent_service.py`) that executes real business operations through the same service layer as the REST API. It is not a chatbot — it is a first-class product interface with full RBAC enforcement.

### 4.2 Agent Loop (Detailed)

```python
# Pseudocode from agent_service.py
async def agent_chat(session_id, user_message, user: CurrentUser):
    for step in range(MAX_TOOL_STEPS):  # = 4
        # 1. Build prompt
        prompt = build_prompt(
            role_system_prompt=user.role,
            shared_rules=SHARED_AGENT_RULES,
            tool_catalog=get_tools_for_role(user.role),
            state_snapshot=await get_state_snapshot(user),
            history=await get_recent_history(session_id, turns=8),
            user_message=user_message
        )
        
        # 2. Call LLM (strict JSON)
        response = await call_llm_json(prompt)
        
        # 3. Parse action
        if response.type == "reply":
            return persist_and_return(session_id, response)
        
        # 4. Execute tool
        tool = TOOL_REGISTRY[response.tool_name]
        if tool.read_only and tool.name in recent_read_only_calls:
            continue  # skip duplicate read-only
        result = await tool.execute(response.arguments, user)
        
        # 5. Observe & loop
        user_message = format_observation(tool.name, result)
    
    return persist_and_return(session_id, Reply("Max steps reached"))
```

### 4.3 Prompt Construction

| Component | Source |
|-----------|--------|
| Role System Prompt | `agent_tools.py` → `ROLE_SYSTEM_PROMPTS[role]` |
| Shared Rules | `SHARED_AGENT_RULES` (no raw paths, no secrets, confirm destructive) |
| Tool Catalog | Filtered by role: `RECRUITER_TOOLS`, `CANDIDATE_TOOLS`, `EMPLOYEE_TOOLS`, `SUPER_ADMIN_TOOLS` |
| State Snapshot | `agent_tools.get_state_snapshot(user)` — dashboard summary, pending counts, recent items |
| History | Last 8 turns from `agent_conversations` |
| User Message | Current input |

### 4.4 Tool Registry (Three Files — Intentional Split)

| File | Contents | Role Lists |
|------|----------|------------|
| `agent_tools.py` | Core tools, `SELF_SERVE_TOOLS`, `RECRUITER_TOOLS` base, role list assembly | All roles |
| `agent_tools_parity.py` | Dashboard-parity extras (brings agent to full UI feature parity) | Recruiter/Candidate/Employee parity |
| `agent_tools_super_admin.py` | Platform-level tools (lazy-loaded) | Super Admin only |

**Role List Composition** (`agent_tools.py`):
```python
RECRUITER_TOOLS = RECRUITER_BASE_TOOLS + RECRUITER_PARITY_TOOLS
CANDIDATE_TOOLS = SELF_SERVE_TOOLS + CANDIDATE_PARITY_TOOLS
EMPLOYEE_TOOLS = SELF_SERVE_TOOLS + EMPLOYEE_PARITY_TOOLS
SUPER_ADMIN_TOOLS = SUPER_ADMIN_BASE_TOOLS + RECRUITER_TOOLS
```

### 4.5 Read-Only Tool Tracking

`READONLY_TOOLS` set in `agent_service.py` prevents the agent from wasting steps re-fetching identical state. **Any new read-only tool must be added here.**

Current set:
```
get_status, get_my_offer, get_my_profile, list_documents,
list_candidate_documents, list_person_documents, list_candidates,
list_employees, get_candidate_status, get_employee_detail,
get_dashboard_summary, my_learning_dashboard, list_opportunities,
list_my_announcements, list_notifications, list_hr_threads,
get_my_day1_info
```

### 4.6 Tool Development Rules

1. **Service-First**: Every tool calls an existing service function. If data isn't exposed, extend the service.
2. **RBAC Parity**: Tool enforces same permissions as the equivalent REST endpoint.
3. **Registration**: Add to correct role list in `agent_tools.py` assembly.
4. **Read-Only**: If tool only reads, add name to `READONLY_TOOLS`.
5. **Confirm Gate**: Destructive/bulk tools set `needs_confirm=True` → agent returns `__CONFIRM__:` prefix.
6. **No Raw Paths**: Agent prose never contains `/offer`, `offer_page=`, etc. Navigation via `ui_hint` buttons only.

### 4.7 Graceful Degradation

If `llm_configured()` returns `False` (no OpenRouter/Gemini keys), `_fallback_reply()` handles:
- Status queries ("How many candidates?")
- Count queries ("Show my pending documents")
- Simple lookups ("What's my offer status?")

The dashboard remains functional; agent degrades to deterministic read-only assistant.

### 4.8 Frontend AI Surfaces (Distinct from Agent)

| Surface | Path | Purpose |
|---------|------|---------|
| Context Builders | `frontend/lib/ai/*Context.js` | Aggregate dashboard data for orb |
| Insight Builders | `frontend/lib/ai/*Insights.js` | Generate tips, field help, summaries |
| AI Experience | `frontend/components/ai-experience/` | AiOrb, confirm cards, OCR overlays, activity panel |
| Full Agent Chat | `components/ai/AgentChatCore.js` + `*/ai-assistant` pages | Tool-calling chat interface |
| Mascot Brief | Recruiter overview → `POST /api/dashboard/recruiter-mascot/brief` | Short LLM summary, not tool loop |

> **Mascot ≠ Conversational Agent.** The mascot produces tips/briefs; the agent executes tools. Do not conflate.

---

## 5. System Architecture

### 5.1 Request Lifecycle (End-to-End)

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Browser   │────▶│  Next.js App     │────▶│  FastAPI Backend    │
│             │     │  Router + proxy  │     │  Routers + Services │
└─────────────┘     └──────────────────┘     └─────────────────────┘
       │                    │                        │
       │ 1. Request         │ 2. Cookie check        │ 3. JWT verify
       │                    │    (proxy.js)          │    (get_current_user)
       │                    │                        │
       ▼                    ▼                        ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  localStorage│     │  PUBLIC_PATHS    │     │  Depends(Require*)  │
│  (JWTs)      │     │  allowlist       │     │  RBAC + Caps        │
└─────────────┘     └──────────────────┘     └─────────────────────┘
       │                    │                        │
       │ 4. Bearer token    │                        │ 5. Service call
       │    (apiClient.js)  │                        │    (business logic)
       ▼                    ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MongoDB (Motor)                             │
│  organization_id-scoped queries + indexes                        │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  External: Cloudinary │ SMTP │ OpenRouter/Gemini │ Coursera/MS  │
└─────────────────────────────────────────────────────────────────┘
```

**Step-by-Step**:
1. Browser requests a route. `proxy.js` middleware checks `access_token` cookie. Missing + non-public → 302 `/login`.
2. `lib/apiClient.js` attaches `Authorization: Bearer <access_token>` from localStorage.
3. FastAPI `get_current_user` decodes JWT, validates `type="access"`, resolves profile from Mongo, loads `effective_capabilities`.
4. Router dependency (`RequireRecruiter`, `RequireRecruiterWithInvite`, etc.) authorizes or denies (audited).
5. Service executes business logic with tenant-scoped queries.
6. Response serialized via Pydantic schema → JSON → frontend service → component.

### 5.2 Layer Rules (Hard Constraints)

| Layer | Path | Responsibility | Forbidden |
|-------|------|----------------|-----------|
| **Routers** | `backend/app/api/` | Parse → auth dep → call ONE service → return | Business `if` deciding outcomes |
| **Services** | `backend/app/services/` | All business logic, DB, emails, notifications | HTTP concerns, request parsing |
| **Schemas** | `backend/app/schemas/` | Request/response contracts (Pydantic) | Business logic |
| **Core** | `backend/app/core/` | Config, DB, Security, RBAC, Crypto | Domain logic |
| **Frontend Pages** | `frontend/app/dashboard/{role}/` | Call `services/*.js` only | Raw `axios`/`fetch` to backend |
| **Agent Tools** | `backend/app/services/agent_tools*.py` | Call services (same as REST) | Direct `collection.find` |

### 5.3 Forbidden Shortcuts

- Router → raw Mongo business logic
- Agent tool → `collection.find` without service RBAC
- Frontend page → axios to backend bypassing `services/`
- Cross-org queries without Super Admin intent

### 5.4 Dependency Direction

```
api → services → (database | crypto | email | storage | llm)
frontend pages → services/*.js → apiClient → api
lib/ai (UX) ↛ agent_tools   (context only; chat uses agent API)
```

---

## 6. Technology Stack

### 6.1 Frontend

| Category | Technology | Version/Notes |
|----------|------------|---------------|
| Framework | Next.js (App Router) | 16.x |
| Runtime | React | 19.x |
| Styling | CSS Modules + Tailwind | v4 (PostCSS plugin) |
| Animation | framer-motion | Latest |
| Icons | lucide-react | Latest |
| HTTP Client | axios | With interceptors |
| Notifications | react-toastify | Toast containers per shell |
| Spreadsheets | xlsx | Bulk invite import/export |
| Session | Cookie + localStorage | `proxy.js` middleware |
| Linting | ESLint | Next.js core-web-vitals config |
| Build | `npm run build` | Production bundle |

### 6.2 Backend

| Category | Technology | Version/Notes |
|----------|------------|---------------|
| Framework | FastAPI | Async, Uvicorn |
| Database Driver | Motor | Async MongoDB |
| Validation | Pydantic | v2 |
| Auth | python-jose (JWT) + passlib (bcrypt) | |
| Rate Limiting | slowapi | |
| Logging | loguru / rich | Structured |
| File Storage | Cloudinary (primary) + Supabase (optional) | |
| LLM | OpenRouter (primary) + Gemini (fallback) | Via `llm_service` |
| Document Intelligence | PyMuPDF, python-docx, EasyOCR, Pytesseract, openpyxl | All lazy-imported |
| Task Scheduling | APScheduler (reminders) | Background |

### 6.3 Infrastructure

| Component | Technology |
|-----------|------------|
| Containerization | Docker Compose (`docker-compose.yml` + `docker-compose.prod.yml`) |
| Database | MongoDB 7 (replica set for transactions) |
| Cache/Config | Redis (config-only — no client yet) |
| LLM Gateway | OmniRoute (local) / OpenRouter (cloud) |
| Reverse Proxy | nginx (optional, production) |
| Process Manager | Uvicorn (dev), Docker (prod) |

---

## 7. Repository Structure

```
TalentAI/
├── AGENTS.md                         # Short agent field guide
├── README.md                         # This file
├── .agents/                          # Engineering knowledge layer
│   ├── AGENTS.md                     # Master instructions
│   ├── architecture/                 # Cross-cutting architecture
│   │   ├── system-overview.md
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   ├── api.md
│   │   ├── authentication.md
│   │   ├── authorization.md
│   │   ├── database.md
│   │   ├── ai.md
│   │   ├── integrations.md
│   │   ├── multi-tenancy.md
│   │   └── dependency-map.md
│   └── skills/                       # Module skills (load per task)
│       └── README.md                 # Skill index
├── backend/
│   ├── app/
│   │   ├── main.py                   # App factory, CORS, lifespan
│   │   ├── api/                      # 18 thin routers
│   │   ├── core/                     # Spine: config, db, security, rbac, crypto
│   │   ├── schemas/                  # Pydantic contracts (per domain)
│   │   ├── services/                 # 30+ business logic modules
│   │   └── static/
│   ├── scripts/                      # Seeds, backfills, smoke tests
│   ├── tests/                        # pytest suite
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/                          # Next.js App Router
│   │   ├── (public routes)           # login, register, invite, onboarding, offer, documents, it-setup, it-support, portal-root-x9f3
│   │   └── dashboard/
│   │       ├── recruiter/
│   │       ├── candidate/
│   │       ├── employee/
│   │       └── super-admin/
│   ├── components/                   # React components by role/domain
│   ├── services/                     # API wrappers (ONLY layer calling backend)
│   ├── hooks/                        # Shared hooks (session, sidebar, notifications, etc.)
│   ├── lib/                          # apiClient + ai/ context builders
│   ├── utils/                        # Nav configs, validation
│   ├── proxy.js                      # Auth cookie gate
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx/nginx.conf
└── .env.docker.example
```

### 7.1 Key Backend Services (Alphabetical)

| Service | Domain |
|---------|--------|
| `agent_service.py` | Agent loop, fallback |
| `agent_tools.py` | Core tools + role assembly |
| `agent_tools_parity.py` | Dashboard-parity tools |
| `agent_tools_super_admin.py` | Super Admin tools |
| `auth_service.py` | Login, OTP, lockout, refresh |
| `bulk_invite_service.py` | Spreadsheet import |
| `career_framework_service.py` | Tracks, levels, readiness |
| `coursera_service.py` | Coursera catalog sync |
| `dashboard_service.py` | Summary, activity, announcements |
| `document_extraction_service.py` | OCR field extraction |
| `document_service.py` | Uploads, verify, downloads |
| `email_service.py` | SMTP + templates |
| `embedding_service.py` | Resume embeddings |
| `employee_service.py` | Convert, profile, banking, directory |
| `invitation_service.py` | Invites + required offer |
| `it_provisioning_service.py` | Kits, tokens, passwords |
| `it_service_requests_service.py` | IT tickets |
| `learning_ai_service.py` | Skill gaps, recommendations |
| `learning_service.py` | Catalog, enrollments, assignments |
| `llm_service.py` | `call_llm_json`, OpenRouter→Gemini |
| `message_service.py` | HR threads |
| `ms_learn_service.py` | MS Learn catalog sync |
| `offer_service.py` | Lifecycle, negotiation, signing |
| `organization_framework_service.py` | Departments, roles, skills, roadmaps |
| `organization_service.py` | Org modules, scopes, purge |
| `ocr_service.py` | Lazy OCR pipeline |
| `recruiter_mascot_service.py` | Dashboard brief |
| `reminder_service.py` | Throttled nudges |
| `storage_service.py` | Cloudinary uploads, signed URLs |
| `talent_service.py` | Opportunities, evaluations, plans |

---

## 8. Domain Module Map

| Domain | Router | Service(s) | Frontend |
|--------|--------|------------|----------|
| Auth/Session | `api/auth.py` | `auth_service.py` | `/login`, `/register`, verify/reset |
| Invitations | `api/invitations.py` | `invitation_service.py`, `bulk_invite_service.py` | `/dashboard/recruiter/invite`, `/invite/[token]` |
| Offers | `api/offers.py` | `offer_service.py` | `/offer`, recruiter pages |
| Onboarding | `api/onboarding.py` | `candidate_service.py`, `employee_service.py` | `/onboarding`, profiles |
| Documents/OCR | `api/documents.py` | `document_service.py`, `ocr_service.py`, `document_extraction_service.py` | `/documents`, DocumentManager |
| Employees | `api/employees.py` | `employee_service.py` | `/dashboard/recruiter/employees` |
| IT Provisioning | `api/it_provisioning.py` | `it_provisioning_service.py` | `/it-setup/[token]`, recruiter IT |
| IT Service Requests | `api/it_service_requests.py` | `it_service_requests_service.py` | `/it-support/[token]` |
| Learning | `api/learning.py` | `learning_service.py`, `learning_ai_service.py` | Recruiter/employee learning |
| Org Framework | `api/organization_framework.py` | `organization_framework_service.py` | `/dashboard/recruiter/organization-config` |
| Career Framework | `api/career_framework.py` | `career_framework_service.py` | Employee career, readiness |
| Talent | `api/talent.py` | `talent_service.py` | Recruiter/employee talent |
| Messages | `api/messages.py` | `message_service.py` | Recruiter/employee messages |
| Dashboard/Notifs | `api/dashboard.py` | `dashboard_service.py` | Overview, announcements, search |
| AI Agent | `api/agent.py` | `agent_service.py`, `agent_tools*.py` | `*/ai-assistant` |
| Tickets | `api/tickets.py`, `api/admin_tickets.py` | `ticket_service.py` | Recruiter support; SA tickets |
| Super Admin | `api/super_admin.py` | `organization_service.py` | Orgs, recruiter caps |
| Universities | `api/universities.py` | — | Onboarding education autocomplete |

---

## 9. Authentication System

### 9.1 JWT Token System

**Typed Tokens** — Prevents token confusion attacks.

| Token | Claim `type` | Use | Expiry |
|-------|--------------|-----|--------|
| Access | `"access"` | `Authorization: Bearer` | `ACCESS_TOKEN_EXPIRE` (default 30m) |
| Refresh | `"refresh"` | `POST /api/auth/refresh` only | `JWT_EXPIRE_MINUTES` (7d/30d with `remember_me`) |

**Validation** (`security.get_current_user`):
```python
payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
if payload.get("type") != "access":
    raise HTTPException(401, "Invalid token type")
```

### 9.2 Session Flow (Frontend)

1. **Login/Verify/Switch** → Store in localStorage: `access_token`, `refresh_token`, `token_expires_at`, `user`.
2. **Cookie Mirror** → `document.cookie = "access_token=...; path=/; SameSite=Lax"` for `proxy.js`.
3. **API Calls** → `apiClient.js` attaches Bearer from localStorage.
4. **401 Handling** → Interceptor calls `/api/auth/refresh`, updates localStorage + cookie, retries original request.
5. **Logout** → `clearLocalSession()` clears localStorage + sets cookie `max-age=0`.

### 9.3 Auth Endpoints (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | General signup (creates pending user + OTP) |
| POST | `/candidate/register` | Candidate-specific signup |
| POST | `/recruiter/register` | Recruiter-specific signup (requires invite token) |
| POST | `/verify-otp` | Activates pending user, returns session |
| POST | `/verify-email` | Email verification for existing users |
| POST | `/resend-otp` | Resend OTP (cooldown: `OTP_RESEND_COOLDOWN_SECONDS`) |
| POST | `/resend-verification` | Resend email verification |
| POST | `/login` | Password auth; `remember_me` extends refresh |
| POST | `/refresh` | Rotates access token |
| POST | `/forgot-password` | Sends 6-digit reset code |
| POST | `/reset-password` | Resets with code |
| POST | `/change-password` | Authenticated password change |
| POST | `/logout` | Revokes refresh tokens |
| POST | `/bootstrap-super-admin` | First SA only, OTP-gated |
| POST | `/switch-role` | Dual-role recruiter↔employee; rotates tokens |
| GET | `/me` | Returns current user profile |

### 9.4 OTP & Lockout

| Parameter | Default | Config |
|-----------|---------|--------|
| OTP Length | 6 digits | — |
| OTP Expiry | 10 min | `OTP_EXPIRE_MINUTES` |
| Max OTP Attempts | 5 | `OTP_MAX_ATTEMPTS` |
| Resend Cooldown | 60 sec | `OTP_RESEND_COOLDOWN_SECONDS` |
| Login Lockout Threshold | 5 failures | — |
| Lockout Duration | 15 min | — |

**Lockout Key**: Canonical email in `login_attempts` collection. Company + personal email map to same employee → shared lockout.

### 9.5 Public Token Routes (No JWT)

| Route | Frontend | Purpose |
|-------|----------|---------|
| `GET /api/invitations/{token}` | `/invite/[token]` | Accept invite, register |
| `GET|POST /api/it-provisioning/{token}` | `/it-setup/[token]` | IT setup, encrypted password |
| `GET|POST /api/it-provisioning/batch/{token}` | `/it-setup/batch/[token]` | Batch provisioning |
| `GET|POST /api/it-service-requests/public/{token}` | `/it-support/[token]` | Employee IT request |

### 9.6 Super Admin Login

**Route**: `/portal-root-x9f3` (hardcoded in `proxy.js` `PUBLIC_PATHS`).
- Deliberately unguessable, unlinked from public UI.
- Never rename without explicit request.
- Only accessible via direct navigation or invitation email.

---

## 10. Authorization & RBAC

### 10.1 Shared Dependencies (`security.py`)

```python
# Import these — never redeclare locally
RequireUser = Annotated[CurrentUser, Depends(require_roles("super_admin", "recruiter", "candidate", "employee"))]
RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]
RequireAny = Annotated[CurrentUser, Depends(require_roles("employee", "recruiter", "super_admin"))]
RequireOnboardingSelf = Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))]
```

### 10.2 Capability Dependencies

```python
# Always pair with role check!
require_capabilities("learning")  # alone does NOT block candidate/employee

# Correct pattern:
RequireRecruiterWithLearning = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("learning")),
]
```

### 10.3 RequireCandidate Naming Gotcha

| Router | Alias | Actual Check |
|--------|-------|--------------|
| `offers.py` | `RequireCandidate` | `require_roles("candidate", "super_admin")` |
| `employees.py` | `RequireCandidate` | `RequireOnboardingSelf` → `require_permissions("onboarding.self")` |

**Never assume interchangeable.** Use explicit names for new code.

### 10.4 Audit on Deny

`_audit_denied(user, permission, detail)` in `security.py` writes to `audit_logs` for:
- Permission failures (`require_permissions`)
- Capability failures (`require_capabilities`)
- Recruiter actions (create, update, delete)

---

## 11. Multi-Tenancy

### 11.1 Tenant Field Rules

- **Field**: `organization_id` on all tenant-scoped collections.
- **Population**: `get_current_user` attaches `organization_id` + `organization_name` to `CurrentUser`.
- **Indexing**: Created in `create_database_indexes()` for hot collections.
- **Rule**: Every list/search **must** filter by `organization_id` (or scope helper). Missing filter = critical bug.

### 11.2 Scope Helpers (`organization_service.py`)

| Helper | Returns | Use Case |
|--------|---------|----------|
| `recruiter_scope(user)` | Filter dict | Org-scoped records (no legacy) |
| `recruiter_people_scope(user)` | Filter dict | People queries including legacy rows |
| `recruiter_can_access(user, record)` | Bool | Single-record access check |
| `recruiter_can_access_record(user, record)` | Bool | + legacy owner check |
| `organization_record_scope(org_id, legacy_field?)` | Filter dict | Generic org + optional legacy |

**`recruiter_people_scope` Logic**:
```python
# super_admin: {}
# recruiter with org: $or[ {organization_id: org_id}, {recruiter_id: {$in: org_recruiters}} ]
# recruiter without org: {recruiter_id: user.id}
```

### 11.3 Organization Modules

| Module Key | Controls |
|------------|----------|
| `overview` | Dashboard summary |
| `candidates` | Candidate pipeline |
| `invite` | Create invitations |
| `employees` | Employee directory |
| `talent` | Talent management |
| `learning` | Learning admin |
| `org_config` | Organization framework |
| `assistant` | AI agent access |
| `messages` | HR threads |
| `announcements` | Announcements CRUD |
| `it` | IT provisioning/requests |
| `reporting` | Analytics/reports |
| `profile` | Recruiter profile |
| `support` | Tickets |

**Default**: All `True` (`DEFAULT_ORG_MODULES`).

### 11.4 Purge Flow

```python
# Super Admin only, irreversible
result = await purge_organization(organization_id)
# Returns: {deleted_counts: {...}, summary: "..."}
```

Deletes: recruiters, candidates, employees, invitations, auth users, refresh tokens, offers, IT, learning, documents, agent conversations, audit logs, org-framework, announcements, notifications, tickets, HR threads.

---

## 12. Database Design

### 12.1 Collections by Domain (65+ Total)

| Domain | Collections |
|--------|-------------|
| **Identity & Access** | `users`, `recruiters`, `candidates`, `employees`, `super_admins`, `pending_users`, `organizations`, `roles`, `permissions`, `refresh_tokens`, `login_attempts`, `otp_verifications`, `company_email_password_otps`, `invitations` |
| **Hiring & Onboarding** | `offer_letters`, `documents`, `it_provisioning_batches`, `it_provisioning_requests`, `it_kits`, `audit_logs` |
| **Learning** | `learning_courses`, `learning_enrollments`, `learning_assignments`, `learning_certificates`, `learning_skill_gaps`, `learning_skill_assessments`, `learning_ai_recommendations`, `learning_catalog_cache`, `learning_providers`, `learning_role_matches`, `learning_career_goals`, `learning_bookmarks`, `learning_import_history`, `learning_recruiter_profile_cache`, `employee_skills` |
| **Career & Org Framework** | `career_tracks`, `career_levels`, `employee_career_assignments`, `employee_career_events`, `org_framework_departments`, `org_framework_roles`, `org_framework_skills`, `org_framework_courses`, `org_framework_certifications`, `org_framework_promotion_rules`, `org_framework_roadmaps`, `org_framework_versions`, `org_taxonomy` |
| **Talent** | `talent_competency_evaluations`, `talent_development_plans`, `internal_opportunities`, `internal_opportunity_applications` |
| **AI Agent** | `agent_conversations` |
| **Support & Comms** | `tickets`, `ticket_replies`, `ticket_activity`, `ticket_audit_logs`, `it_service_requests`, `hr_threads`, `notifications`, `announcements`, `org_email_templates` |
| **Ops** | `audit_logs`, `counters`, `migrations`, `universities` |

### 12.2 Key Indexes (Created via `_ensure_index`)

| Collection | Indexes |
|------------|---------|
| `users` | unique `email`, `original_email`, `status` |
| `recruiters` | unique `email`, sparse unique `supabase_user_id`, `organization_id` |
| `candidates` | `email`, `organization_id`, `recruiter_id`, sparse unique `user_id`/`invitation_token`/`supabase_user_id` |
| `employees` | `email`, `organization_id`, unique sparse `employee_id`, `iban_hash`, `job_title` |
| `offer_letters` | `candidate_id`, `status+recruiter`, `email`, `invitation_token` |
| `documents` | `owner+active`, `owner+doc_type`, `status` |
| `it_provisioning_requests` | unique `token`, `offer_id+candidate_id+status`, `expires_at` |
| `learning_courses` | unique `course_key`, partial unique `external_id+provider_id` |
| `notifications` | `recipient+created/read` |
| `agent_conversations` | unique `session_id`, `user+updated` |

### 12.3 Encryption at Rest

**Fields**: `account_number`, `iban`, `swift_code`, IT temp passwords, provider API secrets.

**Mechanism**: Fernet via `BANKING_ENCRYPTION_KEY` (or derived from `SECRET_KEY`).

**IBAN Uniqueness**: `iban_hash = sha256(iban)` stored at `employees.onboarding.employment.iban_hash` with unique sparse index.

**Rules**:
- Never log/print decrypted fields.
- Decrypt only in designated service methods (`employee_service.get_banking_details`).
- API responses return masked values (`****1234`).

### 12.4 DNS Shim

`database.py` forces `mongodb+srv://` resolution via `8.8.8.8` / `1.1.1.1` (some networks block SRV). Do not remove.

---

## 13. API Reference

### 13.1 Router Inventory

| Router | Prefix | Auth |
|--------|--------|------|
| `auth.py` | `/api/auth` | Mixed public + authenticated |
| `invitations.py` | `/api/invitations` | Recruiter + `invite` cap; `GET /{token}` public |
| `offers.py` | `/api/offers` | Recruiter+`invite` / local `RequireCandidate` |
| `onboarding.py` | `/api/onboarding` | `onboarding.self` permission |
| `employees.py` | `/api/employees` | Recruiter caps `employees`/`candidates`; self via `RequireOnboardingSelf` |
| `documents.py` | `/api/documents` | Recruiter+`candidates`; self roles |
| `learning.py` | `/api/learning` | Recruiter+`learning`; employees; shared reads |
| `talent.py` | `/api/talent` | Recruiter+`talent`; employee self |
| `career_framework.py` | `/api/career-framework` | Recruiter (employee reads as wired) |
| `organization_framework.py` | `/api/org-framework` | Recruiter / roles with org |
| `it_provisioning.py` | `/api/it-provisioning` | Recruiter+`it`; **public token routes** |
| `it_service_requests.py` | `/api/it-service-requests` | Recruiter+`it`; employee; **public token** |
| `messages.py` | `/api/messages` | Recruiter+caps / employee |
| `dashboard.py` | *(no prefix)* | Role-dependent |
| `agent.py` | `/api/agent` | Authenticated role tools |
| `tickets.py` | `/api/tickets` | `RequireRecruiter` |
| `admin_tickets.py` | `/api/admin/tickets` | `super_admin` |
| `super_admin.py` | `/api/super-admin` | `super_admin` |
| `email_templates.py` | `/api/email-templates` | Recruiter (+ capability as wired) |
| `rbac.py` | `/api/rbac` | Authenticated (`/me`, `/catalog`) |
| `universities.py` | `/api/universities` | Public search |

### 13.2 Dashboard Routes (`dashboard.py` — No Prefix)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/dashboard/summary` | Role-dependent |
| GET | `/api/dashboard/activity` | Role-dependent |
| GET | `/api/dashboard/candidate` | Candidate/Recruiter |
| GET | `/api/notifications` | Any authenticated |
| PUT | `/api/notifications/read` | Any authenticated |
| GET | `/api/search` | Recruiter |
| GET|POST|PUT|DELETE | `/api/announcements` | Recruiter caps |
| GET|PUT | `/api/recruiters/me` | Recruiter |
| POST | `/api/dashboard/recruiter-mascot/brief` | Recruiter+`assistant` |

### 13.3 Agent Routes (`/api/agent`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Main agent interaction |
| GET | `/sessions` | List conversation sessions |
| GET | `/history` | Get session history |
| POST | `/reset` | Clear session |
| POST | `/recruiter/bulk-invite` | Agent-assisted bulk invite |

---

## 14. Integrations

### 14.1 SMTP (Email)

| Setting | Description |
|---------|-------------|
| `SMTP_HOST` / `SMTP_PORT` | Server |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | Credentials (spaces auto-stripped) |
| `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` | Sender |
| `MAIL_USE_TLS` / `MAIL_USE_SSL` | Encryption |
| `EMAIL_LOGO_URL` | Branding |

**Templates**: ~23 keys in `org_email_templates` (invite, offer, OTP, reminder, announcement, etc.). Org overrides via Super Admin.

**Link Builders** (on `settings`):
- `invitation_link(token)`
- `it_provisioning_link(token)`
- `it_provisioning_batch_link(token)`
- `it_service_request_link(token)`

### 14.2 Cloudinary (Primary Storage)

| Setting | Description |
|---------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloud name |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Credentials |
| `CLOUDINARY_FOLDER` | Default `talent` |

**Service**: `storage_service.py`
- `get_upload_signature(folder, resource_type)` → signed upload params
- `get_signed_url(public_id, expires=SIGNED_URL_EXPIRE_SECONDS)` → private download
- `delete_asset(public_id)` → cleanup

**Used By**: Documents, offer signatures, profile photos, ticket attachments, certificates.

### 14.3 LLM (OpenRouter / OmniRoute / Gemini)

| Setting | Description |
|---------|-------------|
| `OPENROUTER_API_KEY` | Primary Bearer token |
| `OPENROUTER_BASE_URL` | Default: OpenRouter; Docker: `http://omniroute:20128/v1/chat/completions` |
| `OPENROUTER_MODEL` | e.g., `openrouter/free` |
| `OPENROUTER_MAX_TOKENS` | Default 4096 |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_BASE_URL` | Fallback |

**Client**: `llm_service.call_llm_json(prompt)` → strict JSON parsing/salvage.

### 14.4 Coursera

- **Endpoint**: `https://api.coursera.org/api/courses.v1`
- **Cache**: In-process + `learning_catalog_cache` (snapshot ID)
- **Refresh**: Background job (6h interval, non-DEBUG)

### 14.5 Microsoft Learn

- **Endpoint**: `https://learn.microsoft.com/api/catalog/`
- **Cache**: In-process TTL ~6h
- **Redirect**: Employee "open on MS Learn" → `learn.microsoft.com`

### 14.6 Redis (Config-Only)

- `REDIS_URL` required by Settings.
- **No client usage** — service exists for container env resolution only.

### 14.7 Supabase (Optional)

- Client created in `database.py` only when `SUPABASE_URL` + `SUPABASE_KEY` set.
- Legacy/alternate storage; Cloudinary is primary.

### 14.8 Feature Flags

| Flag | Default | Service |
|------|---------|---------|
| `ENABLE_OCR` | `True` | `ocr_service`, `document_extraction_service` |
| `ENABLE_EMBEDDINGS` | `False` | `embedding_service` (BGE) |
| `ENABLE_AI_COACH` | `True` | Legacy coach (indexes retained) |

---

## 15. Getting Started

### 15.1 Prerequisites

- Node.js ≥ 20 (Next.js 16 / React 19 compatible)
- Python ≥ 3.11
- MongoDB 7+ (live URI required — **no mock mode**)
- Optional: Redis, Cloudinary, Supabase, OpenRouter/Gemini API keys, SMTP

### 15.2 Backend (Local)

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env              # Fill all required vars
# CRITICAL: JWT_SECRET must be ≥32 chars, not a placeholder
python -c "import secrets; print(secrets.token_urlsafe(64))"

uvicorn app.main:app --reload --port 8000
```

### 15.3 Frontend (Local)

```bash
cd frontend
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

### 15.4 First Login

```bash
# Backend must be running
cd backend
python -m scripts.seed_super_admin
# Follow prompts → creates first Super Admin
# Sign in at http://localhost:3000/portal-root-x9f3
```

### 15.5 Docker (Full Stack)

```bash
# From repo root
docker compose up --build

# Seed Super Admin
docker compose exec backend python -m scripts.seed_super_admin
```

**Services**:
| Service | Port | Purpose |
|---------|------|---------|
| `mongo` | 27017 | MongoDB 7 |
| `redis` | 6379 | Satisfies `REDIS_URL` |
| `omniroute` | 20128 | Local LLM gateway |
| `backend` | 8000 | FastAPI |
| `frontend` | 3000 | Next.js |

**Production**: `docker-compose.prod.yml` + `nginx/nginx.conf`.

### 15.6 Startup Lifespan (Automatic)

On every backend boot:
1. `create_database_indexes()` — all collections
2. `migrate_employee_ids_to_emp_format()` — legacy ID migration
3. `seed_rbac_collections()` — roles/permissions mirror
4. `seed_org_taxonomy()` — reference data
5. `seed_universities()` — autocomplete catalog
6. `seed_learning_providers()` — Coursera/MS Learn/generic
7. `create_default_organization_if_needed()` — dev org
8. `coursera_service.load_persisted_cache()` + `start_background_refresh()` (non-DEBUG)

---

## 16. Environment Variables

### 16.1 Backend (`backend/.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `SECRET_KEY` | Yes | Base secret |
| `JWT_SECRET` | Yes | **Validated at import** — <32 chars or placeholder crashes boot |
| `JWT_ALGORITHM` | Yes | e.g., `HS256` |
| `ACCESS_TOKEN_EXPIRE` | Yes | Minutes (e.g., 30) |
| `JWT_EXPIRE_MINUTES` | Yes | Refresh expiry (e.g., 10080 = 7d) |
| `MONGODB_URI` | Yes | `mongodb+srv://...` or `mongodb://...` |
| `DATABASE_NAME` | Yes | DB name |
| `REDIS_URL` | Yes | Required by Settings (no client yet) |
| `ALLOWED_ORIGINS` | Yes | Comma-separated; first builds links |
| `SMTP_HOST` | Yes | |
| `SMTP_PORT` | Yes | |
| `SMTP_USERNAME` | Yes | |
| `SMTP_PASSWORD` | Yes | Spaces stripped |
| `SMTP_FROM_EMAIL` | Yes | |
| `SMTP_FROM_NAME` | Yes | |
| `MAIL_USE_TLS` | Yes | `true`/`false` |
| `MAIL_USE_SSL` | Yes | `true`/`false` |
| `FRONTEND_URL` | Yes | e.g., `http://localhost:3000` |
| `BACKEND_URL` | Yes | e.g., `http://localhost:8000` |
| `CLOUDINARY_CLOUD_NAME` | Optional | |
| `CLOUDINARY_API_KEY` | Optional | |
| `CLOUDINARY_API_SECRET` | Optional | |
| `CLOUDINARY_FOLDER` | Optional | Default `talent` |
| `SUPABASE_URL` | Optional | |
| `SUPABASE_KEY` | Optional | |
| `SUPABASE_BUCKET` | Optional | |
| `OPENROUTER_API_KEY` | Optional | Without LLM key → agent falls back |
| `OPENROUTER_MODEL` | Optional | |
| `OPENROUTER_BASE_URL` | Optional | |
| `OPENROUTER_MAX_TOKENS` | Optional | Default 4096 |
| `GEMINI_API_KEY` | Optional | Fallback |
| `GEMINI_MODEL` | Optional | |
| `GEMINI_BASE_URL` | Optional | |
| `ENABLE_OCR` | Optional | Default `true` |
| `OCR_LANG` | Optional | Default `eng` |
| `OCR_USE_GPU` | Optional | Default `false` |
| `ENABLE_EMBEDDINGS` | Optional | Default `false` |
| `EMBEDDING_MODEL` | Optional | |
| `BANKING_ENCRYPTION_KEY` | Optional | Fernet; derived from `SECRET_KEY` if unset |
| `IT_MANAGER_EMAIL` | Optional | |
| `IT_PROVISIONING_EXPIRE_DAYS` | Optional | Default 30 |
| `OFFER_EXPIRE_DAYS` | Optional | Default 7 |
| `OTP_EXPIRE_MINUTES` | Optional | Default 10 |
| `OTP_MAX_ATTEMPTS` | Optional | Default 5 |
| `OTP_RESEND_COOLDOWN_SECONDS` | Optional | Default 60 |
| `INVITATION_EXPIRE_HOURS` | Optional | Default 168 |

### 16.2 Frontend (`frontend/.env.local`)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | Backend base, no trailing slash |

---

## 17. Testing & Validation

### 17.1 Backend

```bash
cd backend

# Syntax/import check (fast)
python -m py_compile app/main.py app/api/<touched>.py app/services/<touched>.py

# Full test suite
pytest

# Run specific test file
pytest tests/test_authorization_audit.py -v

# Check OpenAPI spec
uvicorn app.main:app --port 8001 &
curl http://localhost:8001/openapi.json | jq '.paths | keys'
```

**Pytest Coverage**:
- Agent support-ticket tools
- Authorization/audit behavior
- Banking-endpoint security
- Career-framework logic
- JWT token typing
- Org-wide recruiter access scoping
- Profile/email flows
- Provider support
- Search taxonomy

**Note**: Record pre-existing failures before changes.

### 17.2 Frontend

```bash
cd frontend

npm run lint      # ESLint (Next.js core-web-vitals)
npm run build     # Production build (typecheck + compile)
```

No automated test suite yet; lint + build are the gates.

### 17.3 Critical Regression Areas

| Area | Why Critical |
|------|--------------|
| Auth token typing | Refresh token replay vulnerability |
| Capability + role composition | Over-permissioning recruiters |
| Tenant isolation | Cross-org data leak |
| Banking encrypt/mask | PII exposure |
| Offer signing gate | Bypassing signed offer requirement |
| Agent confirm flow | Unconfirmed destructive actions |

### 17.4 Operational Scripts (`backend/scripts/`)

| Script | Purpose |
|--------|---------|
| `seed_super_admin.py` | Bootstrap first Super Admin |
| `backfill_dual_role_recruiters.py` | Dual-role recruiter migration |
| `reconcile_dual_role_profiles.py` | Profile sync reconciliation |
| `verify_dual_role.py` | Verify dual-role integrity |
| `backfill_org_scoping.py` | Add `organization_id` to legacy rows |
| `backfill_organization_tenancy.py` | Tenancy backfill |
| `migrate_providers.py` | Learning provider migration |
| `check_career_data.py` | Career framework sanity |
| `test_api_endpoints.py` | Manual e2e (not pytest) |
| `test_learning_ai.py` | Learning AI manual test |
| `test_openrouter.py` | LLM connectivity test |
| `e2e_import_single_course_test.py` | Course import test |
| `e2e_step2_backfill_match_test.py` | Backfill matching test |

---

## 18. Security

| Control | Implementation |
|---------|----------------|
| **JWT Secret Validation** | Crashes boot if <32 chars or placeholder |
| **Typed Tokens** | `type="access"` required; refresh rejected on API |
| **Password Hashing** | bcrypt via passlib (cost 12) |
| **Account Lockout** | 5 failures → 15min lockout (`login_attempts`) |
| **Encryption at Rest** | Fernet for banking, IT passwords, provider secrets |
| **IBAN Uniqueness** | `iban_hash` (SHA-256) + unique sparse index |
| **Hidden SA Path** | `/portal-root-x9f3` unlinked, unguessable |
| **Token Secrecy** | OTP, invite, IT tokens never exposed via agent |
| **Tenant Isolation** | Every list filters by `organization_id` |
| **Audit Trail** | `audit_logs` for authz failures + recruiter actions |
| **Signed File Access** | Cloudinary signed URLs + ownership/org verify |
| **Agent Hard-Scoping** | Same RBAC chain as REST; no bypass possible |
| **CORS** | `allow_origins=["*"]`, `allow_credentials=False` (intentional for stage) |
| **Provider Secrets** | Stored encrypted (`api_key_enc`); never returned on test |

---

## 19. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No ORM** | Direct Motor access keeps queries explicit; Pydantic validates at API boundary |
| **RBAC in Code** | `roles`/`permissions` collections are seeded mirrors; code is source of truth |
| **Agent = Service Client** | Every tool calls service functions; same RBAC as REST; auditable |
| **Row-Level Tenancy** | Single MongoDB, `organization_id` per doc; simpler ops, but every query must scope |
| **Optional Deps Degrade** | OCR/embeddings/LLM lazy-import; platform works without them |
| **Large Services OK** | `learning_service.py`, `agent_tools*.py`, `employee_service.py` are intentional monoliths |
| **Tool Split Intentional** | `agent_tools.py` (core) vs `agent_tools_parity.py` (dashboard parity) — do not merge |
| **No Shared Types** | Frontend/backend contracts mirrored manually; drift fails at runtime |

---

## 20. Deployment Architecture

### 20.1 Docker Compose (Local)

```yaml
services:
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [mongo_data:/data/db]
  
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  
  omniroute:
    image: omniroute:latest
    ports: ["20128:20128"]
  
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: ./backend/.env
    depends_on: [mongo, redis, omniroute]
  
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    env_file: ./frontend/.env.local
    depends_on: [backend]
```

### 20.2 Production Overlay (`docker-compose.prod.yml`)

- Removes port mappings (internal networking)
- Adds resource limits
- Enables nginx gateway
- Uses production env files

### 20.3 Nginx Gateway (`nginx/nginx.conf`)

- TLS termination
- Rate limiting
- Static asset caching
- Proxy to backend/frontend

### 20.4 Environment Strategy

- **Local**: `backend/.env`, `frontend/.env.local`
- **Docker**: Root `.env` (compose overrides only)
- **Secrets**: Never committed; injected via CI/CD or Docker secrets

---

## 21. Monitoring & Observability

### 21.1 Logging

- **Backend**: `loguru` structured JSON logs (level: INFO default)
- **Frontend**: Console + `react-toastify` for user-facing errors
- **Audit**: `audit_logs` collection for security events

### 21.2 Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| API latency (p95) | FastAPI middleware | >2s |
| Auth failure rate | `login_attempts` | >10% |
| Mongo connection pool | Motor | >80% |
| Agent fallback rate | `agent_conversations` | >50% |
| Email queue depth | `email_service` | >100 |
| Coursera sync failures | `coursera_service` | Any |

### 21.3 Health Checks

- `GET /health` (backend) — Mongo, Redis, LLM connectivity
- `GET /api/rbac/me` — Auth validity

---

## 22. Extensibility Points

### 22.1 Adding a New Domain Module

1. **Schema**: `backend/app/schemas/<domain>.py` — request/response models
2. **Service**: `backend/app/services/<domain>_service.py` — business logic
3. **Router**: `backend/app/api/<domain>.py` — thin endpoints with `Require*` deps
4. **Register**: Add `app.include_router(<domain>.router)` in `main.py`
5. **Indexes**: Add `_ensure_index` calls in `create_database_indexes()`
6. **Frontend Service**: `frontend/services/<domain>Service.js` — axios wrapper
7. **Pages**: `frontend/app/dashboard/{role}/<domain>/page.js`
8. **Agent Tool** (if needed): Add to `agent_tools*.py` + role list + `READONLY_TOOLS`

### 22.2 Adding an Agent Tool

1. Implement in correct `agent_tools*.py` calling a service function
2. Register in appropriate role list (`RECRUITER_TOOLS`, etc.)
3. If read-only, add name to `READONLY_TOOLS` in `agent_service.py`
4. If destructive, set `needs_confirm=True`

### 22.3 Adding a Learning Provider

1. Add provider type to `learning_providers` schema
2. Implement sync in `learning_service.py` (mirror Coursera/MS Learn pattern)
3. Add encrypted config fields for API secrets
4. Register in provider factory

### 22.4 Adding an OCR Extractor

1. Add extractor function in `document_extraction_service.py`
2. Register in `EXTRACTOR_MAP` keyed by `doc_type`
3. Ensure lazy import of heavy libs

---

## 23. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend crashes on boot: `ValueError: JWT_SECRET` | `<32 chars` or placeholder (`secret`, `changeme`, `test`, `password`) | Generate: `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| Backend won't start | No live `MONGODB_URI` | Provide valid MongoDB connection string |
| Mongo hangs on `mongodb+srv://` | SRV lookup blocked by network | Verify `database.py` DNS shim (8.8.8.8/1.1.1.1) intact |
| New public page → 302 `/login` | Route missing from `proxy.js` `PUBLIC_PATHS` | Add to `PUBLIC_PATHS` or `PUBLIC_EXTENSIONS` |
| Agent returns generic status answers | No LLM keys configured | `_fallback_reply` is expected behavior; add `OPENROUTER_API_KEY` or `GEMINI_API_KEY` |
| UI shows stale/wrong data | Backend schema + `services/*.js` + component not updated together | No shared codegen — mirror all three |
| Redis errors in containers | `REDIS_URL` required but no client | Expected — service exists for env resolution only |
| `RequireCandidate` permission denied | Using wrong alias (offers vs employees) | Check `api.md` — two different predicates |
| Tenant data leak in list endpoint | Missing `organization_id` filter | Use `recruiter_people_scope` or `recruiter_scope` helper |
| OCR not extracting fields | `ENABLE_OCR=false` or libs not installed | Set `ENABLE_OCR=true`; install `easyocr`, `pytesseract`, `pymupdf` |
| Coursera catalog empty | `DEBUG=true` (no background refresh) | Set `DEBUG=false` or call `coursera_service.sync_catalog()` manually |
| `IBAN already exists` on new employee | `iban_hash` collision | Check `employees.onboarding.employment.iban_hash` index |

---

## 24. Roadmap

| Item | Description | Priority |
|------|-------------|----------|
| **CORS Hardening** | Replace `allow_origins=["*"]` with explicit allowlist for production | High |
| **Shared Type Contract** | Generate TypeScript from FastAPI OpenAPI schema → catch drift at build | High |
| **Frontend Test Suite** | Add Vitest/Playwright coverage alongside backend pytest | Medium |
| **Database-per-Tenant Option** | Formal support for isolated DBs per org (beyond row-level) | Medium |
| **Webhook Framework** | Outbound webhooks for offer signed, employee hired, etc. | Low |
| **Advanced Analytics** | Pre-aggregated materialized views for dashboard metrics | Low |
| **Mobile App** | React Native wrapper sharing `services/*.js` logic | Low |

---

## Appendix: Key File References

| Concern | File(s) |
|---------|---------|
| App entry & lifespan | `backend/app/main.py` |
| Configuration | `backend/app/core/config.py` |
| Database & indexes | `backend/app/core/database.py` |
| JWT & auth deps | `backend/app/core/security.py` |
| RBAC definitions | `backend/app/core/rbac.py` |
| Encryption | `backend/app/core/crypto.py` |
| Agent loop | `backend/app/services/agent_service.py` |
| Agent tools | `backend/app/services/agent_tools*.py` |
| LLM client | `backend/app/services/llm_service.py` |
| Frontend auth gate | `frontend/proxy.js` |
| API client | `frontend/lib/apiClient.js` |
| Role shells | `frontend/components/{role}/*Shell.js` |
| Shared hooks | `frontend/hooks/` |
| AI context builders | `frontend/lib/ai/` |

---

*This document is the authoritative technical reference for TalentAI. For AI agent development guidance, see `.agents/AGENTS.md` and `.agents/skills/README.md`. The repository code is always the source of truth over documentation.*