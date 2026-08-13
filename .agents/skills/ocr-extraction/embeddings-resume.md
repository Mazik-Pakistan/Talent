---
name: ocr-embeddings-resume
description: >-
  Resume embedding generation via ENABLE_EMBEDDINGS and embedding_service (BGE-M3).
  Stored on candidates.resume_embedding for talent search. Use when changing embeddings or search vectors.
---

# Resume Embeddings

## Purpose

Optionally embed accepted resume text for cosine similarity in talent search. Disabled by default because the model download is heavy.

## Location

- `backend/app/services/embedding_service.py` — `_get_model` lazy `from FlagEmbedding import BGEM3FlagModel`
- `DocumentService.generate_resume_embedding`
- Config: `ENABLE_EMBEDDINGS`, `EMBEDDING_MODEL` in `backend/app/core/config.py`
- Consumer: `TalentService.search_talent` (resume embedding cosine)

## Entry Points

- After resume document accepted + `ENABLE_EMBEDDINGS` true during upload/processing path
- Talent search POST `/api/talent/search` reads `candidates.resume_embedding`

## Data Flow

```
Accepted resume text → embedding_service.embed (if ENABLE_EMBEDDINGS and model loads)
  → candidates.resume_embedding + resume_embedding_updated_at
  → talent search cosine against query embedding
```

## Business Rules

- Default `ENABLE_EMBEDDINGS=false` — must no-op cleanly.
- Vectors live on **`candidates`**, not `documents`.
- Model load is lazy and cached; failure → embeddings unavailable, not boot crash.
- Only generate for accepted/valid resume paths (see document service guards).

## Permissions

No separate embedding permission. Upload inherits `RequireSelf`; search requires recruiter + `talent` capability.

## Real APIs

Not a standalone route. Related:

| Method | Path | Role |
|--------|------|------|
| POST | `/api/documents/upload` | may trigger embed |
| POST | `/api/talent/search` | consumes vectors |

## Important Files

- `backend/app/services/embedding_service.py`
- `backend/app/services/document_service.py` (`generate_resume_embedding`)
- `backend/app/services/talent_service.py` (`search_talent`)
- `backend/app/core/config.py`

## Modification Guide

1. Keep `_get_model` lazy; never import FlagEmbedding at module top.
2. Dimension/model changes require re-embedding strategy — document if you change `EMBEDDING_MODEL`.
3. Talent search must tolerate missing embeddings (keyword/other fallbacks as implemented).

## Do Not Break

- **Lazy import only** for FlagEmbedding / heavy model code.
- Respect `ENABLE_EMBEDDINGS` gate.
- Do not store embeddings on wrong collection.
- Do not make embeddings required for document upload success.

## Testing

- Flag off: upload resume succeeds; search does not 500
- Flag on (env with model): confirm `candidates.resume_embedding` set
- `py_compile embedding_service.py document_service.py`
