---
name: candidate-dashboard
description: >-
  Candidate home dashboard API and UI — status, next steps, and navigation into
  offer and onboarding.
scope: candidates
related_skills:
  - candidates/SKILL
  - offers/signing
  - onboarding/candidate-wizard
primary_files:
  - backend/app/api/dashboard.py
  - frontend/app/dashboard/candidate/page.js
  - frontend/components/dashboard/CandidateDashboard.js
  - frontend/services/authService.js
---

# Candidate dashboard

## Purpose

Render the candidate home experience from `GET /api/dashboard/candidate` and deep-link into offer / onboarding without exposing recruiter APIs.

## Location

- API: `get_candidate_dashboard` in `backend/app/api/dashboard.py` → `GET /api/dashboard/candidate`
- Auth: `RequireOnboardingSelf` (`onboarding.self`)
- Client: `getCandidateDashboard` in `frontend/services/authService.js`
- UI: `frontend/app/dashboard/candidate/page.js`, `frontend/components/dashboard/CandidateDashboard.js`
- Shell/nav: `frontend/components/candidate/CandidateShell.js`
- Related pages: `frontend/app/offer/page.js`, `frontend/app/onboarding/page.js`, `frontend/app/dashboard/candidate/profile/page.js`

## Entry Points

1. Post-login redirect to `/dashboard/candidate`.
2. Page mount → `getCandidateDashboard(accessToken)`.
3. CTAs navigate to offer or onboarding (natural language in agent; routes in UI).

## Data Flow

```
RequireOnboardingSelf
  → dashboard candidate aggregator (offers/progress/notifications as implemented)
  → CandidateDashboard.js renders cards/steps
```

Notifications sibling: `GET /api/notifications`, `PUT /api/notifications/read` (`RequireUser`).

## Business Rules

- Endpoint allows any principal with `onboarding.self` (candidate, employee, super_admin).
- UI should still role-route employees to employee home via `ROLE_HOME` after conversion.
- Offer signing gate may block onboarding CTAs until signed.

## Permissions

`onboarding.self`. Not capability-gated (not a recruiter route).

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/dashboard/candidate` | Bearer + onboarding.self |
| GET | `/api/notifications` | Bearer |
| PUT | `/api/notifications/read` | Bearer |
| GET | `/api/offers/me` | candidate\|super_admin roles |
| GET | `/api/onboarding/progress` | onboarding.self |

## Important Files

- `backend/app/api/dashboard.py`
- `frontend/components/dashboard/CandidateDashboard.js`
- `frontend/components/candidate/OfferSigningGate.js`

## Modification Guide

1. Change aggregator/service behind the dashboard route, keep router thin.
2. Update `CandidateDashboard.js` for new fields.
3. Keep `authService.getCandidateDashboard` path `/api/dashboard/candidate`.

## Do Not Break

- Do not require recruiter capabilities on this route.
- Do not link super-admin portal from candidate UI.
- Preserve signed-offer gating for onboarding actions.

## Testing

- Login as candidate → dashboard 200.
- Employee with onboarding.self also authorized by dependency (confirm product intent if changing).
- UI handles empty offer / in-progress onboarding.
- `py_compile` dashboard.py; frontend lint on touched components if edited.
