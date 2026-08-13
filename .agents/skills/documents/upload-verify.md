---
name: documents-upload-verify
description: >-
  Document upload pipeline and recruiter verify/reject for TalentAI /api/documents.
  Use when changing upload validation, OCR handoff, verify statuses, or rejection reasons.
---

# Documents — Upload & Verify

## Purpose

Implement and safely change the upload → extraction → pending_verification → recruiter verify path.

## Location

- `backend/app/api/documents.py` — `upload_document`, `verify_document`, `reextract_document`, `list_*`
- `backend/app/services/document_service.py` — `upload`, `verify`, `reextract`, `list_mine`, `list_for_owner`
- `backend/app/schemas/document.py` — `DocumentVerifyRequest`
- UI: `frontend/components/DocumentManager.js`, `RecruiterDocumentReview.js`

## Entry Points

- POST `/api/documents/upload` (`RequireSelf`)
- PUT `/api/documents/{document_id}/verify` (`RequireRecruiterWithDocuments`)
- POST `/api/documents/{document_id}/reextract` (`RequireSelf`)
- GET `/api/documents/me`, GET `/api/documents/owner/{owner_id}`

## Data Flow

1. Client multipart upload via `uploadDocument(formData, token)`.
2. Service: signed-offer check (candidate) → ext/size → SHA-256 → Cloudinary save → insert `documents`.
3. If OCR enabled: extract → structured parse → classification validate → cross-doc match.
4. Recruiter loads owner docs → PUT verify with status + optional rejection reason / `approve_despite_mismatch`.
5. Notifications/audit as existing service paths dictate.

## Business Rules

- Verify `status` ∈ `verified|rejected|reupload_required|mismatch`.
- Rejection reasons: `blurry_or_unreadable`, `wrong_document_type`, `expired_document`, `information_mismatch`, `incomplete_document`, `other`.
- Profile upload types include `cnic|passport|resume|transcript|other`; identity limited to CNIC/Passport.
- Soft-replace same hash; identity wrong-type must not wipe last good identity doc.
- Categories: `identity|education|employment|banking|legal|other`.

## Permissions

- Upload/list self/reextract/delete: `candidate|employee|super_admin`
- Owner list + verify: `recruiter|super_admin` + capability `candidates`

## Real APIs

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/documents/upload` | multipart |
| GET | `/api/documents/me` | owner list |
| GET | `/api/documents/owner/{owner_id}` | recruiter |
| PUT | `/api/documents/{document_id}/verify` | `DocumentVerifyRequest` |
| POST | `/api/documents/{document_id}/reextract` | re-run extraction |
| DELETE | `/api/documents/{document_id}` | soft/active handling in service |

## Important Files

- `backend/app/api/documents.py`
- `backend/app/services/document_service.py`
- `backend/app/services/document_matching_service.py`
- `backend/app/schemas/document.py`
- `frontend/services/authService.js`
- `frontend/components/RecruiterDocumentReview.js`

## Modification Guide

1. Change verify statuses only with schema + frontend review UI together.
2. New rejection reasons: update schema enum/validation and recruiter UI copy.
3. Keep business `if`s in the service, not the router.
4. After OCR field changes, confirm cross-doc match still receives expected extraction shape.

## Do Not Break

- Signed-offer gate for candidates.
- Identity hard-fail vs education soft-keep semantics.
- Org-scoped recruiter access (`candidates` capability).
- Lazy OCR imports — upload must work when OCR libs missing / `ENABLE_OCR=false`.

## Testing

- `py_compile` touched files
- Manual matrix: CNIC blurry reject, resume soft-keep, verify despite mismatch, reextract
- Smoke capability gate: recruiter without `candidates` must 403
