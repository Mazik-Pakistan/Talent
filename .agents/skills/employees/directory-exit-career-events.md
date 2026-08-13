---
name: directory-exit-career-events
description: >-
  Employee directory list/export, detail profile, exit marking, career events,
  and role assignment.
scope: employees
related_skills:
  - employees/SKILL
  - employees/convert-activate
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - frontend/app/dashboard/recruiter/employees/page.js
  - frontend/app/dashboard/recruiter/employees/[id]/page.js
---

# Directory, exit & career events

## Purpose

Searchable employee directory (US-035), open detail, mark exit to historical, record career events, and assign designation/department from org taxonomy.

## Location

- List: `GET /api/employees`
- CSV: `GET /api/employees/export.csv`
- Detail: `GET /api/employees/detail/{employee_id}` (+ legacy `GET /api/employees/{employee_id}`)
- Exit: `POST /api/employees/{employee_id}/exit`
- Career: `GET/POST /api/employees/{employee_id}/career`
- Role: `PUT /api/employees/detail/{employee_id}/role`
- Reminders: `POST /api/employees/detail/{employee_id}/remind`
- Schemas: `EmployeeExitRequest`, `CareerEventCreateRequest`, `RoleAssignRequest`
- UI: recruiter employees list + `[id]` detail
- Client: `listEmployees`, `exportEmployeesCsv`, `getEmployeeDetail`, `markEmployeeExit`, `listCareerEvents`, `addCareerEvent`, `assignEmployeeRole`

## Entry Points

1. Recruiter Employees nav → filtered directory / CSV.
2. Row open → detail (banking masked rules apply).
3. Exit modal → historical bucket.
4. Career timeline add; role assign from taxonomy.

## Data Flow

```
RequireRecruiterWithEmployees
  → list_employees / export / get_employee_profile(reveal_banking=False default)
  → mark_employee_exit / add_career_event / assign_role
  → org-scoped Mongo employees
```

## Business Rules

- Filters: `q`, `employee_id`, `department`, `job_title`, `status`, `profile_status`, joining range, `history_bucket` in `active|historical|all`, `sort`, pagination.
- Detail path avoids colliding with static segments (`me`, `upload`, `export.csv`).
- Exit moves to historical (resigned/terminated/exited per schema).
- Role assign uses org taxonomy lists.
- Unified remind `kind`: profile | reupload | course | general (via `reminder_service`).

## Permissions

All listed recruiter endpoints: `RequireRecruiterWithEmployees`.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/employees` |
| GET | `/api/employees/export.csv` |
| GET | `/api/employees/detail/{employee_id}` |
| GET | `/api/employees/{employee_id}` (legacy alias) |
| POST | `/api/employees/{employee_id}/exit` |
| GET | `/api/employees/{employee_id}/career` |
| POST | `/api/employees/{employee_id}/career` |
| PUT | `/api/employees/detail/{employee_id}/role` |
| POST | `/api/employees/detail/{employee_id}/remind` |
| PUT | `/api/employees/detail/{employee_id}/company-email` |

## Important Files

- `backend/app/schemas/employee_exit.py`, `backend/app/schemas/career.py`
- `backend/app/services/reminder_service.py`
- `frontend/app/dashboard/recruiter/employees/[id]/page.js`

## Modification Guide

1. Add directory filters in service with org_id.
2. Prefer new subpaths under `/detail/{id}/...`.
3. Keep CSV columns aligned with list filters.
4. Update detail page + authService.

## Do Not Break

- `/detail/` vs EMP-id routing.
- history_bucket semantics.
- Org isolation on list/export.
- Default `reveal_banking=False` on detail GET.

## Testing

- List filters + pagination + CSV download.
- Exit → appears in historical bucket.
- Career event create; role assign validation.
- `py_compile` employees router + employee_service directory/exit/career.
