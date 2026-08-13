---
name: offer-lifecycle
description: >-
  Offer create/send, view, decline, edit-and-resend, extend validity, list by
  candidate, awaiting-response, and approve/activate.
scope: offers
related_skills:
  - offers/SKILL
  - offers/negotiation
  - offers/signing
  - employees/convert-activate
primary_files:
  - backend/app/api/offers.py
  - backend/app/services/offer_service.py
  - backend/app/schemas/offer.py
---

# Offer lifecycle

## Purpose

Implement status transitions for offer letters end-to-end without inventing statuses or skipping conflict checks.

## Location

- `backend/app/api/offers.py`
- `backend/app/services/offer_service.py`
- Schemas: `OfferCreateRequest`, `OfferDeclineRequest`, `OfferEditResendRequest`, `OfferExtendValidityRequest`, `OfferApproveRequest`
- UI: invite composer, candidate offer page, recruiter candidate detail, `ExtendOfferValidityModal.js`
- Client: `createOffer`, `getMyOffer`, `listOffersForCandidate`, `listAwaitingOfferResponse`, `declineOffer`, `editAndResendOffer`, `extendOfferValidity`, `approveOffer`

## Entry Points

| Step | Who | API |
|------|-----|-----|
| Create/send | Recruiter | `POST /api/offers` (or invite with offer) |
| View | Candidate | `GET /api/offers/me` (sent→viewed) |
| Decline | Candidate | `POST /api/offers/{id}/decline` |
| Edit+resend | Recruiter | `POST /api/offers/{id}/edit-and-resend` |
| Extend | Recruiter | `POST /api/offers/{id}/extend-validity` |
| Lists | Recruiter | `/candidate/{id}`, `/awaiting-response` |
| Approve | Recruiter | `POST /api/offers/{id}/approve` |

## Data Flow

```
create_and_send → offer_letters status=sent, candidate conversion_status=offer_sent
get_mine → mark viewed
approve → employee activation path (docs + IT checks inside service)
```

## Business Rules

- Active statuses: `sent`, `viewed`, `signed`.
- Cannot create if candidate `status == converted` or another active offer exists.
- `edit-and-resend` creates a new version; unsigned prior may be withdrawn.
- `extend-validity` for expired unsigned offers.
- `approve` docstring: activate employee after signed offer + docs + IT provisioning.

## Permissions

`RequireRecruiterWithInvite` on recruiter endpoints; candidate role gate on candidate endpoints.

## APIs (real)

| Method | Path |
|--------|------|
| POST | `/api/offers` |
| GET | `/api/offers/me` |
| GET | `/api/offers/awaiting-response` |
| GET | `/api/offers/candidate/{candidate_id}` |
| POST | `/api/offers/{offer_id}/decline` |
| POST | `/api/offers/{offer_id}/edit-and-resend` |
| POST | `/api/offers/{offer_id}/extend-validity` |
| POST | `/api/offers/{offer_id}/approve` |

(Signing/negotiation APIs in sibling skills.)

## Important Files

- `offer_service.py` — `ACTIVE_OFFER_STATUSES`, `create_and_send`, `get_mine`, `approve`, `extend_validity`, `edit_and_resend`
- `frontend/components/recruiter/ExtendOfferValidityModal.js`

## Modification Guide

1. Add transitions in service with explicit 409 messages.
2. Keep invite-embedded offer creation aligned with `create_and_send`.
3. Mirror new fields in schemas + frontend.

## Do Not Break

- Single active offer invariant.
- Viewed auto-transition on GET /me.
- Approve gating (signed + provisioning).
- Capability `invite`.

## Testing

- Full lifecycle to approve.
- Second active offer → 409.
- Extend expired offer; decline path.
- `py_compile` offers + offer_service + schemas.
