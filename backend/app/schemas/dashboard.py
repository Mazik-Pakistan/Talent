from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class MarkNotificationsReadRequest(BaseModel):
    """US-014: mark one/many notifications as read, or all of them."""

    ids: list[str] = Field(default_factory=list)
    all: bool = False

    @model_validator(mode="after")
    def require_target(self):
        if not self.all and not self.ids:
            raise ValueError("Provide notification ids or set all=true.")
        return self


AudienceLiteral = Literal["candidates", "employees", "both"]


class CreateAnnouncementRequest(BaseModel):
    """US-020: recruiters publish announcements to candidates and/or employees."""

    title: str = Field(min_length=3, max_length=150)
    body: str = Field(min_length=3, max_length=4000)
    audience: AudienceLiteral = "both"
    send_email: bool = True

    @model_validator(mode="after")
    def normalize(self):
        self.title = " ".join(self.title.split())
        self.body = self.body.strip()
        return self


class UpdateAnnouncementRequest(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=150)
    body: str | None = Field(default=None, min_length=3, max_length=4000)
    audience: AudienceLiteral | None = None
    send_email: bool = False
    notify_again: bool = False

    @model_validator(mode="after")
    def require_some_field(self):
        if self.title is None and self.body is None and self.audience is None:
            raise ValueError("Provide at least one field to update.")
        if self.title is not None:
            self.title = " ".join(self.title.split())
        if self.body is not None:
            self.body = self.body.strip()
        return self


class UpdateRecruiterProfileRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=20)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)

    @field_validator("full_name", "department", "job_title", "office_location")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
