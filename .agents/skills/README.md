---
name: skills-index
description: >-
  Index of TalentAI .agents/skills — when to load each module skill, key files,
  relationships, and pointer to .agents/architecture/.
scope: meta
---

# TalentAI skills index

Load the matching skill **before** changing a feature. The repository code is always the source of truth over these docs.

Cross-cutting architecture: [`.agents/architecture/`](../architecture/) (`system-overview.md`, `backend.md`, `frontend.md`, `api.md`, and related). Master instructions: [`.agents/AGENTS.md`](../AGENTS.md). Short field guide: root [`AGENTS.md`](../../AGENTS.md).

## Two product AI systems

| System | Skills | Notes |
|--------|--------|-------|
| **Autonomous agent** | `ai-agent/`, `llm/` | Tool loop, `MAX_TOOL_STEPS=4`, `/api/agent/*`, `/ai-assistant` pages |
| **Floating mascot** | `ai-frontend/` | Tips/insights/OCR chrome — **not** the tool-calling agent |

## How to use

1. Find the domain below → open `SKILL.md`.
2. Open child files only as needed (progressive disclosure).
3. Inspect `primary_files` in the repo before editing.
4. Validate per `testing/` skill.

---

## Skill catalog

### `ai-agent/` — in-app autonomous agent

**When:** Changing `agent_service`, `agent_tools*`, `/api/agent`, confirm flow, or tool lists.

| File | Topic |
|------|--------|
| `SKILL.md` | Overview, APIs, agent vs mascot |
| `agent-loop.md` | `MAX_TOOL_STEPS=4`, prompt, `READONLY_TOOLS`, fallback |
| `tool-registry.md` | core vs **parity** vs **super_admin** split, `run_tool` |
| `confirm-gate.md` | Bulk/destructive `needs_confirm`, `__CONFIRM__:` |
| `role-tool-lists.md` | Role list composition |

**Related:** `ai-frontend/`, `llm/`, `authorization/`

### `ai-frontend/` — mascot & agent UI

**When:** Mascots, `lib/ai` insights, `ai-experience` components, `ai-assistant` pages.

| File | Topic |
|------|--------|
| `SKILL.md` | Two AI surfaces |
| `mascot-insights-context.md` | Per-role context/insights/field help |
| `ai-experience-components.md` | Orb, confirm card, OCR panels |
| `agent-chat-pages.md` | Full-page agent chat + `agentService` |

**Related:** `ai-agent/`, `frontend/`

### `llm/` — OpenRouter / Gemini / learning cache

**When:** `llm_service`, model env vars, learning AI caching.

| File | Topic |
|------|--------|
| `SKILL.md` | `call_llm_json` hub |
| `openrouter-gemini.md` | Primary→fallback, env vars, 402 |
| `learning-ai-cache.md` | Hash caches + invalidate |

**Related:** `ai-agent/agent-loop`, `deployment/`

### `messaging/` — HR threads

**When:** `/api/messages`, `hr_threads`, messages pages.

| File | Topic |
|------|--------|
| `SKILL.md` | Overview + endpoints |
| `hr-threads.md` | Access, close, notify/email |

**Related:** `notifications-announcements/`, `email/`

### `notifications-announcements/`

**When:** Notification center, announcements CRUD/fanout.

| File | Topic |
|------|--------|
| `SKILL.md` | Shared overview |
| `notifications.md` | `create_notification`, poll hook |
| `announcements.md` | Audience, targeting, email |

### `email/` — SMTP + templates

**When:** `email_service`, org template overrides, SMTP env.

| File | Topic |
|------|--------|
| `SKILL.md` | Send path |
| `smtp-templates.md` | Registry keys (~23), transport |

### `tickets/` — support tickets

**When:** Recruiter support or SA admin tickets.

| File | Topic |
|------|--------|
| `SKILL.md` | Dual API surface |
| `recruiter-tickets.md` | `/api/tickets` |
| `admin-tickets.md` | `/api/admin/tickets` |

