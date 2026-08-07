# Organization Framework — Implementation & Testing Guide

Enterprise career-structure management for TalentAI (multi-tenant). Recruiters configure the organization **once** (departments, roles, skills, certifications, courses, learning roadmaps, promotion rules) and every employee inherits their roadmap automatically.

Built as an extension of the **Learning** module — nothing in authentication, authorization, onboarding, employees, recruiter, AI assistant, or notifications was touched.

---

## 1. What was built

### New backend service — `backend/app/services/organization_framework_service.py`
All CRUD is scoped by `organization_id` (multi-tenant isolation — data never crosses tenants).

| Entity | MongoDB collection | Operations | Notes |
|---|---|---|---|
| Departments | `org_framework_departments` | list / create / update / delete | duplicate name rejected; rename cascades into roles |
| Roles | `org_framework_roles` | list / get / create / update / delete | `role_id`, `next_role` (promotion chain), `level_number`, `department` |
| Skills | `org_framework_skills` | list / create / update / delete | per-role, proficiency + weight, `skill_id` |
| Certifications | `org_framework_certifications` | list / create / update / delete | mandatory flag, expiration months, `cert_id` |
| Courses | `org_framework_courses` | list / create / update / delete | organization-wide reusable catalog; URL optional |
| Learning Roadmaps | `org_framework_roadmaps` | list / create / update / delete | per-role course order, mandatory flag, `roadmap_id` |
| Promotion Rules | `org_framework_promotion_rules` | list / upsert / delete | min experience, readiness %, manager approval, min skills %, min certs |
| Versions | `org_framework_versions` | list / create snapshot | version history of framework changes |

Plus:
- `get_framework_summary()` — dashboard KPIs (counts + recently updated items).
- `build_export_workbook()` — async XLSX export (7 sheets, styled headers).
- `parse_import_workbook()` — parses an uploaded workbook into structured data.
- `validate_import_data()` — validation report: duplicate departments, duplicate roles, circular promotion hierarchy, missing courses/roles, invalid course IDs, missing departments.
- `apply_import_data()` — applies a validated import (clears current framework, imports fresh, snapshots a version).
- `seed_framework_from_existing()` — POST `/api/org-framework/seed`. Bootstraps the framework from the org's existing **employees / candidates / recruiters** (READ-ONLY over people records — they are never modified). Derives distinct departments + roles from their `department` / `job_title` values, is idempotent (re-running only adds what is missing), and snapshots a version. UI: "Auto-configure from existing employees" (empty state) and "Seed from existing records" (Overview).

### Single source of truth (enforced)
The static fallback lists (`RECRUITER_DEPARTMENTS` / `RECRUITER_DESIGNATIONS`) were **removed** from every dropdown consumer (invite, employees, employee detail, announcements, recruiter profile, learning assign/analytics, OfferComposerModal, EmployeeLearningPanel). All department/role selects now render **only** from the org framework (`/api/org-framework/options`). An empty framework shows empty dropdowns until the recruiter configures or auto-seeds it.

