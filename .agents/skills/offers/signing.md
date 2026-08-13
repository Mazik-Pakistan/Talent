---
name: signing
description: >-
  Candidate digital offer signing, signature upload, and decline; hard gate for
  onboarding until signed.
scope: offers
related_skills:
  - offers/SKILL
  - offers/offer-lifecycle
  - onboarding/SKILL
primary_files:
  - backend/app/api/offers.py
  - backend/app/services/offer_service.py
  - frontend/app/offer/page.js
  - frontend/components/candidate/OfferSigningGate.js
---

# Offer signing

## Purpose

Candidates sign (pad or uploaded image/PDF) or decline offers. Signing unlocks onboarding mutations via `require_signed_offer`.

## Location

- `POST /api/offers/{offer_id}/sign` — `OfferSignRequest`
- `POST /api/offers/{offer_id}/signature-upload` — multipart file → storage URL for `/sign`
- `POST /api/offers/{offer_id}/decline`
- Service: `sign`, `decline`, `has_signed_offer`, `require_signed_offer*`
- Storage: `backend/app/services/storage_service.py` (`save_file` … `signatures`)
- UI: `frontend/app/offer/page.js`, `OfferSigningGate.js`
- Client: `signOffer`, `uploadOfferSignature`, `declineOffer`, `getMyOffer`

## Entry Points

1. `/offer` public-path page (still needs auth token in practice) → load `/me` → sign UI.
2. Upload signature file → pass `signature_upload_url` into sign payload.
3. Onboarding/upload routes call `require_signed_offer_for_candidate`.

## Data Flow

```
GET /me (owner check, maybe viewed)
optional signature-upload → file_url
POST /sign → status=signed, signed_at
later: onboarding/employees upload checks has_signed_offer
```

## Business Rules

- Sign only while status in `sent|viewed` (else 409).
- Pending negotiation blocks sign (409).
- Upload empty file → 400.
- `_assert_owner` ensures candidate owns the offer.
- Decline uses `OfferDeclineRequest`.

## Permissions

Router-local `RequireCandidate`: **`require_roles("candidate", "super_admin")`** — not `onboarding.self`. Employees do not use these endpoints under the employee role.

## APIs (real)

| Method | Path |
|--------|------|
| GET | `/api/offers/me` |
| POST | `/api/offers/{offer_id}/sign` |
| POST | `/api/offers/{offer_id}/signature-upload` |
| POST | `/api/offers/{offer_id}/decline` |

## Important Files

- `backend/app/api/offers.py` (upload handler uses `storage_service`)
- `backend/app/services/offer_service.py`
- `frontend/components/candidate/OfferSigningGate.js`
- `frontend/proxy.js` includes `/offer` in `PUBLIC_PATHS`

## Modification Guide

1. Keep ownership asserts on sign/upload/decline.
2. If changing signature payload, update schema + offer page.
3. Preserve onboarding hard gate helpers.

## Do Not Break

- Role-based RequireCandidate (offers) vs permission-based alias (employees).
- Negotiation pending check before sign.
- Do not remove signed-offer requirement from candidate onboarding uploads.

## Testing

- Sign pad path; upload signature then sign.
- Decline path.
- Unsigned candidate PUT `/api/onboarding` → 403 from gate.
- `py_compile` offers + offer_service + onboarding touchpoints.
