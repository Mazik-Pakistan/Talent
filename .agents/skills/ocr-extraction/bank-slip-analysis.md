---
name: ocr-bank-slip-analysis
description: >-
  TalentAI bank-slip OCR analyze endpoint POST /api/documents/analyze-bank-slip.
  Extraction-only; does not persist banking documents. Use when changing bank field parse or confirm flow.
---

# Bank Slip Analysis

## Purpose

Extract bank account fields from an uploaded slip image/PDF for employee profile completion — without creating a stored banking document.

## Location

- Router: `backend/app/api/documents.py` — `analyze_bank_slip`
- Service: `DocumentService.analyze_bank_document`
- Extraction: `parse_bank_document` / `parse_bank_document_sync` in `document_extraction_service.py`
- Frontend: `analyzeBankSlip` in `authService.js`; `frontend/components/ai-experience/BankSlipScanner.js`

## Entry Points

- POST `/api/documents/analyze-bank-slip` (`RequireSelf`)
- Employee profile / onboarding UI that confirms extracted fields via profile-completion endpoints (not document insert)

## Data Flow

```
UploadFile → analyze_bank_document
  → parse_bank_document (heuristic + LLM when available)
  → return fields to client
  → user confirms into employee banking profile (Fernet-encrypted path)
```

Returned fields typically include: `bank_name`, `account_holder_name`, `account_number`, `iban`, `branch`, `branch_code`, `swift_code`.

## Business Rules

- **Not stored** as a `documents` row from this endpoint.
- IBAN normalization; Pakistani bank name list hints in extraction.
- Banking fields elsewhere use Fernet (`BANKING_ENCRYPTION_KEY`) — never log plaintext.
- Candidates/employees only (`RequireSelf`).

## Permissions

- `RequireSelf` = `candidate|employee|super_admin`

## Real APIs

| Method | Path |
|--------|------|
| POST | `/api/documents/analyze-bank-slip` |

Related (confirm/store): employee/onboarding banking endpoints — not this skill’s write path.

## Important Files

- `backend/app/api/documents.py`
- `backend/app/services/document_service.py`
- `backend/app/services/document_extraction_service.py`
- `frontend/services/authService.js`
- `frontend/components/ai-experience/BankSlipScanner.js`
- `backend/tests/test_banking_endpoint.py` (related banking)

## Modification Guide

1. Add fields in extraction parse + response contract + BankSlipScanner together.
2. Keep analyze separate from document upload/verify.
3. If persisting slips is ever required, that is a new explicit product decision — do not silently insert.

## Do Not Break

- Do not persist bank-slip analyze uploads as documents.
- Do not print/log account numbers, IBAN, or decrypted banking.
- Preserve lazy OCR/LLM imports and degrade when unavailable.
- Do not bypass Fernet on any path that stores banking.

## Testing

- Analyze sample slip → fields returned, no new `documents` row
- `ENABLE_OCR=false` still returns heuristic/empty without 500
- Related banking tests: `backend/tests/test_banking_endpoint.py`
