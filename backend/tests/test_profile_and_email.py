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


def test_offer_invitation_email_includes_offer_details(monkeypatch):
    from app.services.email_service import EmailService

    service = EmailService()
    captured = {}

    def fake_send(to_email, subject, html_body):
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["html_body"] = html_body

    monkeypatch.setattr(service, "_send", fake_send)

    service.send_offer_invitation_email(
        to_email="candidate@example.com",
        full_name="Ali Khan",
        job_title="Software Engineer",
        department="Engineering",
        start_date="2026-08-01",
        currency="PKR",
        monthly_salary="250000",
        invite_link="https://example.com/invite/test-token",
        expires_at="August 01, 2026",
    )

    assert captured["to_email"] == "candidate@example.com"
    assert "Invitation" in captured["subject"]
    assert "Ali Khan" in captured["html_body"]
    assert "Software Engineer" in captured["html_body"]
    assert "PKR 250000" in captured["html_body"]
    assert "https://example.com/invite/test-token" in captured["html_body"]


@pytest.mark.asyncio
async def test_agent_send_invitation_forwards_offer_payload(monkeypatch):
    from app.core.rbac import CurrentUser
    from app.services import agent_tools

    captured = {}

    async def fake_create_invitation(request, actor):
        captured["request"] = request
        captured["actor"] = actor
        return {
            "message": "Invitation and offer letter created and emailed to the candidate.",
            "email_sent": True,
            "invitation": {"token": "test-token", "email": request.email},
        }

    monkeypatch.setattr(agent_tools.invitation_service, "create_invitation", fake_create_invitation)

    user = CurrentUser(
        id="recruiter-1",
        email="recruiter@example.com",
        full_name="Test Recruiter",
        role="recruiter",
        access_token="token",
    )
    result = await agent_tools._tool_send_invitation(
        user,
        {
            "email": "candidate@example.com",
            "full_name": "Test Candidate",
            "job_title": "Intern, IT",
            "department": "IT",
            "reporting_manager": "Sara Ali",
            "monthly_salary": 1000,
            "currency": "PKR",
            "employment_type": "Internship",
            "start_date": "2026-07-31",
            "offer_expiry_days": 14,
        },
    )

    assert result.ok is True
    assert captured["actor"].id == "recruiter-1"
    assert captured["request"].offer.reporting_manager == "Sara Ali"
    assert captured["request"].offer.monthly_salary == 1000
    assert captured["request"].offer.currency == "PKR"
    assert captured["request"].offer.start_date == "2026-07-31"
    assert result.data["message"] == "Invitation sent to candidate@example.com."


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
