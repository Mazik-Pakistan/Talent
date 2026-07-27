"""IT provisioning schemas — public form + recruiter send/remind."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator


ASSET_TYPES = ("laptop", "monitor", "phone", "headset", "badge", "license", "other")


class SendItProvisioningRequest(BaseModel):
    offer_id: str = Field(min_length=1)
    it_manager_email: EmailStr | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("offer_id")
    @classmethod
    def strip_offer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for note."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class RemindItProvisioningRequest(BaseModel):
    offer_id: str = Field(min_length=1)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("offer_id")
    @classmethod
    def strip_offer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for note."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class ItAssetItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    asset_type: str = Field(default="other", max_length=64)
    serial_number: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name", "asset_type")
    @classmethod
    def strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field is required.")
        return cleaned

    @field_validator("asset_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        lowered = value.strip().lower()
        if lowered not in ASSET_TYPES:
            return "other"
        return lowered

    @field_validator("name", "asset_type", "serial_number", "notes")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for text fields."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("serial_number", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ItLicenseItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    vendor: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("License name is required.")
        return cleaned

    @field_validator("vendor", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ItProvisioningSubmitRequest(BaseModel):
    company_email: EmailStr
    company_email_password: str = Field(min_length=4, max_length=128)
    assets: list[ItAssetItem] = Field(default_factory=list, max_length=40)
    licenses: list[ItLicenseItem] = Field(default_factory=list, max_length=40)
    it_notes: str | None = Field(default=None, max_length=2000)
    submitted_by_name: str | None = Field(default=None, max_length=120)

    @field_validator("company_email_password")
    @classmethod
    def strip_password(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 4:
            raise ValueError("Company email password must be at least 4 characters.")
        return cleaned

    @field_validator("it_notes", "submitted_by_name")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class RevealCompanyEmailPasswordRequest(BaseModel):
    otp: str = Field(min_length=4, max_length=12)

    @field_validator("otp")
    @classmethod
    def strip_otp(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("OTP is required.")
        return cleaned
