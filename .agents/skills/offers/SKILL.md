---
name: offers
description: >-
  TalentAI offer letters overview — create/send, candidate actions, negotiation,
  signing, approve/activate, and RequireCandidate role gotcha vs employees.
scope: offers
related_skills:
  - offers/offer-lifecycle
  - offers/negotiation
  - offers/signing
  - authorization/SKILL
  - employees/convert-activate
primary_files:
  - backend/app/api/offers.py
  - backend/app/services/offer_service.py
  - frontend/app/offer/page.js
  - frontend/services/authService.js
---

# Offers (overview)

## Purpose

Manage offer letters from invite/create through sign, negotiate, and recruiter approve. Do not confuse router-local `RequireCandidate` with the employees upload alias.

## Location

| Layer | Path |
|-------|------|
| Router | `backend/app/api/offers.py` (`/api/offers`) |
| Service | `backend/app/services/offer_service.py` |
| Schemas | `backend/app/schemas/offer.py` |
| UI | `frontend/app/offer/page.js`, `OfferComposerModal.js`, `OfferSummaryCard.js`, `ExtendOfferValidityModal.js`, `OfferSigningGate.js` |
| Client | offer helpers in `frontend/services/authService.js` |

## Entry Points

1. Invite with `offer` terms or `POST /api/offers` for existing candidate.
2. Candidate `/offer` → `GET /api/offers/me` (marks viewed).
3. Sign / decline / negotiate; recruiter respond / edit-and-resend / extend / approve.

## Data Flow

```
RequireRecruiterWithInvite | RequireCandidate(roles)
  → offer_service
  → Mongo offer_letters (+ candidate conversion_status updates)
```

Active statuses: `sent`, `viewed`, `signed` (`ACTIVE_OFFER_STATUSES`). Also: `withdrawn`, `expired`, declined paths as implemented in service.

## Business Rules

- One active offer per candidate (`sent|viewed|signed`); conflicts → 409.
- Converted candidates cannot receive new offers.
- Unsigned offers withdrawn on certain re-invite paths (`withdraw_unsigned_for_email`).
- Candidates must sign before onboarding mutations (`require_signed_offer`).
- **RequireCandidate gotcha:** in `offers.py` = `require_roles("candidate", "super_admin")`. In `employees.py`, `RequireCandidate` is **`RequireOnboardingSelf`** (permission) — employees can hit upload routes; they cannot hit offer candidate routes unless role is candidate/super_admin.

## Permissions

Recruiter routes: roles + capability `invite`.
Candidate routes: roles `candidate|super_admin` (not `offers.self` permission dependency).

## APIs (real)

See child skills. Full router surface under `/api/offers`.

## Important Files

- `backend/app/api/offers.py` (gotcha comment at top)
- `backend/app/services/offer_service.py`
- `frontend/components/candidate/OfferSigningGate.js`

## Modification Guide

1. Status transitions only in `offer_service`.
2. Keep invite-created offers and `create_and_send` consistent.
3. Update authService + offer page together.
4. When copying `RequireCandidate`, read the local definition.

## Do Not Break

- Typed role gate on candidate offer actions vs onboarding.self on uploads.
- Capability `invite` on recruiter offer mutations.
- Org scoping on list endpoints.
- Approve prerequisites (signed + docs + IT) as coded in `approve`.

## Testing

- Create → view → sign → approve happy path.
- Negotiate pending blocks sign (409).
- Employee token cannot `GET /api/offers/me` (role gate).
- `py_compile` offers API + offer_service.
