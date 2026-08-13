---
name: storage
description: >-
  TalentAI Cloudinary document and profile photo storage — folders, signed URLs,
  size limits. Use when changing uploads or storage_service.
scope: storage
related_skills:
  - storage/cloudinary-photos-docs
  - security/crypto-sensitive-fields
  - frontend/services-api-client
primary_files:
  - backend/app/services/storage_service.py
  - backend/app/services/profile_photo_service.py
  - backend/app/core/config.py
---

# Storage (overview)

## Purpose

Persist user documents and profile photos. **New uploads go to Cloudinary**. Optional Supabase client may exist for legacy/other uses — not the primary upload path.

## Location

| Concern | Path |
|---------|------|
| Docs | `backend/app/services/storage_service.py` |
| Photos | `backend/app/services/profile_photo_service.py` |
| Config | `CLOUDINARY_*`, `SIGNED_URL_EXPIRE_SECONDS`, `MAX_DOCUMENT_MB` |
| Optional | Supabase client in `database.py` when `SUPABASE_*` set |

## Entry Points

Document upload/verify flows; employee/recruiter profile photo endpoints; IT/onboarding uploads.

## Data Flow

```
Upload bytes → Cloudinary folder {CLOUDINARY_FOLDER}/{owner}/{category}
  → store URL/public_id on Mongo doc
Download/view → signed URL (expire default 3600s)
```

## Business Rules

- `MAX_DOCUMENT_MB` default 10.
- Always verify ownership/org before returning signed URLs.
- Dual-role photo changes should mirror via profile sync.

## Permissions

Per document/employee routers (owner, recruiter verify, etc.) — storage layer is not a security boundary alone.

## APIs (real)

Document/photo routes under `/api/documents`, `/api/employees`, etc. (domain routers). Storage has no standalone public API.

## Important Files

- `storage_service.py`, `profile_photo_service.py`
- `config.py` Cloudinary settings
- Document frontend services

## Modification Guide

1. Keep Cloudinary as default for new uploads.
2. Folder layout must remain predictable for ops/debug.
3. Do not log binary contents or signed URLs unnecessarily.

## Do Not Break

- Ownership checks on get-link/download.
- Size limit enforcement.
- Signed URL expiry setting.

## Testing

- Upload < limit succeeds; over limit fails.
- Other user cannot fetch signed URL.
- Photo upload updates profile + dual-role mirror if applicable.
