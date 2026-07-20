"""Tests for email acceptance and profile-photo validation helpers."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.auth import BootstrapSuperAdminRequest, RegisterRequest


def _register_payload(**overrides):
    base = {
        "full_name": "Test Recruiter",
        "email": "recruiter@company.com",
        "phone": "03001234567",
        "password": "SecurePass1!",
        "confirm_password": "SecurePass1!",
        "terms_accepted": True,
    }
    base.update(overrides)
    return base


def test_register_accepts_non_gmail_emails():
    for email in (
        "person@company.com",
        "hr@mazikglobal.com",
        "user.name+tag@outlook.com",
        "admin@yahoo.co.uk",
    ):
        model = RegisterRequest(**_register_payload(email=email))
        assert model.email == email.lower()


def test_register_still_rejects_invalid_email_shape():
    with pytest.raises(ValidationError):
        RegisterRequest(**_register_payload(email="not-an-email"))


def test_bootstrap_super_admin_accepts_any_valid_email():
    model = BootstrapSuperAdminRequest(
        full_name="Super Admin",
        email="admin@mazikglobal.com",
        phone="03001234567",
        password="SecurePass1!",
        confirm_password="SecurePass1!",
    )
    assert model.email == "admin@mazikglobal.com"


def test_profile_photo_allowed_extensions():
    from app.services.profile_photo_service import ALLOWED_EXTENSIONS, MAX_BYTES

    assert ".png" in ALLOWED_EXTENSIONS
    assert ".jpg" in ALLOWED_EXTENSIONS
    assert ".jpeg" in ALLOWED_EXTENSIONS
    assert ".webp" in ALLOWED_EXTENSIONS
    assert ".pdf" not in ALLOWED_EXTENSIONS
    assert MAX_BYTES == 5 * 1024 * 1024


@pytest.mark.asyncio
async def test_save_profile_photo_rejects_non_image(monkeypatch):
    from fastapi import UploadFile, HTTPException
    from io import BytesIO
    from app.services import profile_photo_service

    upload = UploadFile(filename="resume.pdf", file=BytesIO(b"%PDF-1.4"))
    with pytest.raises(HTTPException) as exc:
        await profile_photo_service.save_profile_photo("user-1", upload)
    assert exc.value.status_code == 400
    assert "PNG" in exc.value.detail
