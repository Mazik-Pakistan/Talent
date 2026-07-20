"""Recruiter onboarding assignment schemas: company email, assets, orientation."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator


class CompanyEmailRequest(BaseModel):
    company_email: EmailStr


class AssetAssignRequest(BaseModel):
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


class AssetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    asset_type: str | None = Field(default=None, max_length=64)
    serial_number: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, pattern="^(assigned|returned|lost|retired)$")


class OrientationScheduleRequest(BaseModel):
    date: str = Field(min_length=8, max_length=32, description="ISO date YYYY-MM-DD")
    time: str = Field(min_length=1, max_length=32, description="Local time HH:MM")
    meeting_link: str | None = Field(default=None, max_length=500)
    trainer: str = Field(min_length=1, max_length=120)
    agenda: str = Field(min_length=1, max_length=2000)

    @field_validator("date", "time", "trainer", "agenda")
    @classmethod
    def strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field is required.")
        return cleaned

    @field_validator("meeting_link")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
