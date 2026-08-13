---
name: banking
description: >-
  Encrypted employee payroll banking — recruiter-managed on-site updates vs
  remote self-serve; FastAPI Depends composition gotcha.
scope: employees
related_skills:
  - employees/SKILL
  - employees/complete-profile
  - onboarding/candidate-wizard
primary_files:
  - backend/app/api/employees.py
  - backend/app/services/employee_service.py
  - backend/app/core/crypto.py
  - backend/app/schemas/invitation.py
---

# Employee banking

## Purpose

Store payroll banking (IBAN etc.) encrypted at rest. On-site: recruiter updates via detail API. Remote: employee manages in complete profile / onboarding employment — recruiter update rejected.

## Location

- Recruiter update: `PUT /api/employees/detail/{employee_id}/banking`
- Payload type: `OnboardingEmploymentInfo` from `backend/app/schemas/invitation.py`
- Auth dependency: `_require_banking_recruiter` in `employees.py` (roles + capability `employees` in one dependency)
- Service: `EmployeeService.update_employee_banking`, decrypt on `get_employee_profile` / profile completion
- Crypto: `encrypt_banking_payload`, `decrypt_banking_payload`, `iban_fingerprint` in `backend/app/core/crypto.py`
- Client: `updateEmployeeBanking` in `authService.js`
- Key: `BANKING_ENCRYPTION_KEY` (or derived from `SECRET_KEY`) in settings

## Entry Points

1. Recruiter employee detail → banking form (on-site).
2. Remote employee complete-profile banking section.
3. Activation may notify recruiter `banking_required` for on-site hires.

## Data Flow

```
OnboardingEmploymentInfo
  → encrypt_banking_payload → employees.onboarding.employment
Read paths decrypt with mask=True|False based on remote + reveal_banking flags
```

## Business Rules

- Remote employee: recruiter `update_employee_banking` returns error directing to Complete Profile.
- On-site: recruiter manages; employee may view read-only as implemented.
- Never log or return plaintext outside decrypt helpers.
- IBAN validated (Pakistani `IBAN_PATTERN` in invitation schemas).
- **Depends gotcha:** do not stack `require_roles` + `require_capabilities` as two entries in one `Annotated` — FastAPI keeps only the last; banking uses a combined dependency for this reason.

## Permissions

Banking PUT: recruiter|super_admin AND employees capability (via `_require_banking_recruiter`).
Self profile paths: `RequireEmployee`.

## APIs (real)

| Method | Path | Notes |
|--------|------|-------|
| PUT | `/api/employees/detail/{employee_id}/banking` | Recruiter on-site |
| GET | `/api/employees/detail/{employee_id}` | Banking masked unless rules allow |
| GET/PUT | `/api/employees/profile-completion` | Remote self-serve fields |

Related OCR: `POST /api/documents/analyze-bank-slip` (documents router).

## Important Files

- `backend/app/api/employees.py` (`_require_banking_recruiter` docstring)
- `backend/app/core/crypto.py`
- `backend/app/services/employee_service.py` (`update_employee_banking`)

## Modification Guide

1. Always encrypt before `$set` on `onboarding.employment`.
2. Keep remote/on-site branch logic in service.
3. When adding fields, update `OnboardingEmploymentInfo` + encrypt/decrypt payload allowlists.
4. Preserve combined auth dependency pattern for banking.

## Do Not Break

- Encryption at rest.
- Remote vs on-site ownership.
- Capability+role enforcement on PUT banking.
- Masking on recruiter detail for remote employees.

## Testing

- On-site recruiter update succeeds; stored ciphertext in DB.
- Remote recruiter update fails with remote message.
- Detail GET does not leak full secrets inappropriately.
- `py_compile` employees + crypto + employee_service banking methods.
