# API router inventory

All prefixes are as declared on each `APIRouter`. Dashboard routes use **full paths** on the decorator (router has no prefix).

```
related_skills: authentication/, authorization/, offers/, learning/, multi-tenancy/
```

## RequireCandidate naming gotcha

**Same name, different predicates — never swap them.**

| Location | Definition | Meaning |
|----------|------------|---------|
| `backend/app/api/offers.py` | `Depends(require_roles("candidate", "super_admin"))` | Role gate for offer self-service |
| `backend/app/api/employees.py` | `RequireOnboardingSelf as RequireCandidate` → `require_permissions("onboarding.self")` | Permission gate for onboarding/profile self endpoints |
| `backend/app/api/onboarding.py` | Uses `require_permissions("onboarding.self")` inline (no alias) | Same permission as employees alias |

Shared alias for onboarding self: `RequireOnboardingSelf` in `app/core/security.py`. Prefer that name for new code.

## Router table

| File | Prefix / paths | Primary auth |
|------|----------------|--------------|
| `auth.py` | `/api/auth` | Mixed public + authenticated |
| `invitations.py` | `/api/invitations` | Recruiter + `invite` capability; `GET /{token}` public |
| `offers.py` | `/api/offers` | Recruiter+`invite` / local RequireCandidate |
| `onboarding.py` | `/api/onboarding` | `onboarding.self` |
| `employees.py` | `/api/employees` | Recruiter caps `employees`/`candidates`; self via RequireOnboardingSelf |
| `documents.py` | `/api/documents` | Recruiter+`candidates`; self roles |
| `learning.py` | `/api/learning` | Recruiter+`learning`; employees; shared reads |
| `talent.py` | `/api/talent` | Recruiter+`talent`; employee self |
| `career_framework.py` | `/api/career-framework` | Recruiter (+ employee reads as wired) |
| `organization_framework.py` | `/api/org-framework` | Recruiter / roles with org |
| `it_provisioning.py` | `/api/it-provisioning` | Recruiter+`it`; **public token** routes |
| `it_service_requests.py` | `/api/it-service-requests` | Recruiter+`it`; employee; **public token** |
| `messages.py` | `/api/messages` | Recruiter+caps / employee |
| `dashboard.py` | *(no prefix)* full paths below | Role-dependent |
| `agent.py` | `/api/agent` | Authenticated role tools |
| `tickets.py` | `/api/tickets` | `RequireRecruiter` |
| `admin_tickets.py` | `/api/admin/tickets` | `super_admin` |
| `super_admin.py` | `/api/super-admin` | `super_admin` |
| `email_templates.py` | `/api/email-templates` | Recruiter (+ capability as wired) |
| `rbac.py` | `/api/rbac` | Authenticated (`/me`, `/catalog`) |
| `universities.py` | `/api/universities` | Search (used by onboarding) |

## Auth (`/api/auth`)

Notable routes: `POST /register`, `/candidate/register`, `/recruiter/register`, `/switch-role`, `/bootstrap-super-admin`, `/verify-otp`, `/verify-email`, `/resend-otp`, `/resend-verification`, `/login`, `/refresh`, `/forgot-password`, `/reset-password`, `/change-password`, `/logout`.

## Dashboard paths (`dashboard.py`)

No router prefix — paths are absolute:

- `GET /api/dashboard/summary`
- `GET /api/dashboard/activity`
- `GET /api/dashboard/candidate`
- `GET|PUT /api/notifications` (+ `/read`)
- `GET /api/search`
- `GET|POST|PUT|DELETE /api/announcements` (+ `/{id}`)
- `GET|PUT /api/recruiters/me`, photo upload/delete
- `POST /api/dashboard/recruiter-mascot/brief`

## Public token routes (no JWT)

| API | Frontend |
|-----|----------|
| `GET /api/invitations/{token}` | `/invite/[token]` |
| `GET|POST /api/it-provisioning/{token}`, `/batch/{token}`, … | `/it-setup/...` |
| `GET|POST /api/it-service-requests/public/{token}` | `/it-support/[token]` |

Offer/documents/onboarding UIs are public **pages** (proxy allowlist) but still typically call authenticated APIs once the user has a session.

## Agent (`/api/agent`)

- `POST /chat`
- `GET /sessions`, `/history`
- `POST /reset`
- `POST /recruiter/bulk-invite`

## Super-admin (`/api/super-admin`)

Organizations CRUD (incl. purge/delete), recruiter invite/list/update/capabilities/bulk-capabilities, capability templates. Always `require_roles("super_admin")`.

## RBAC & universities

- `GET /api/rbac/me` — role, permissions, effective capabilities
- `GET /api/rbac/catalog`
- `GET /api/universities/search`

## Capability-gated recruiter modules

Examples of `require_capabilities(...)` usage (always pair with `require_roles("recruiter", "super_admin")`):

| Capability key | Example routers |
|----------------|-----------------|
| `invite` | offers, invitations |
| `candidates` | documents (review), employees candidate ops |
| `employees` | employees module |
| `talent` | talent |
| `learning` | learning (recruiter) |
| `it` | it_provisioning, it_service_requests |

Keys list: `ORG_MODULE_KEYS` in `organization_service.py`.

## Agent checklist

1. Confirm prefix + auth deps on the **exact** router file before adding endpoints.
2. Recruiter feature → roles **and** capability Depends.
3. Mirror new paths in the matching `frontend/services/*.js` wrapper.
