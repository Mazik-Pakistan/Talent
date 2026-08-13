# Multi-tenancy

Organizations are the tenant boundary. Recruiters bind to an org; candidates/employees/invitations/offers carry `organization_id`. Super Admin manages orgs and module grants cross-tenant.

```
related_skills: authorization/, authentication/, database/, offers/
```

## Core field: `organization_id`

- Present on people + ops records (recruiters, candidates, employees, invitations, tickets, learning courses, career/org-framework docs, announcements, …).
- Indexed in `create_database_indexes()` for hot collections.
- `CurrentUser.organization_id` / `organization_name` populated in `get_current_user` for recruiter/employee/candidate.

**Rule:** any new list/search aggregation over tenant data **must** scope by organization (or people-scope helper). Missing filter = data leak.

## Org modules

Created/updated via Super Admin (`/api/super-admin/organizations`).

Keys: `ORG_MODULE_KEYS` in `organization_service.py` — `overview`, `candidates`, `invite`, `employees`, `talent`, `learning`, `org_config`, `assistant`, `messages`, `announcements`, `it`, `reporting`, `profile`, `support`.

`DEFAULT_ORG_MODULES` = all `True`.

Effective recruiter access:

```
effective = org.modules ∩ recruiter.capabilities
```

Implemented by `resolve_org_modules` + `effective_capabilities`. Enforced at API via `require_capabilities` **paired with** role checks.

## `recruiter_scope(user)`

Sync Mongo fragment (`organization_service.py`):

| Actor | Filter |
|-------|--------|
| `super_admin` | `{}` (all) |
| `recruiter` with org | `_organization_id_clause(organization_id)` |
| `recruiter` without org | `{ recruiter_id: user.id }` |
| other roles | `{}` |

Use for records that are strictly org-keyed (and do not need legacy backfill).

## `recruiter_people_scope(user)` (async)

Org-wide **people** query including **legacy rows missing `organization_id`** but owned by a recruiter in the same org:

```
$or: [ org_clause, legacy_owner_clause(recruiter_id ∈ org's recruiters) ]
```

Used heavily in `employee_service`, `offer_service`, `talent_service`, `invitation_service`, IT services, etc.

Access helpers:

- `recruiter_can_access` — same-org or personal ownership
- `recruiter_can_access_record` — plus legacy same-org owners
- `organization_record_scope` — optional legacy owner field

Prefer these helpers over hand-rolled `$or` copies.

## Lifecycle binding

1. Super Admin creates organization (+ modules).
2. Recruiter invited/bound with `organization_id` (+ personal capability toggles).
3. Invitations/candidates/employees inherit org from acting recruiter.
4. Org framework collections are keyed solely by `organization_id` (departments/roles/skills/…).

Default org: `create_default_organization_if_needed()` on lifespan so local/dev recruiters can bind.

## Purge

`purge_organization(organization_id)` — destructive wipe of tenant data:

- Recruiters, candidates, employees, invitations for the org (plus legacy recruiter-owned people)
- Auth users / refresh tokens / pending_users / login_attempts for those identities
- Offers, IT requests/batches/kits, HR threads, learning artifacts, documents, notifications, agent conversations, announcements, audit logs, org-framework docs, etc.

Exposed through Super Admin delete flows (`super_admin.py`). Returns a deletion summary dict. **Irreversible** — agent tools must confirm before invoking.

## What is not tenant-scoped

Examples of shared/global data:

- `universities` (seeded catalog)
- `super_admins`
- Some learning provider catalog caches / MS Learn & Coursera live catalogs
- Platform RBAC seed collections

Do not put org secrets into global collections without an org key.

## Agent checklist

1. List endpoints → `recruiter_people_scope` or `recruiter_scope` as appropriate.
2. Single-record mutate → `recruiter_can_access_record` before write.
3. New collection with tenant data → index `organization_id` + filter every read path.
4. Capability changes do not replace org filters — both layers apply.
