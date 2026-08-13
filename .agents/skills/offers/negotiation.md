---
name: negotiation
description: >-
  Candidate offer negotiation request and recruiter accept/reject/counter flows
  for TalentAI offer letters.
scope: offers
related_skills:
  - offers/SKILL
  - offers/offer-lifecycle
  - offers/signing
primary_files:
  - backend/app/api/offers.py
  - backend/app/services/offer_service.py
  - backend/app/schemas/offer.py
---

# Offer negotiation

## Purpose

Allow candidates to request changes and recruiters to accept, reject, or counter without breaking sign gating while `negotiation.status == pending`.

## Location

- Router endpoints under `/api/offers/{offer_id}/negotiate` and `/negotiation/*`
- Service methods: `negotiate`, `accept_negotiation`, `reject_negotiation`, `counter_negotiation`, `list_pending_negotiations`
- Schemas: `OfferNegotiateRequest`, `NegotiationRespondRequest`
- Client: `negotiateOffer`, `acceptOfferNegotiation`, `rejectOfferNegotiation`, `counterOfferNegotiation`, `listPendingNegotiations`

## Entry Points

1. Candidate on offer page → negotiate.
2. Recruiter pending queue → `GET /api/offers/negotiations/pending`.
3. Recruiter respond → accept / reject / counter.

## Data Flow

```
Candidate negotiate → negotiation.status=pending on offer_letters
Recruiter list_pending_negotiations (org scoped)
Recruiter accept|reject|counter → resolved/closed + notes/summary
Sign blocked while pending
```

## Business Rules

- Pending negotiations listed for offers in `sent|viewed|expired` with `negotiation.status=pending`.
- Signing while negotiation pending → HTTP 409.
- Recruiter responses carry notes via `NegotiationRespondRequest`.
- Edit-and-resend may reset/merge negotiation state — preserve recovery logic in `get_mine` merge helpers.

## Permissions

- Negotiate: `RequireCandidate` = roles `candidate|super_admin`
- Respond/list: `RequireRecruiterWithInvite` (invite capability)

## APIs (real)

| Method | Path | Actor |
|--------|------|-------|
| POST | `/api/offers/{offer_id}/negotiate` | Candidate |
| GET | `/api/offers/negotiations/pending` | Recruiter |
| POST | `/api/offers/{offer_id}/negotiation/accept` | Recruiter |
| POST | `/api/offers/{offer_id}/negotiation/reject` | Recruiter |
| POST | `/api/offers/{offer_id}/negotiation/counter` | Recruiter |

## Important Files

- `backend/app/services/offer_service.py`
- `frontend/app/offer/page.js` (candidate UX)
- Recruiter candidate detail / awaiting panels consuming pending list

## Modification Guide

1. Keep pending→resolved transitions centralized in offer_service.
2. Update both candidate and recruiter UIs + authService.
3. Ensure sign path still checks pending status.

## Do Not Break

- Sign blocked during pending negotiation.
- Invite capability on recruiter respond routes.
- Org filter on pending list.

## Testing

- Negotiate → appears in pending → accept → candidate can sign.
- Sign during pending → 409.
- Counter updates offer terms/notes as designed.
- `py_compile` offers API + service.
