---
name: progress-autosave
description: >-
  Onboarding progress percentage/checklist and PUT autosave behavior for
  TalentAI personal onboarding.
scope: onboarding
related_skills:
  - onboarding/SKILL
  - onboarding/candidate-wizard
primary_files:
  - backend/app/api/onboarding.py
  - backend/app/services/candidate_service.py
  - frontend/app/onboarding/page.js
  - frontend/services/authService.js
---

# Onboarding progress & autosave

## Purpose

Persist partial onboarding safely and expose completion progress for candidate UI and recruiter pipeline filters (`progress_min`/`progress_max` on candidate list).

## Location

- `PUT /api/onboarding` → `CandidateService.save_onboarding`
- `GET /api/onboarding/progress` → `CandidateService.get_progress` (US-019 checklist/% )
- `GET /api/onboarding` → hydrate wizard
- Client: `saveOnboarding`, `getOnboardingProgress`, `getOnboarding`
- Recruiter visibility: candidate list progress filters in `GET /api/employees/candidates`

## Entry Points

1. Wizard debounce/autosave on field blur or step change → PUT.
2. Progress bar / checklist → GET progress.
3. Recruiter pipeline filters by progress range.

## Data Flow

```
OnboardingSaveRequest (partial or full)
  → save_onboarding merges into candidate onboarding document
get_progress → computes percentage + step checklist
```

## Business Rules

- Auth: `onboarding.self` on all three onboarding routes.
- Candidates: signed offer required inside save path (via service/offer gate as implemented).
- Progress drives recruiter `progress_min`/`progress_max` query params.
- Idempotent saves should not wipe unspecified sections unless schema/service explicitly replaces — follow existing merge behavior in `save_onboarding`.

## Permissions

`require_permissions("onboarding.self")` on router.

## APIs (real)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/onboarding` | onboarding.self |
| PUT | `/api/onboarding` | onboarding.self |
| GET | `/api/onboarding/progress` | onboarding.self |

## Important Files

- `backend/app/services/candidate_service.py` — `save_onboarding`, `get_progress`
- `frontend/app/onboarding/page.js` — autosave timing
- `frontend/services/authService.js`

## Modification Guide

1. When adding wizard fields, update progress checklist weights in `get_progress`.
2. Keep PUT schema backward compatible for partial saves.
3. Align frontend autosave payload with schema (avoid sending invalid empty strings that fail validators).

## Do Not Break

- Progress calculation used by recruiter filters.
- Auth dependency on all three routes.
- Offer gate on candidate saves.

## Testing

- Partial PUT then GET returns merged data.
- Progress increases as required steps complete.
- Unsigned candidate save rejected.
- `py_compile` onboarding + candidate_service progress/save methods.