**Related:** `super-admin/`, `ai-agent/` (SA tools)

### `super-admin/` — platform ops

**When:** Orgs, recruiter caps, **`/portal-root-x9f3`**.

| File | Topic |
|------|--------|
| `SKILL.md` | Platform overview |
| `organizations.md` | Org CRUD + modules |
| `recruiters-capabilities.md` | Invite, caps, templates, clamp |
| `portal-login.md` | Hidden portal + `PUBLIC_PATHS` |

### `dashboard/` — role homes

**When:** Overview/activity/home pages and dashboard APIs.

| File | Topic |
|------|--------|
| `SKILL.md` | Role homes map |
| `recruiter-overview-activity.md` | summary/activity + caps |
| `candidate-employee-homes.md` | Candidate/employee homes |

### `dual-role/` — employee ↔ recruiter

**When:** `switch-role`, shared profile fields, reconcile scripts.

| File | Topic |
|------|--------|
| `SKILL.md` | Dual-role overview |
| `switch-role-profile-sync.md` | Switch + `mirror_profile_fields` |

**Related:** `authentication/jwt-refresh-session`

### `search/` — people search + taxonomy

**When:** `GET /api/search` or `search_taxonomy.py`.

| File | Topic |
|------|--------|
| `SKILL.md` | Two search systems |
| `global-search-taxonomy.md` | Fields, org scope, taxonomy keys |

### `storage/` — Cloudinary

**When:** Uploads, signed URLs, profile photos.

| File | Topic |
|------|--------|
| `SKILL.md` | Storage overview |
| `cloudinary-photos-docs.md` | Env, folders, signing |

### `frontend/` — Next.js infrastructure

**When:** Shells, proxy, apiClient, hooks/toasts.

| File | Topic |
|------|--------|
| `SKILL.md` | FE conventions |
| `shells-nav-proxy.md` | Shells + **`PUBLIC_PATHS`** |
| `services-api-client.md` | axios + `services/*.js` |
| `forms-toasts-hooks.md` | FieldError, toastify, hooks |

### `backend/` — FastAPI layering

**When:** New endpoints, CORS, lifespan seeds.

| File | Topic |
|------|--------|
| `SKILL.md` | Layering; CORS `allow_origins=["*"]` intentional-for-now |
| `routers-services-schemas.md` | Endpoint recipe |
| `lifespan-seeds.md` | Boot seeds + indexes |

### `database/` — Mongo tenancy

**When:** Collections, indexes, tenant filters.

| File | Topic |
|------|--------|
| `SKILL.md` | Motor overview |
| `indexes-tenancy.md` | `_ensure_index`, `organization_id` |

### `security/` — JWT + crypto

**When:** Authz deps, token typing, Fernet fields.

| File | Topic |
|------|--------|
| `SKILL.md` | Security spine; **JWT access vs refresh** |
| `crypto-sensitive-fields.md` | Banking Fernet, `iban_hash` |

### `testing/` — validation

**When:** Verifying any change.

| File | Topic |
|------|--------|
| `SKILL.md` | Harnesses |
| `pytest-frontend-validation.md` | Checklists + commands |

### `debugging/` — sharp edges

**When:** Boot/DNS/CORS/LLM/SMTP/Redis/dual-role failures.

| File | Topic |
|------|--------|
| `SKILL.md` | Debug approach |
| `common-failure-patterns.md` | Symptom→cause (incl. **Redis config-only**) |

### `deployment/` — compose & env

**When:** Docker, env vars, prod nginx.

| File | Topic |
|------|--------|
| `SKILL.md` | Compose overview |
| `docker-compose-env.md` | Ports, env checklist, Redis note |

---

### `authentication/` — login / OTP / JWT / password

**When:** Auth routes, session cookies, OTP, password reset/change.