### New backend API — `backend/app/api/organization_framework.py`
Registered in `backend/app/main.py` (import + `app.include_router(...)`). Prefix `/api/org-framework`, all endpoints require the recruiter `learning` capability.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/org-framework/summary` | dashboard KPIs |
| GET/POST/PUT/DELETE | `/api/org-framework/departments[/{name}]` | department CRUD |
| GET/POST/PUT/DELETE | `/api/org-framework/roles[/{role_id}]` | role CRUD |
| GET/POST/PUT/DELETE | `/api/org-framework/skills[/{skill_id}]` | skill CRUD (`?role_name=` filter) |
| GET/POST/PUT/DELETE | `/api/org-framework/certifications[/{cert_id}]` | certification CRUD (`?role_name=` filter) |
| GET/POST/PUT/DELETE | `/api/org-framework/courses[/{course_id}]` | course CRUD |
| GET/POST/PUT/DELETE | `/api/org-framework/roadmaps[/{roadmap_id}]` | roadmap CRUD (`?role_name=` filter) |
| GET/POST/DELETE | `/api/org-framework/promotion-rules[/{role_name}]` | promotion rule upsert/delete |
| GET/POST | `/api/org-framework/versions` | version history / create snapshot |
| GET | `/api/org-framework/export` | download full framework as XLSX (7 sheets) |
| POST | `/api/org-framework/import/validate` | multipart upload → parse + validation report |
| POST | `/api/org-framework/import/apply` | apply a validated import payload |

Error convention: business-rule violations → HTTP `409` / `404` / `422` with a `detail` message the frontend surfaces in toasts.

### New frontend service — `frontend/services/orgFrameworkService.js`
Axios wrapper mirroring `learningService.js` conventions (same base URL, `ngrok-skip-browser-warning` header, `Bearer` token auth). One function per endpoint above.

### New frontend UI — `frontend/app/dashboard/recruiter/learning/OrgFrameworkTab.js` + `OrgFrameworkTab.module.css`
- New tab **"Organization Framework"** added to the Learning page `TABS` array (`page.js`), tab validation lists, and the tab render (`{tab === "org-framework" && <OrgFrameworkTab />}`).
- Layout: left section sidebar (Overview, Departments, Roles, Skills, Courses, Certs, Roadmaps, Promotion) + main content pane.
- **Overview**: 8 KPI cards, version history list, recently-updated feed, **Export Excel** and **Import Excel** buttons. Import flow shows a validation report (errors + warnings + counts) and an "Apply Changes" button.
- **Departments / Roles / Courses / Certs / Promotion**: table/card views with inline add/edit forms and delete.
- **Skills**: chip grid with role + proficiency + weight.
- **Roadmaps**: per-role ordered course lists with add/remove and mandatory toggle.
- Empty state ("Organization Framework Not Configured") when no data exists yet.

### Smoke test — `backend/smoke_test_org_framework.py`
28-assertion end-to-end test of the service layer (CRUD, duplicate rejection, summary, versioning, Excel export → parse → validate → import round trip, deletes). Creates data under a unique `smoketest_org_*` org and cleans it up. **Result: 28 passed, 0 failed.**

---

## 2. Files created / modified

### Created
| File | Purpose |
|---|---|
| `backend/app/services/organization_framework_service.py` | all backend CRUD + Excel import/export + versions |
| `backend/app/api/organization_framework.py` | all `/api/org-framework/*` routes |
| `backend/smoke_test_org_framework.py` | regression smoke test (28 checks) |
| `frontend/services/orgFrameworkService.js` | frontend API wrapper |
| `frontend/app/dashboard/recruiter/learning/OrgFrameworkTab.js` | the new tab UI |
| `frontend/app/dashboard/recruiter/learning/OrgFrameworkTab.module.css` | tab styles (extends platform design tokens) |

### Modified
| File | Change |
|---|---|
| `backend/app/main.py` | imported + registered `org_framework_router` |
| `frontend/app/dashboard/recruiter/learning/page.js` | added `FolderTree` icon import, `org-framework` TABS entry, tab validation in both lists, tab render, `OrgFrameworkTab` import |

---

## 3. Bugs found & fixed during this session

| Bug | Fix |
|---|---|
| `create_roadmap` never generated `roadmap_id` (delete-by-ID failed) | `roadmap_id` now generated with timestamp suffix |
| Skills / certifications created without stable IDs | `skill_id` / `cert_id` generated in create and import paths |
| Corrupted encoding in the service file (single `0x97` byte from a PowerShell append) | file repaired to valid UTF-8 |
| Broken `asyncio_run` helper inside the async app | replaced with proper `async build_export_workbook` |
| Unused lucide imports / missing `useRef` in the tab | cleaned; build passes |

---

## 4. "Unable to reach server" incident — root cause & resolution

**Symptom:** Organization Framework tab showed the toast "Unable to reach the server. Please try again in a moment."

**Diagnosis:** that message is shown by `getApiErrorMessage()` only when `error.response` is undefined — i.e. a true network-level failure. The backend uvicorn process was **completely hung** (even the root `/` endpoint timed out) while still holding port 8000.

**Resolution:**
1. Killed the stuck uvicorn `--reload` process tree (reloader parent + server child + multiprocessing worker).
2. Restarted the backend as a tracked background process (persistent) on `127.0.0.1:8000`.
3. Verified: `openapi.json` returns 200, **19** `/api/org-framework/*` routes live.

**Important operational note:** the backend takes **~75 seconds to boot** — `create_database_indexes` ≈16s plus Coursera catalog hydration ≈56s (19,218 courses from a 17 MB Mongo snapshot). During any startup/reload window, every request fails with exactly this network error. Wait for `INFO: Application startup complete.` before testing.

---

## 5. How to test

### 5.1 Start the backend
```
cd backend
venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Wait ~75 s until startup completes (watch for `Application startup complete`). Verify with:
```
Invoke-WebRequest http://127.0.0.1:8000/openapi.json   # expect 200
```

### 5.2 Start the frontend
```
cd frontend
npm run dev
```
Open `http://localhost:3000` and sign in as a recruiter with the **learning** capability.

### 5.3 Navigate to the feature
`Recruiter Dashboard → Learning → Organization Framework` (tab at the far right of the learning tab bar).

Direct URL: `http://localhost:3000/dashboard/recruiter/learning?tab=org-framework`

### 5.4 Click-through checklist

**Overview**
- [ ] 8 KPI cards render (Departments, Roles, Skills Defined, Courses, Certifications, Learning Paths, Promotion Rules, Employees).
- [ ] **Export Excel** downloads a 7-sheet workbook (`organization_framework.xlsx`): Departments, Career Roles, Skills, Certifications, Course Catalog, Learning Roadmap, Promotion Rules.
- [ ] **Import Excel** — upload an edited/blank workbook; a validation report appears (counts, errors, warnings); valid files show **Apply Changes**.

**Departments**
- [ ] Add (name + optional description), duplicate rejected with toast, Edit, Delete (confirm prompt).

**Roles**
- [ ] Add with department, career level, next role, description; Edit (rename / move department / change level / change next role); Delete.

**Skills**
- [ ] Add skill to a role (proficiency Beginner/Intermediate/Advanced/Expert + weight); Delete.

**Courses**
- [ ] Add a reusable course (name, provider, category, duration, difficulty, optional URL, description); Edit; Delete. The same course is shared across unlimited roles (no duplicates).

**Certs**
- [ ] Add certification to a role with Mandatory toggle + optional expiration; Delete.

**Roadmaps**
- [ ] Add a catalog course to a role with Mandatory toggle; entries ordered; Remove.

**Promotion**
- [ ] Add rule per role: min experience (months), required readiness %, manager approval, min skills %, min certs; Edit; Delete.

### 5.5 Re-run the backend smoke test
```
cd backend
venv\Scripts\python smoke_test_org_framework.py
```
Expect: `RESULT: 28 passed, 0 failed`. Test data is cleaned up automatically.

### 5.6 API spot-check (no UI)
The FastAPI docs list everything: `http://127.0.0.1:8000/docs` → **Organization Framework** tag. All endpoints require `Authorization: Bearer <token>`.

---

## 6. Known limitations / next steps (not yet implemented)

- **Import currently replaces** the whole framework (clear + fresh import + version snapshot). The spec's *diff-based update* (compare current vs imported → Added/Updated/Removed per entity → apply changes) is not yet built.
- The Excel template with example rows is not generated separately — the **Export** button already produces the exact 7-sheet template.
- Role detail drill-down tabs (Skills / Courses / Certs / Promotion / Employees per role) are not yet separate views — each entity is managed in its own section.
- Employee-side automatic roadmap inheritance, skill matrix, promotion readiness calculations, and analytics integration are follow-up work that can consume this framework.
