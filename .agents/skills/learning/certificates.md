---
name: learning-certificates
description: >-
  Learning certificate upload, list, recruiter pending verify under /api/learning/certificates.
  Use when changing certificate CRUD or verification.
---

# Learning — Certificates

## Purpose

Employees upload certificates (link required, optional file); recruiters verify pending certificates.

## Location

- `backend/app/api/learning.py` — certificates routes
- `backend/app/services/learning_service.py` — cert CRUD/verify
- Collection: `learning_certificates`
- Schema: certificate request/verify models in `backend/app/schemas/learning.py`
- Frontend: employee + recruiter learning certificate panels via `learningService.js`

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/learning/certificates` | Employee — multipart/fields; `source_url` required http/https |
| GET | `/api/learning/certificates` | Employee — mine |
| GET | `/api/learning/certificates/pending` | `RequireRecruiterWithLearning` |
| PUT | `/api/learning/certificates/{certificate_id}/verify` | Recruiter |
| PUT | `/api/learning/certificates/{certificate_id}` | Employee update |
| DELETE | `/api/learning/certificates/{certificate_id}` | Employee |

Optional file ≤10MB, types pdf/png/jpg.

## Data Flow

```
Employee upload (URL + optional file → storage) → pending
Recruiter pending list → verify/reject
Verified certs feed designation readiness / skill evidence where wired
```

## Business Rules

- `source_url` required and must be http/https for the verify path.
- Org-scoped recruiter pending list.
- Employees only mutate their own certificates.

## Permissions

- Employee: `RequireEmployee`
- Pending/verify: `RequireRecruiterWithLearning` (`learning` capability)

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/learning.py`
- `backend/app/services/learning_service.py`
- `backend/app/schemas/learning.py`
- `frontend/services/learningService.js`

## Modification Guide

1. Changing verify payload: update schema + recruiter UI + service.
2. File limits/types: keep router validation and storage path aligned.
3. If certs affect designation readiness, update that service path in the same change.

## Do Not Break

- Required certificate link
- Recruiter `learning` capability
- Tenant isolation on pending lists
- Do not allow verify without recruiter auth

## Testing

- Upload with URL; appears pending for recruiter
- Verify → employee list shows verified
- Missing URL rejected
- Capability audit: `test_authorization_audit.py`
