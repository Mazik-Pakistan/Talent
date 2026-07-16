"""Encrypt sensitive banking fields at rest (US-031)."""

from __future__ import annotations

import hashlib
import base64

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    raw = (settings.BANKING_ENCRYPTION_KEY or "").strip()
    if not raw:
        # Deterministic fallback from SECRET_KEY so local/dev still works;
        # production must set BANKING_ENCRYPTION_KEY explicitly.
        digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
        raw = base64.urlsafe_b64encode(digest).decode("ascii")
    try:
        return Fernet(raw.encode("ascii") if isinstance(raw, str) else raw)
    except Exception:
        digest = hashlib.sha256(raw.encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(value: str | None) -> str | None:
    if value is None:
        return None
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_text(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        # Already plaintext (legacy) or wrong key
        return value


def iban_fingerprint(iban: str) -> str:
    normalized = iban.replace(" ", "").upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


SENSITIVE_BANKING_FIELDS = (
    "account_number",
    "iban",
    "tax_id",
    "swift_code",
)


def encrypt_banking_payload(data: dict) -> dict:
    """Return a copy with sensitive fields encrypted + iban_hash for uniqueness."""
    out = dict(data)
    iban = out.get("iban")
    if iban:
        out["iban_hash"] = iban_fingerprint(iban)
    for field in SENSITIVE_BANKING_FIELDS:
        if out.get(field):
            out[field] = encrypt_text(str(out[field]))
    out["encrypted"] = True
    return out


def decrypt_banking_payload(data: dict | None, *, mask: bool = False) -> dict | None:
    if not data:
        return None
    out = dict(data)
    for field in SENSITIVE_BANKING_FIELDS:
        if out.get(field):
            plain = decrypt_text(str(out[field]))
            if mask and plain:
                if field == "iban" and len(plain) > 8:
                    out[field] = plain[:4] + "****" + plain[-4:]
                elif field == "account_number" and len(plain) > 4:
                    out[field] = "****" + plain[-4:]
                else:
                    out[field] = "********"
            else:
                out[field] = plain
    out.pop("iban_hash", None)
    out.pop("encrypted", None)
    return out
