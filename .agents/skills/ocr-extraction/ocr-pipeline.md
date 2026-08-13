---
name: ocr-pipeline
description: >-
  Step-by-step TalentAI document extraction pipeline in document_extraction_service
  and optional ocr_service. Use when changing text extract, LLM parse, or classification.
---

# OCR Pipeline

## Purpose

Document the exact extraction stages used on upload/reextract so agents modify the correct layer.

## Location

- `backend/app/services/document_extraction_service.py`
- Optional: `backend/app/services/ocr_service.py` (`_get_engine` → `from paddleocr import PaddleOCR`)
- Wired from `DocumentService.upload` / `reextract`

## Entry Points

- Service calls: `extract_text`, `parse_structured_data`, `validate_classification`
- Flags: `settings.ENABLE_OCR`

## Data Flow

1. **detect_file_type** — extension + magic bytes
2. **extract_text** — PDF (`fitz`), DOCX (`docx`), plain text, images (EasyOCR / pytesseract+PIL) — all lazy
3. **parse_structured_data** — `call_llm_json` classify/fields; `_heuristic_fallback_parse` if LLM unavailable
4. **validate_classification** vs `PURPOSE_EXPECTED_CATEGORIES`
5. Document service applies hard-fail (identity) vs soft-keep (education/resume)
6. **document_matching_service.compare_extractions** for cross-doc consistency

## Business Rules

- Identity wrong-type / unreadable → deactivate bad upload; do not replace last good CNIC/passport.
- Education/resume extraction failures soft-keep pending verification.
- LLM optional; heuristics must remain a viable fallback.
- `ENABLE_OCR=false` skips extraction; status stays pending/manual.

## Permissions

Inherited from document upload/reextract endpoints.

## Real APIs

| Method | Path | Triggers pipeline |
|--------|------|-------------------|
| POST | `/api/documents/upload` | yes if OCR on |
| POST | `/api/documents/{document_id}/reextract` | yes if OCR on |

## Important Files

- `backend/app/services/document_extraction_service.py`
- `backend/app/services/ocr_service.py`
- `backend/app/services/document_matching_service.py`
- `backend/app/services/llm_service.py` (`call_llm_json`)
- `backend/app/core/config.py`

## Modification Guide

1. New file type: extend `detect_file_type` + `extract_text` branch with lazy import.
2. New fields: update LLM prompt schema + heuristic fallback + frontend display.
3. Prefer extraction-service changes over resurrecting PaddleOCR as the primary path.
4. Keep compare/match input keys stable or update matching service in the same change.

## Do Not Break

- Lazy imports for `easyocr`, `pytesseract`, `PIL`, `fitz`, `docx`, `paddleocr`
- Graceful degrade when engines missing
- Classification expectations tied to upload `purpose` / `doc_type`

## Testing

- PDF, DOCX, PNG upload with OCR on
- Same with OCR libs uninstalled / flag off
- `python -m py_compile backend/app/services/document_extraction_service.py`
