---
name: ocr-extraction
description: >-
  TalentAI OCR and document extraction: ENABLE_OCR / ENABLE_EMBEDDINGS lazy
  imports, extraction pipeline, bank-slip parse, resume embeddings. Use when
  touching document_extraction_service, ocr_service, or embedding_service.
---

# OCR & Extraction

## Purpose

Extract text and structured fields from uploaded documents and bank slips; optionally embed resumes for talent search. Optional at runtime — must never crash app boot when OCR/embedding libs are absent.

## Location

- Primary: `backend/app/services/document_extraction_service.py`
- PaddleOCR helper: `backend/app/services/ocr_service.py`
- Embeddings: `backend/app/services/embedding_service.py`
- Flags: `backend/app/core/config.py` — `ENABLE_OCR` (default True), `ENABLE_EMBEDDINGS` (default False)
- Consumers: `document_service.py` upload/reextract/bank analyze; talent search cosine

## Entry Points

- Document upload/reextract (when `ENABLE_OCR`)
- POST `/api/documents/analyze-bank-slip`
- Resume accept path → `generate_resume_embedding` when `ENABLE_EMBEDDINGS`
- List/compare helpers may call `ocr_service.compare_with_profile`

## Data Flow

```
bytes → detect_file_type → extract_text (pdf/docx/txt/image)
  → parse_structured_data (LLM + heuristic fallback)
  → validate_classification
  → optional parse_bank_document
Resume accepted + ENABLE_EMBEDDINGS → BGEM3 embed → candidates.resume_embedding
```

## Business Rules

- All heavy libs are **lazy-imported inside functions** — never top-level.
- When OCR disabled/unavailable: degrade gracefully (pending/manual verification).
- Bank parse is heuristic + LLM; normalize IBAN; Pakistani bank name hints.
- Embeddings stored on **`candidates`**, not on the `documents` row.

## Permissions

No separate OCR permission — inherits document endpoint auth (`RequireSelf` / recruiter verify).

## Real APIs

OCR is not a standalone router. Invoked via:

| Method | Path |
|--------|------|
| POST | `/api/documents/upload` |
| POST | `/api/documents/{document_id}/reextract` |
| POST | `/api/documents/analyze-bank-slip` |

## Important Files

- `backend/app/services/document_extraction_service.py`
- `backend/app/services/ocr_service.py`
- `backend/app/services/embedding_service.py`
- `backend/app/core/config.py`
- `backend/app/services/document_service.py`

## Modification Guide

1. Add extractors inside `document_extraction_service` with lazy imports.
2. Keep `PURPOSE_EXPECTED_CATEGORIES` and classification validation in sync with upload purposes.
3. New embedding model: change `EMBEDDING_MODEL` + consumers of vector dimension carefully.
4. Do not split this domain into a required boot dependency.

## Do Not Break

- **Never** convert lazy OCR/embedding imports into hard top-level imports (boot crash risk).
- Respect `ENABLE_OCR` / `ENABLE_EMBEDDINGS` gates.
- Do not require PaddleOCR for the main upload path (EasyOCR/Tesseract/PDF paths in extraction service).
- Do not write bank fields from analyze into Mongo document rows.

## Testing

- Run with `ENABLE_OCR=false` and confirm upload still works
- Run with embeddings off; talent search degrades without crash
- No dedicated OCR pytest — use `py_compile` + manual upload of PDF/image

## Related

- `ocr-pipeline.md`, `bank-slip-analysis.md`, `embeddings-resume.md`
- Parent UX: `../documents/`
