---
name: complete-profile
description: >-
  Employee complete-profile wizard, photo, company-email password OTP reveal,
  and recruiter profile-completion reminders.
scope: employees
related_skills:
  - employees/SKILL
  - employees/banking
  - onboarding/SKILL
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - frontend/app/dashboard/employee/complete-profile/page.js
  - frontend/services/authService.js
---

# Complete profile

## Purpose

Employees finish post-hire profile data (`profile-completion`), manage photo, and (when provisioned) reveal company email password via OTP to personal email.

## Location

- `GET/PUT /api/employees/profile-completion` — `RequireEmployee`
- Schema validate: `EmployeeProfileSaveRequest` in `backend/app/schemas/employee_profile.py`
- `GET /api/employees/me`, photo `POST/DELETE /api/employees/me/photo`
- Company email password: `POST .../me/company-email-password/request-otp`, `.../reveal`
- Recruiter remind: `POST /api/employees/detail/{employee_id}/remind-profile`
- UI: `frontend/app/dashboard/employee/complete-profile/page.js`, `profile/page.js`
- Client: `getProfileCompletion`, `saveProfileCompletion`, `getMyEmployeeProfile`, `uploadEmployeePhoto`, `removeEmployeePhoto`, remind helpers

## Entry Points

1. Employee dashboard prompts incomplete profile → complete-profile page.
2. Save sections via PUT profile-completion.
3. Recruiter detail → remind-profile.
4. OTP reveal for company mailbox password (IT provisioning data).

## Data Flow

```
RequireEmployee
  → EmployeeService.get/save_profile_completion
  → employees.onboarding / profile fields
OTP reveal → it_provisioning_service.request_password_otp / reveal_password
```

## Business Rules

- PUT validates with Pydantic; 422 on errors.
- Remote employees may edit banking inside profile flows; on-site banking is recruiter-owned (see banking skill).
- Photo upload/delete only for active employee role.
- Remind-profile supports `note` and `force`/`resend`.

## Permissions

Self routes: `RequireEmployee` (`employee|super_admin`).
Remind: `RequireRecruiterWithEmployees`.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/employees/me` |
| POST | `/api/employees/me/photo` |
| DELETE | `/api/employees/me/photo` |
| GET | `/api/employees/profile-completion` |
| PUT | `/api/employees/profile-completion` |
| POST | `/api/employees/me/company-email-password/request-otp` |
| POST | `/api/employees/me/company-email-password/reveal` |
| POST | `/api/employees/detail/{employee_id}/remind-profile` |

## Important Files

- `backend/app/schemas/employee_profile.py`
- `backend/app/services/it_provisioning_service.py` (OTP reveal)
- `frontend/app/dashboard/employee/complete-profile/page.js`

## Modification Guide

1. Extend `EmployeeProfileSaveRequest` + service save/get together.
2. Update complete-profile UI + authService.
3. Keep password reveal OTP-bound; never return encrypted secrets without OTP.

## Do Not Break

- Employee-only self routes (candidates must not pass `RequireEmployee`).
- OTP gate on password reveal.
- Remote vs on-site banking ownership.

## Testing

- Employee GET/PUT profile-completion.
- Invalid payload → 422.
- Remind-profile as recruiter with employees capability.
- OTP request + reveal happy path / bad OTP.
- `py_compile` employees + employee_profile schema + it_provisioning service.
