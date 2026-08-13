---
name: employees
description: >-
  TalentAI employees domain overview — conversion/activation, complete profile,
  directory/exit/career, banking encryption, Day-1 assets and orientation.
scope: employees
related_skills:
  - employees/convert-activate
  - employees/complete-profile
  - employees/directory-exit-career-events
  - employees/banking
  - employees/day1-assets-orientation
  - offers/offer-lifecycle
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - frontend/app/dashboard/recruiter/employees/page.js
  - frontend/app/dashboard/employee/page.js
---

# Employees (overview)

## Purpose

Post-hire employee records: convert from candidate, directory management, profile completion, encrypted banking, assets/orientation. Always org-scope and capability-gate recruiter routes.

## Location

| Layer | Path |
|-------|------|
| Router | `backend/app/api/employees.py` (`/api/employees`) |
| Service | `backend/app/services/employee_service.py` |
| Crypto | `backend/app/core/crypto.py` (`encrypt_banking_payload`, `decrypt_banking_payload`) |
| Recruiter UI | `frontend/app/dashboard/recruiter/employees/page.js`, `employees/[id]/page.js` |
| Employee UI | `frontend/app/dashboard/employee/page.js`, `complete-profile/page.js`, `profile/page.js` |
| Client | many helpers in `frontend/services/authService.js` |

## Entry Points

1. Recruiter: ready-for-conversion / offer approve → create employee.
2. Employee: `/dashboard/employee`, complete-profile wizard.
3. Recruiter detail: banking, assets, orientation, role, exit, career events.

## Data Flow

```
RequireRecruiterWithEmployees | RequireEmployee | RequireOnboardingSelf
  → EmployeeService
  → Mongo employees (+ career, assets, encrypted onboarding.employment)
```

## Business Rules

- Prefer `/detail/{employee_id}` over bare `/{employee_id}` to avoid collisions with `/me`, `/upload`, `/export.csv`.
- Remote employees manage own banking; on-site = recruiter-managed (`update_employee_banking`).
- Banking fields Fernet-encrypted — never log plaintext.
- **RequireCandidate alias** on upload routes = `RequireOnboardingSelf` (not offers' role gate).

## Permissions

- Recruiter employees module: capability `employees`.
- Self: `RequireEmployee` for `/me`, profile-completion.
- Uploads: `onboarding.self`.

## APIs (real)

See child skills for grouped endpoints under `/api/employees`.

## Important Files

- `backend/app/api/employees.py` — banking Depends gotcha comment
- `backend/app/services/employee_service.py`
- `frontend/components/employee/EmployeeShell.js`

## Modification Guide

1. Add recruiter mutations under `/detail/...` paths.
2. Compose role+capability carefully (see `_require_banking_recruiter`).
3. Keep authService wrappers in sync.
4. Preserve encryption for banking.

## Do Not Break

- Org scoping on directory/export.
- Detail path vs EMP-id collision avoidance.
- Capability `employees` on recruiter writes.
- Banking encryption + remote/on-site ownership rules.

## Testing

- Convert → employee can login at `/dashboard/employee`.
- Directory filters + CSV export.
- Banking update as recruiter for on-site only.
- `py_compile` employees API + employee_service + crypto.
