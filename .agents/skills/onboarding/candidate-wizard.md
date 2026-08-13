---
name: candidate-wizard
description: >-
  Multi-step candidate onboarding wizard UI and backend save model, including
  document slot uploads and university autocomplete.
scope: onboarding
related_skills:
  - onboarding/SKILL
  - onboarding/progress-autosave
  - offers/signing
primary_files:
  - frontend/app/onboarding/page.js
  - backend/app/api/onboarding.py
  - backend/app/services/candidate_service.py
  - backend/app/schemas/invitation.py
---

# Candidate onboarding wizard

## Purpose

Guide candidates through profile/docs/employment steps after offer signing; persist via `OnboardingSaveRequest` and slot uploads.

## Location

- Page: `frontend/app/onboarding/page.js`
- API: `GET/PUT /api/onboarding`
- Service: `CandidateService.get_onboarding`, `save_onboarding`, `attach_uploaded_file`
- Schema: `OnboardingSaveRequest` (+ nested employment/personal sections) in `backend/app/schemas/invitation.py`
- Uploads: `POST /api/employees/upload` purposes `resume|government_doc|education_cert|skill_cert`
- University search: `backend/app/api/universities.py` → `GET /api/universities/search`
- UI helper: `frontend/components/onboarding/UniversityAutocomplete.js`
- Gate: `OfferSigningGate.js` / offer_service require signed

## Entry Points

1. Candidate nav / dashboard CTA → `/onboarding`.
2. Step changes → save payload (see autosave skill).
3. File inputs → multipart upload with `purpose` + optional `doc_type`/`index`.

## Data Flow

```
Wizard state
  → saveOnboarding(payload)
  → CandidateService.save_onboarding
File
  → uploadOnboardingFile(FormData)
  → document_service + attach_uploaded_file on candidate onboarding slots
```

## Business Rules

- Signed offer required for candidate mutations.
- Government doc must be National ID type; education forced to transcript; resume type resume.
- Remote vs on-site banking: remote candidates/employees manage banking in profile flows; on-site often recruiter-managed later — respect `is_remote` from invite.
- IBAN pattern for PK accounts validated in schemas (`IBAN_PATTERN`).

## Permissions

`onboarding.self` for GET/PUT. Upload uses `RequireOnboardingSelf` alias.

## APIs (real)

- `GET /api/onboarding`
- `PUT /api/onboarding`
- `POST /api/employees/upload`
- `DELETE /api/employees/upload?purpose=&index=`
- `GET /api/universities/search`

## Important Files

- `frontend/app/onboarding/page.js`
- `backend/app/schemas/invitation.py` (validators for CNIC, DOB, URLs, dates)
- `backend/app/api/employees.py` (upload purpose maps)

## Modification Guide

1. Add fields to Pydantic schema with validators.
2. Persist in `save_onboarding` / get response shape.
3. Update wizard step UI + authService.
4. New upload purpose requires ALLOWED maps in employees router.

## Do Not Break

- Existing validators (CNIC, IBAN, start dates).
- Purpose→category mapping for documents.
- Signed-offer gate.

## Testing

- Complete wizard end-to-end with docs.
- Invalid CNIC/IBAN → 422.
- University autocomplete search.
- `py_compile` schemas + candidate_service + onboarding router.
