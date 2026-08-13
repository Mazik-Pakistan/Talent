---
name: it-provisioning-bulk-batch
description: >-
  Bulk send/remind and public batch token flow under /api/it-provisioning/bulk-*
  and /batch/{token}. Use when changing multi-offer IT provisioning.
---

# IT Provisioning — Bulk & Batch

## Purpose

Send/remind IT provisioning for many signed offers at once; IT completes via a batch public link.

## Location

- Routes: `POST /bulk-send`, `/bulk-remind`, `GET /batch/{token}`, `POST /batch/{token}/submit`
- Service methods on `it_provisioning_service` for bulk + batch
- Collections: `it_provisioning_batches`, `it_provisioning_requests` (batch linkage)
- Frontend: `bulkSendItProvisioning`, `bulkRemindItProvisioning`, `getItProvisioningBatchPublic`; `frontend/app/it-setup/batch/[token]/page.js`

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/it-provisioning/bulk-send` | Recruiter + `it` |
| POST | `/api/it-provisioning/bulk-remind` | Recruiter + `it` |
| GET | `/api/it-provisioning/batch/{token}` | Public |
| POST | `/api/it-provisioning/batch/{token}/submit` | Public (`ItProvisioningBatchSubmitRequest`) |

## Data Flow

```
BulkSendItProvisioningRequest (offer ids) → each offer must be signed
  → create batch token + per-candidate requests
  → email batch link
IT opens batch → GET all pending entries → submit per-person payloads
  → same encryption/uniqueness rules as single submit
```

## Business Rules

- Every offer in bulk must pass signed-offer gate (fail or skip per existing service semantics — preserve).
- Batch token distinct from single-request token.
- Per-entry temporary passwords still Fernet-encrypted.
- Company email uniqueness enforced per entry.

## Permissions

- Bulk send/remind: `RequireRecruiterWithIT`
- Batch public: token only

## Real APIs

See Entry Points. Schemas: `BulkSendItProvisioningRequest`, `BulkRemindItProvisioningRequest`, `ItProvisioningBatchSubmitRequest`.

## Important Files

- `backend/app/api/it_provisioning.py`
- `backend/app/services/it_provisioning_service.py`
- `backend/app/schemas/it_provisioning.py`
- `frontend/app/it-setup/batch/[token]/page.js`
- `frontend/proxy.js` public `/it-setup/batch`

## Modification Guide

1. Batch submit entry shape must match single submit password/email rules.
2. Partial success handling: keep existing all-or-nothing vs per-row error behavior consistent with service.
3. Remind bulk only targets existing open requests.

## Do Not Break

- Signed-offer checks for each offer
- Batch vs single token separation
- Encryption and email uniqueness
- Public batch page in proxy allowlist

## Testing

- Bulk-send two signed offers → batch page lists both
- Submit batch → both requests completed
- Unsigned offer in bulk rejected
- Bulk-remind
