---
name: cloudinary-photos-docs
description: >-
  TalentAI Cloudinary env vars, folder layout, profile photos, and document
  signed URL patterns.
scope: storage
related_skills:
  - storage/SKILL
  - dual-role/switch-role-profile-sync
primary_files:
  - backend/app/services/storage_service.py
  - backend/app/services/profile_photo_service.py
  - backend/app/core/config.py
---

# Cloudinary photos & docs

## Purpose

Configure and extend Cloudinary upload/signed-URL behavior safely.

## Location

- Env: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` (default `talent`)
- `SIGNED_URL_EXPIRE_SECONDS` (default 3600), `MAX_DOCUMENT_MB` (default 10)
- Services: `storage_service.py`, `profile_photo_service.py`

## Entry Points

Document service uploads; profile photo update endpoints; agent `get_document_link` / `get_my_document_link` (via document services).

## Data Flow

```
storage upload
  → cloudinary folder talent/{owner}/{category}
  → persist metadata on documents/profile
signed URL helper
  → time-limited HTTPS URL for authorized viewer
```

## Business Rules

- All **new** uploads → Cloudinary (not local disk).
- Supabase is optional/legacy-adjacent — do not redirect new uploads there without an explicit project decision.
- Category segments should stay stable (ids, resume, banking slip, etc. as existing code uses).

## Permissions

Callers must authorize before signing URLs. Recruiter document verify ≠ unrestricted download.

## APIs (real)

Domain routes (examples): document upload/list/verify under `/api/documents*`; employee photo under employees API. Exact paths follow those routers.

## Important Files

- `storage_service.py`
- `profile_photo_service.py`
- `document_service.py` (consumer)
- Frontend document upload components

## Modification Guide

1. New category → reuse upload helper with new folder segment + Mongo field.
2. Changing expiry → update setting; FE should not cache forever.
3. Profile photo → trigger `mirror_profile_fields` for dual-role.

## Do Not Break

- Authz before sign.
- Max size.
- Cloudinary credentials required in envs that accept uploads.

## Testing

- Upload + open signed link before expiry.
- Expired/invalid request denied.
- Missing Cloudinary env fails clearly at upload (not silent local write).
