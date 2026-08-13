---
name: candidates
description: >-
  TalentAI candidate experience overview — dashboard, offer gate, onboarding
  handoff, and recruiter person-history / rehire flows.
scope: candidates
related_skills:
  - candidates/candidate-dashboard
  - candidates/person-history-reinvite
  - offers/SKILL
  - onboarding/SKILL
primary_files:
  - backend/app/api/dashboard.py
  - backend/app/services/candidate_service.py
  - frontend/app/dashboard/candidate/page.js
  - frontend/components/dashboard/CandidateDashboard.js
---

# Candidates (overview)

## Purpose

Candidate-facing status and recruiter tools for historical cycles / re-invite. Candidates have hiring permissions only (`onboarding.self`, `documents.self`, `offers.self`, `profile.view`) — no learning/AI coach until employee.

## Location

| Area | Path |
|------|------|
| Candidate dashboard API | `GET /api/dashboard/candidate` in `backend/app/api/dashboard.py` |
| Candidate domain service | `backend/app/services/candidate_service.py` |
| Offer gate UI | `frontend/components/candidate/OfferSigningGate.js`, `frontend/app/offer/page.js` |
| Shell | `frontend/components/candidate/CandidateShell.js` |
| Recruiter history | `GET /api/employees/person-history`, `/historical-candidates` |

## Entry Points

1. Login as candidate → `/dashboard/candidate`.
2. Must sign offer before mutating onboarding (enforced in services / upload).
3. Recruiter invite flow consults person-history for returning emails.

## Data Flow

```
Candidate Bearer (onboarding.self)
  → dashboard/offer/onboarding/documents APIs
  → candidates + offer_letters collections
Recruiter (candidates capability)
  → person-history / historical lists
```

## Business Rules

- Home: `/dashboard/candidate` (`ROLE_HOME`).
- Signed offer required for onboarding mutations (`offer_service.require_signed_offer_for_candidate`).
- Conversion to employee is recruiter-driven (`create-from-candidate` / offer approve path) — see employees skills.

## Permissions

Candidate role permissions as in `rbac.py`. Dashboard candidate endpoint uses `RequireOnboardingSelf` (candidates **and** employees with that perm).

## APIs (real)

- `GET /api/dashboard/candidate`
- Offer: `GET /api/offers/me`, sign/decline/negotiate (see offers)
- Onboarding: `GET/PUT /api/onboarding`, `GET /api/onboarding/progress`
- Recruiter: person-history + historical-candidates (see child skill)

## Important Files

- `frontend/components/dashboard/CandidateDashboard.js`
- `frontend/components/candidate/CandidateMascot.js`
- `backend/app/services/offer_service.py` — signed-offer gate

## Modification Guide

1. Extend dashboard payload in dashboard service/handler used by `/api/dashboard/candidate`.
2. Keep offer-signing gate UX in sync with backend 403s.
3. Do not grant learning routes to candidates.

## Do Not Break

- Offer-before-onboarding hard gate.
- Org binding on candidate profiles.
- RequireCandidate meaning differs in offers vs employees upload routes.

## Testing

- Candidate without signed offer cannot save onboarding / upload.
- Dashboard loads after sign.
- `py_compile` dashboard + candidate_service + offer_service gate helpers.
