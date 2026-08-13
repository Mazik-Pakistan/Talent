---
name: crypto-sensitive-fields
description: >-
  TalentAI Fernet encryption for banking and other sensitive fields —
  BANKING_ENCRYPTION_KEY, iban_hash, and safe decrypt paths.
scope: security
related_skills:
  - security/SKILL
  - storage/SKILL
primary_files:
  - backend/app/core/crypto.py
  - backend/app/core/config.py
---

# Crypto & sensitive fields

## Purpose

Encrypt sensitive values at rest and expose plaintext only on designated decrypt/reveal paths.

## Location

- `backend/app/core/crypto.py` — Fernet helpers
- Key: `BANKING_ENCRYPTION_KEY` or derived from `SECRET_KEY` if unset
- Typical fields: `account_number`, `iban`, `swift_code` + `iban_hash` for uniqueness
- Provider secrets may use `api_key_enc` patterns in learning/providers

## Entry Points

Employee banking update services; admin/recruiter views that intentionally reveal; IT temp password handling paths.

## Data Flow

```
plaintext → encrypt → store ciphertext (+ iban_hash)
authorized read → decrypt → return once
never log/print ciphertext decryption outside path
```

## Business Rules

- Uniqueness on IBAN via hash, not plaintext.
- Agent/tools/REST must not dump full banking objects into logs or LLM prompts.
- Connection tests must not return decrypted provider API secrets.

## Permissions

Only endpoints that already authorize banking/profile access may decrypt.

## APIs (real)

Domain employee/banking routes (see employees/onboarding skills if present). No raw crypto API.

## Important Files

- `crypto.py`
- Employee/banking sections of `employee_service.py` (large file — edit carefully)
- Tests for banking encryption in `backend/tests/`

## Modification Guide

1. New sensitive field → encrypt + document decrypt callers.
2. Rotation strategy requires explicit migration — do not change key casually.
3. Keep hash algorithm stable for uniqueness lookups.

## Do Not Break

- Fernet decrypt of existing rows.
- `iban_hash` lookup behavior.
- Redaction in logs and LLM prompts.

## Testing

- Encrypt → store → decrypt round trip.
- Duplicate IBAN rejected via hash.
- Ensure API responses mask fields where UI expects masked values.
