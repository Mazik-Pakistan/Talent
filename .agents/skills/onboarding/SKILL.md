---
name: onboarding
description: >-
  TalentAI candidate/employee personal onboarding overview — wizard, autosave,
  progress, and file uploads gated by signed offer for candidates.
scope: onboarding
related_skills:
  - onboarding/candidate-wizard
  - onboarding/progress-autosave
  - offers/signing
  - candidates/SKILL
primary_files:
  - backend/app/api/onboarding.py
  - backend/app/services/candidate_service.py
  - frontend/app/onboarding/page.js
  - backend/app/api/employees.py
---

# Onboarding (overview)

## Purpose

Personal onboarding data capture for candidates (and employees still holding `onboarding.self`). Keep routers thin; logic in `CandidateService`.

## Location

| Area | Path |
|------|------|
| Onboarding API | `backend/app/api/onboarding.py` (`/api/onboarding`) |
| Service | `backend/app/services/candidate_service.py` |
| Schema | `OnboardingSaveRequest` in `backend/app/schemas/invitation.py` |
| Uploads | `POST/DELETE /api/employees/upload` in `employees.py` |
| UI | `frontend/app/onboarding/page.js`, `components/onboarding/UniversityAutocomplete.js` |
| Client | `getOnboarding`, `saveOnboarding`, `getOnboardingProgress`, `uploadOnboardingFile`, `clearOnboardingFile` |

## Entry Points

1. After signed offer → `/onboarding` wizard.
2. Autosave PUT `/api/onboarding`.
3. Progress GET `/api/onboarding/progress`.
4. File slots via employees upload endpoints (permission `onboarding.self`).

## Data Flow

```
require_permissions("onboarding.self")
  → CandidateService.get/save/get_progress
  → candidates (or employee profile onboarding fields as implemented)
Uploads: RequireOnboardingSelf as RequireCandidate
  → candidate: require_signed_offer_for_candidate
  → document_service.upload + attach_uploaded_file
```

## Business Rules

- Candidates need signed offer before onboarding mutations/uploads.
- Identity uploads: CNIC/NIC only; OCR hard-reject on government_doc failure.
- Max upload 10MB; extensions pdf/png/jpg/jpeg/doc/docx.

## Permissions

All `/api/onboarding/*`: `onboarding.self`.
Uploads: `RequireOnboardingSelf` (alias RequireCandidate in employees.py) — **includes employees**.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/onboarding` |
| PUT | `/api/onboarding` |
| GET | `/api/onboarding/progress` |
| POST | `/api/employees/upload` |
| DELETE | `/api/employees/upload` |

Universities helper: `GET /api/universities/search` (separate router).

## Important Files

- `backend/app/api/onboarding.py`
- `backend/app/services/candidate_service.py`
- `backend/app/services/document_service.py`
- `frontend/proxy.js` — `/onboarding`, `/documents` public paths

## Modification Guide

1. Extend `OnboardingSaveRequest` + `save_onboarding`.
2. Update wizard steps UI + authService.
3. Keep signed-offer gate for candidate role on uploads/saves.

## Do Not Break

- `onboarding.self` dependency (do not switch to candidate-role-only unless product asks).
- Offer signing gate for candidates.
- OCR hard-reject behavior for identity docs.

## Testing

- GET/PUT onboarding as candidate with signed offer.
- Unsigned → 403 on save/upload.
- Progress percentages move with steps.
- `py_compile` onboarding + candidate_service + employees upload.