| File | Topic |
|------|--------|
| `SKILL.md` | Auth overview |
| `login-register-otp.md` | Register, OTP, lockout |
| `jwt-refresh-session.md` | Access vs refresh, persistTokens |
| `password-reset.md` | Forgot/reset/change |

### `authorization/` — RBAC + capabilities

**When:** Permissions, role maps, recruiter module caps, `Require*` deps.

| File | Topic |
|------|--------|
| `SKILL.md` | Authz overview |
| `rbac-permissions.md` | `rbac.py` source of truth |
| `recruiter-capabilities.md` | Org modules ∩ recruiter caps |

### `recruitment/` — invite & pipeline

**When:** Invitations, bulk spreadsheet invite, candidate pipeline/search.

| File | Topic |
|------|--------|
| `SKILL.md` | Hiring entry |
| `invitations.md` | Single invite + required offer |
| `bulk-invite.md` | Template/preview/send + agent upload |
| `pipeline-search.md` | Candidate lists + global search |

### `candidates/` — pre-hire people

**When:** Candidate records, dashboard, historical cycles / reinvite.

| File | Topic |
|------|--------|
| `SKILL.md` | Candidate domain |
| `candidate-dashboard.md` | Candidate home APIs/UI |
| `person-history-reinvite.md` | `people_history` archive/reinvite |

### `offers/` — offer letters

**When:** Offer create/sign/negotiate/approve. **Read RequireCandidate gotcha.**

| File | Topic |
|------|--------|
| `SKILL.md` | Offer overview + gotcha |
| `offer-lifecycle.md` | Statuses, create, approve |
| `negotiation.md` | ≤3 rounds |
| `signing.md` | Sign / signature upload / gate |

### `onboarding/` — pre-hire wizard

**When:** `/onboarding`, save/progress, signed-offer gate.

| File | Topic |
|------|--------|
| `SKILL.md` | Onboarding overview |
| `candidate-wizard.md` | Steps + required keys |
| `progress-autosave.md` | Progress + AI autosave UX |

### `employees/` — post-hire ops

**When:** Convert/activate, complete profile, directory, exit, banking, Day-1.

| File | Topic |
|------|--------|
| `SKILL.md` | Employee domain |
| `convert-activate.md` | Candidate → `EMP-######` |
| `complete-profile.md` | Post-hire completion |
| `directory-exit-career-events.md` | Directory, exit, career timeline |
| `banking.md` | Fernet banking update |
| `day1-assets-orientation.md` | Company email, assets, orientation |

### `documents/` — uploads & verify

**When:** Document upload/list/verify/delete/download.

| File | Topic |
|------|--------|
| `SKILL.md` | Documents overview |
| `upload-verify.md` | Upload + recruiter verify |
| `signed-download.md` | Signed URL download |

### `ocr-extraction/` — OCR / parse / embeddings

**When:** `ENABLE_OCR`, extraction, bank slip, resume embeddings.

| File | Topic |
|------|--------|
| `SKILL.md` | OCR cluster |
| `ocr-pipeline.md` | Lazy OCR path |
| `bank-slip-analysis.md` | Analyze bank slip |
| `embeddings-resume.md` | `ENABLE_EMBEDDINGS` / BGE |

### `learning/` — catalog → career path

**When:** Any `/api/learning` or learning UI (employee or recruiter).

| File | Topic |
|------|--------|
| `SKILL.md` | Learning overview |
| `catalog-coursera-mslearn.md` | Live catalogs |
| `enrollments-progress.md` | Start/progress/my courses |
| `certificates.md` | Upload/verify |
| `skills-skill-gap.md` | Skills + gaps |
| `career-path-recommendations.md` | Path + AI recs (real UIDs only) |
| `designation-readiness.md` | Promotion checklist readiness |
| `assignments-analytics.md` | Recruiter assign/analytics |
| `managed-catalog-providers-import.md` | Managed courses/providers/import |

### `talent/` — internal mobility

**When:** `/api/talent`, talent dashboards. (Deterministic; no LLM in talent_service.)

