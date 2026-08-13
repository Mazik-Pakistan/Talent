---
name: day1-assets-orientation
description: >-
  Day-1 company asset assignment and orientation scheduling on employee detail,
  plus company email recording.
scope: employees
related_skills:
  - employees/SKILL
  - employees/convert-activate
  - employees/directory-exit-career-events
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - backend/app/schemas/onboarding_assignment.py
  - frontend/app/dashboard/recruiter/employees/[id]/page.js
---

# Day-1 assets & orientation

## Purpose

Assign/update/remove company assets and schedule orientation from Day 1 on the recruiter employee detail page; set official company email for org communications.

## Location

- Assets: `POST/PUT/DELETE /api/employees/detail/{employee_id}/assets[/{asset_id}]`
- Orientation: `PUT /api/employees/detail/{employee_id}/orientation`
- Company email: `PUT /api/employees/detail/{employee_id}/company-email`
- Schemas: `AssetAssignRequest`, `AssetUpdateRequest`, `OrientationScheduleRequest`, `CompanyEmailRequest` in `backend/app/schemas/onboarding_assignment.py`
- Service: `assign_asset`, `update_asset`, `remove_asset`, `schedule_orientation`, `set_company_email`
- Client: `assignEmployeeAsset`, `updateEmployeeAsset`, `removeEmployeeAsset`, `scheduleEmployeeOrientation`, `setEmployeeCompanyEmail`
- UI: `frontend/app/dashboard/recruiter/employees/[id]/page.js`
- Related pre-hire IT kits: `backend/app/api/it_provisioning.py` (separate from Day-1 assets)

## Entry Points

1. After conversion, recruiter opens employee detail → Assets / Orientation / Company email panels.
2. CRUD assets; schedule or update orientation session.
3. Set company email for communications (distinct from personal login email).

## Data Flow

```
RequireRecruiterWithEmployees
  → EmployeeService asset/orientation/email mutators
  → embedded arrays/fields on employee document
```

## Business Rules

- Assets are Day-1 company property assignments (not IT provisioning kit tokens).
- Orientation schedule updates are idempotent PUTs.
- Company email validated by `CompanyEmailRequest`.
- Org-scoped employee lookup before mutate.

## Permissions

`RequireRecruiterWithEmployees` on all these routes.

## APIs (real)

| Method | Path |
|--------|------|
| PUT | `/api/employees/detail/{employee_id}/company-email` |
| POST | `/api/employees/detail/{employee_id}/assets` |
| PUT | `/api/employees/detail/{employee_id}/assets/{asset_id}` |
| DELETE | `/api/employees/detail/{employee_id}/assets/{asset_id}` |
| PUT | `/api/employees/detail/{employee_id}/orientation` |

## Important Files

- `backend/app/schemas/onboarding_assignment.py`
- `backend/app/services/employee_service.py`
- Recruiter employee detail page

## Modification Guide

1. Extend asset/orientation schemas + service together.
2. Keep routes under `/detail/{employee_id}/...`.
3. Update detail UI + authService wrappers.
4. Do not confuse with `/api/it-provisioning/*` kit flows.

## Do Not Break

- Capability `employees` gate.
- Separation from IT provisioning public token flows.
- Employee org ownership checks.

## Testing

- Assign → update → delete asset.
- Schedule orientation; update fields.
- Set company email; invalid email → 422.
- Capability off → 403.
- `py_compile` employees API + onboarding_assignment schemas + service methods.
