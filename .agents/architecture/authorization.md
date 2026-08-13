# Authorization

Code-defined RBAC in `backend/app/core/rbac.py`, enforced by FastAPI dependencies in `backend/app/core/security.py`, refined for recruiters by **org modules ∩ personal capabilities**.

```
related_skills: authentication/, multi-tenancy/, api/
```

## Permissions (`PERMISSIONS`)

| Code | Intent |
|------|--------|
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

`ALL_PERMISSIONS` = full set. Mongo `roles`/`permissions` collections are **seeded mirrors** (`rbac_seed.py`) — not authoritative.

## Role → permission maps (`ROLE_PERMISSIONS`)

| Role | Permissions |
|------|-------------|
| `super_admin` | All |
| `recruiter` | recruitment.*, onboarding.manage, documents.review, offers.manage, learning.access, ai.access, reporting.view, profile.view |
| `candidate` | onboarding.self, documents.self, offers.self, profile.view |
| `employee` | onboarding.self, documents.self, offers.self, learning.access, ai.coach, profile.view |

`CurrentUser.permissions` is derived from role only. Capability checks are separate.

## Recruiter capabilities & org modules

Org module keys (`ORG_MODULE_KEYS` in `organization_service.py`):

`overview`, `candidates`, `invite`, `employees`, `talent`, `learning`, `org_config`, `assistant`, `messages`, `announcements`, `it`, `reporting`, `profile`, `support`

**Effective capability** = organization `modules` ∩ recruiter personal `capabilities` (`effective_capabilities`). Legacy recruiters with empty personal caps inherit org defaults (`DEFAULT_ORG_MODULES` all true).

`CurrentUser.has_capability(key)`:

- Non-recruiters → always `True` (role deps must still restrict them).
- Recruiter with no caps dict → `True` (backward compatible).
- Else → `capabilities.get(key, True)`.

**Critical:** `require_capabilities(...)` alone does **not** block candidates/employees (early-return). Always pair with `require_roles("recruiter", "super_admin")` (or use a combined Annotated type). See `backend/tests/test_authorization_audit.py`.

## Dependency helpers

| Helper | Behavior |
|--------|----------|
| `require_permissions(*codes)` | User must have all listed RBAC permissions |
| `require_roles(*roles)` | Active role must be one of |
| `require_capabilities(*caps)` | Recruiter must have **all** listed caps |
| `require_any_capability(*caps)` | Recruiter must have **any** |

Shared aliases (`security.py`): `RequireUser`, `RequireRecruiter`, `RequireEmployee`, `RequireAny`, `RequireOnboardingSelf`.

Prefer shared aliases over copy-pasted Depends. Local composites (role + capability) are fine, e.g. `RequireRecruiterWithInvite` in `offers.py`.

## Endpoint patterns

```python
# Good — role AND capability
RequireRecruiterWithTalent = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("talent")),
]
```

Self-service candidate/employee endpoints use `onboarding.self` / role lists — not recruiter capabilities.

## Audit on deny

`_audit_denied(user, permission, detail)` in `security.py` records denied access attempts (used by permission/capability failures). Do not strip audit when adjusting deps.

Related operational audit: `audit_logs` collection (recruiter actions), ticket audit collections.

## Super Admin

- Role `super_admin` bypasses capability restrictions (`has_capability` → True).
- Platform routes under `/api/super-admin` and `/api/admin/tickets` use explicit `require_roles("super_admin")`.
- Can manage org modules and per-recruiter capability toggles.

## Frontend gates

`frontend/services/rbac.js` reads `localStorage.user` for UI hiding. **UI hide is not security** — backend deps are authoritative. Recruiter nav should respect capability flags returned from `/api/rbac/me` / login payload.

## Agent checklist

1. New recruiter endpoint → `require_roles` **and** `require_capabilities` when module-specific.
2. Never widen `ROLE_PERMISSIONS` or skip capability checks “temporarily”.
3. Remember `RequireCandidate` ambiguity (`api.md`).
4. After authz changes, run/extend `backend/tests/test_authorization_audit.py` patterns.
