---
name: documents-signed-download
description: >-
  Authenticated document download via GET /api/documents/{id}/download and
  DocumentService.get_signed_url. Use when changing download authz, audit, or storage URLs.
---

# Documents — Signed Download

## Purpose

Serve document file URLs only to authorized users, with download auditing.

## Location

- Router: `backend/app/api/documents.py` — `download_document`
- Service: `DocumentService.get_signed_url`
- Storage: `backend/app/services/storage_service.py` — `get_signed_url`
- Frontend: `getDocumentDownloadUrl` in `frontend/services/authService.js`

## Entry Points

- GET `/api/documents/{document_id}/download` — dependency `RequireUser`
- UI download actions in `DocumentManager` / recruiter review

## Data Flow

```
Authenticated request → load document by id
  → authorize owner OR recruiter org access
  → storage_service.get_signed_url(doc) / stored file_url
  → response { url, expires_in: SIGNED_URL_EXPIRE_SECONDS, ... }
  → audit_logs action=document_download
```

Note: current implementation primarily returns the stored Cloudinary `file_url` with an `expires_in` field rather than minting a fresh timed Cloudinary signature on every call — preserve authz/audit even if URL signing strategy changes.

## Business Rules

- Inactive/deleted docs must not download.
- Recruiters need org/record access (`recruiter_can_access_record`), not arbitrary `owner_id`.
- Owners (candidate/employee) download their own active docs.
- Every successful download should remain auditable.

## Permissions

- `RequireUser` at router; fine-grained checks inside `get_signed_url`
- Recruiter path still tied to candidates/org access patterns used elsewhere in document service

## Real APIs

| Method | Path |
|--------|------|
| GET | `/api/documents/{document_id}/download` |

Frontend: `getDocumentDownloadUrl(documentId, accessToken)` → opens/fetches returned URL.

## Important Files

- `backend/app/api/documents.py`
- `backend/app/services/document_service.py` (`get_signed_url`)
- `backend/app/services/storage_service.py`
- `backend/app/core/config.py` (`SIGNED_URL_EXPIRE_SECONDS`, `CLOUDINARY_*`)
- `frontend/services/authService.js`

## Modification Guide

1. If switching to real timed Cloudinary signatures, keep response contract fields the frontend expects (`url`, `expires_in`).
2. Do not move authz into the router — keep in service with existing helpers.
3. Update audit payload carefully; do not log full URLs with secrets if any are added later.

## Do Not Break

- Authz before returning any URL.
- Audit `document_download` trail.
- Cloudinary env requirements for stored files.
- Do not expose other tenants’ documents via missing org filters.

## Testing

- Owner download succeeds; other candidate 403/404
- Recruiter same-org succeeds; cross-org fails
- Confirm `audit_logs` entry
- `py_compile` service + router
