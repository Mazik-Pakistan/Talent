---
name: documents
description: >-
  TalentAI document upload, OCR-assisted extraction, recruiter verification, and
  signed download under /api/documents. Use when changing document APIs,
  DocumentManager, bank-slip analyze, verify/reject flows, or Cloudinary storage.
---

# Documents

## Purpose

Own candidate/employee document lifecycle: upload → optional OCR/extraction → pending verification → recruiter verify/reject → authenticated download. Bank-slip analyze is extraction-only (not persisted as a document).

## Location

- Backend router: `backend/app/api/documents.py` — prefix `/api/documents`
- Service: `backend/app/services/document_service.py`
- Extraction: `backend/app/services/document_extraction_service.py`
- Matching: `backend/app/services/document_matching_service.py`
- Storage: `backend/app/services/storage_service.py`
- Schema: `backend/app/schemas/document.py`
- Frontend wrappers: `frontend/services/authService.js` (`uploadDocument`, `analyzeBankSlip`, `listMyDocuments`, `listOwnerDocuments`, `verifyDocument`, `reextractDocument`, `deleteDocument`, `getDocumentDownloadUrl`)
- UI: `frontend/components/DocumentManager.js`, `RecruiterDocumentReview.js`, `frontend/app/documents/page.js`, onboarding surfaces

## Entry Points

| Actor | Entry |
|-------|--------|
| Candidate/employee | POST `/api/documents/upload`, GET `/me`, reextract/delete, bank-slip analyze |
| Recruiter (+ `candidates` capability) | GET `/owner/{owner_id}`, PUT `/{id}/verify` |
| Any authenticated user (authorized) | GET `/{id}/download` |

## Data Flow

```
Upload → size/ext/hash checks → storage_service.save_file (Cloudinary)
  → documents insert (processing|pending_verification)
  → ENABLE_OCR? extract_text → parse_structured_data → validate_classification
  → cross-doc match → optional resume embedding (ENABLE_EMBEDDINGS)
  → recruiter verify → status verified|rejected|reupload_required|mismatch
Download → authz owner/org → get_signed_url → audit_logs document_download
```

## Business Rules

- Candidates need a **signed offer** before upload (`offer_service.require_signed_offer_for_candidate`).
- Identity docs hard-fail on unreadable/wrong type; education/resume soft-keep.
- Bank analyze must **not** store banking PII as a document row.
- Soft-replace duplicate same SHA-256 hash for same owner/type.
- Recruiter access org-scoped via `recruiter_can_access_record`.

## Permissions

- `RequireSelf` = roles `candidate|employee|super_admin`
- `RequireRecruiterWithDocuments` = roles `recruiter|super_admin` + capability `candidates`
- Download: `RequireUser` + service-level owner/org checks

## Real APIs

| Method | Path |
|--------|------|
| POST | `/api/documents/upload` |
| POST | `/api/documents/analyze-bank-slip` |
| GET | `/api/documents/me` |
| GET | `/api/documents/owner/{owner_id}` |
| PUT | `/api/documents/{document_id}/verify` |
| POST | `/api/documents/{document_id}/reextract` |
| DELETE | `/api/documents/{document_id}` |
| GET | `/api/documents/{document_id}/download` |

## Important Files

- `backend/app/api/documents.py`
- `backend/app/services/document_service.py`
- `backend/app/services/document_extraction_service.py`
- `backend/app/services/storage_service.py`
- `backend/app/schemas/document.py`
- `frontend/services/authService.js`
- `frontend/components/DocumentManager.js`

## Modification Guide

1. Keep routers thin — logic stays in `DocumentService`.
2. New doc types: update schema + `PURPOSE_EXPECTED_CATEGORIES` / validation in extraction.
3. Mirror any response shape changes in `authService.js` and `DocumentManager` / review UI.
4. Indexes for `documents` live in `backend/app/core/database.py` (`_ensure_index`).

## Do Not Break

- Never hard-import OCR/embedding libs at module top (`ENABLE_OCR` / `ENABLE_EMBEDDINGS` lazy path).
- Do not remove signed-offer gate for candidates.
- Do not persist bank-slip analyze results as documents.
- Do not widen recruiter access beyond `candidates` capability + org scope.
- Do not log decrypted banking or raw CNIC payloads.

## Testing

- `python -m py_compile backend/app/api/documents.py backend/app/services/document_service.py`
- Related: `backend/tests/test_banking_endpoint.py`, capability wiring in `backend/tests/test_authorization_audit.py`
- Manual: upload identity/resume, verify as recruiter, download URL, bank-slip analyze without new document row

## Related fine-grained skills

- `upload-verify.md` — upload + recruiter verify
- `signed-download.md` — download authz + audit
- Sibling domain: `../ocr-extraction/`
