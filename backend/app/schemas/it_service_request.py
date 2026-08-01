"""IT service requests — post-activation IT help (e.g. replacement laptop)."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.it_provisioning import ItAssetItem

REQUEST_TYPES = {"new_asset", "replacement", "license", "access", "other"}


def _strip(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _require_type(value: str) -> str:
    cleaned = (value or "").strip().lower()
    if cleaned not in REQUEST_TYPES:
        raise ValueError(f"request_type must be one of {', '.join(sorted(REQUEST_TYPES))}.")
    return cleaned


class ItServiceRequestCreate(BaseModel):
    """Recruiter/HR raises an IT help request for an existing employee."""

    employee_id: str = Field(min_length=1, max_length=120)
    request_type: str
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    it_manager_email: EmailStr | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("employee_id", "title", "description", "note")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return _strip(value)

    @field_validator("title")
    @classmethod
    def require_title(cls, value: str | None) -> str | None:
        cleaned = _strip(value)
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("request_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        return _require_type(value)


class ItServiceRequestEmployeeCreate(BaseModel):
    """Employee asks HR for IT help; the recruiter reviews and sends it to IT."""

    request_type: str
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("title", "description")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return _strip(value)

    @field_validator("title")
    @classmethod
    def require_title(cls, value: str | None) -> str | None:
        cleaned = _strip(value)
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("request_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        return _require_type(value)


class ItServiceRequestSendRequest(BaseModel):
    request_id: str
    it_manager_email: EmailStr
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("request_id")
    @classmethod
    def strip_id(cls, value: str) -> str:
        return value.strip()


class ItServiceRequestCancelRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str | None) -> str | None:
        return _strip(value)


class ItServiceRequestFulfillRequest(BaseModel):
    fulfillment_note: str | None = Field(default=None, max_length=2000)
    serial_number: str | None = Field(default=None, max_length=120)
    items: list[ItAssetItem] = Field(default_factory=list, max_length=20)

    @field_validator("fulfillment_note", "serial_number")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return _strip(value)