| File | Topic |
|------|--------|
| `SKILL.md` | Talent overview |
| `skill-matrix-journey.md` | Matrix/journey/achievements |
| `internal-opportunities.md` | Opportunities + apply |
| `competency-development-plans.md` | Eval + plans |
| `talent-search-metrics.md` | Search + metrics |

### `career-framework/` — tracks & levels

**When:** `/api/career-framework` CRUD, assignments, reports.

| File | Topic |
|------|--------|
| `SKILL.md` | Career framework |
| `tracks-levels-assignments.md` | Tracks/levels/assign |
| `promotion-reports.md` | Readiness reports |

### `organization-framework/` — org knowledge base

**When:** `/api/org-framework`, org-config UI, course sync to learning.

| File | Topic |
|------|--------|
| `SKILL.md` | Org framework |
| `departments-roles-skills.md` | Structure CRUD |
| `roadmaps-promotion-rules.md` | Roadmaps + rules |
| `import-export-versions.md` | Excel + versions |
| `course-sync-learning.md` | Sync ↔ learning courses |

### `it-provisioning/` — Day-0 IT setup

**When:** Kits, send/remind, public `/it-setup` tokens, password reveal.

| File | Topic |
|------|--------|
| `SKILL.md` | Provisioning overview |
| `send-public-submit.md` | Send + public submit |
| `kits.md` | IT kits CRUD |
| `bulk-batch.md` | Bulk + batch token |
| `password-reveal-otp.md` | Encrypted temp password + OTP |

### `it-service-requests/` — post-hire IT tickets

**When:** Employee/recruiter IT requests + public fulfill `/it-support`.

| File | Topic |
|------|--------|
| `SKILL.md` | Overview |
| `employee-recruiter-public-fulfill.md` | Full flow |

### `universities/` — autocomplete

**When:** University search during onboarding education step.

| File | Topic |
|------|--------|
| `SKILL.md` | Public `/api/universities/search` |

### `reminders/` — throttled nudges

**When:** Candidate/employee/course reminder emails via `reminder_service`.

| File | Topic |
|------|--------|
| `SKILL.md` | Reminder kinds + 1h throttle |

---

## Module relationships (cheat sheet)

```
proxy.js PUBLIC_PATHS ──► frontend shells ──► services/*.js ──► FastAPI routers
                                                          │
                    ┌─────────────────────────────────────┼──────────────────┐
                    ▼                                     ▼                  ▼
              agent_service (≤4 tools)              domain services      email_service
                    │                                     │
         agent_tools / parity / super_admin               ├─ notifications
                    │                                     ├─ hr_threads
              llm_service (OR→Gemini)                     └─ tickets / learning / …
                    │
         learning_cache_service (hashes)

super_admin (/portal-root-x9f3) ──► organizations ──► capability clamp ──► recruiter nav/tools
dual-role switch-role ◄──► profile_sync_service
storage ──► Cloudinary (docs/photos)
CORS * in main.py = intentional-for-now
Redis in compose = config validation (not app cache client yet)
```

## Key invariants (do not “simplify” away)

- `MAX_TOOL_STEPS = 4`; new read-only tools → `READONLY_TOOLS`
- `agent_tools.py` ≠ merge into parity / super_admin
- `confirm_gate` for bulk/destructive agent tools
- Super Admin login **`/portal-root-x9f3`** (public path, no marketing links)
- JWT **`type=access`** vs **`type=refresh`**
- Tenant `organization_id` on list/search
- Floating mascot ≠ autonomous agent

## Architecture pointer

For system-wide diagrams and layer rules, read:

- [`.agents/architecture/system-overview.md`](../architecture/system-overview.md)
- [`.agents/architecture/backend.md`](../architecture/backend.md)
- [`.agents/architecture/frontend.md`](../architecture/frontend.md)
- [`.agents/architecture/api.md`](../architecture/api.md)
