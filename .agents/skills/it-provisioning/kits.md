---
name: it-provisioning-kits
description: >-
  IT kits CRUD under /api/it-provisioning/kits. Reusable asset/license bundles for
  provisioning sends. Capability it.
---

# IT Provisioning — Kits

## Purpose

Recruiter-managed kits (standard laptop/software bundles) used when sending IT provisioning.

## Location

- Routes: `GET/POST /api/it-provisioning/kits`, `PATCH/DELETE /kits/{kit_id}`
- Service: `backend/app/services/it_kit_service.py` (+ provisioning service references)
- Collection: `it_kits`
- Schema: `ItKitCreateRequest`, `ItKitUpdateRequest`
- Frontend: `frontend/app/dashboard/recruiter/it-kits/page.js`; `listItKits`, `createItKit` in `authService.js`

## Entry Points

| Method | Path |
|--------|------|
| GET | `/api/it-provisioning/kits` |
| POST | `/api/it-provisioning/kits` |
| PATCH | `/api/it-provisioning/kits/{kit_id}` |
| DELETE | `/api/it-provisioning/kits/{kit_id}` |

## Data Flow

```
CRUD it_kits (organization scoped)
send provisioning → optional kit_id / kit contents copied onto request
public IT form may show preselected assets from kit
```

## Business Rules

- Kits belong to organization — list/create must not leak other tenants.
- Deleting a kit should not corrupt historical provisioning requests (snapshot contents on send if that is current behavior — preserve it).
- Capability `it` required.

## Permissions

- `RequireRecruiterWithIT`

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/it_provisioning.py`
- `backend/app/services/it_kit_service.py`
- `backend/app/schemas/it_provisioning.py`
- `frontend/app/dashboard/recruiter/it-kits/page.js`
- `frontend/services/authService.js`

## Modification Guide

1. New kit fields: schema + kit service + it-kits UI + send payload if needed.
2. Keep org_id on create and all queries.
3. If send copies kit items, update copy logic when item shape changes.

## Do Not Break

- Org isolation
- Capability `it`
- Historical provisioning rows if kits deleted
- Do not expose kits on public token without intentional product choice

## Testing

- Create/list/patch/delete kit
- Send provisioning referencing kit
- Recruiter without `it` → 403
