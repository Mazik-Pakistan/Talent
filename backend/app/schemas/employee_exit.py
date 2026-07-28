"""Employee exit / historical employment schemas."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

EmployeeExitType = Literal["resigned", "terminated", "exited"]


class EmployeeExitRequest(BaseModel):
    exit_type: EmployeeExitType
    exit_date: date | None = None
    exit_reason: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=2000)
    lock_profile: bool = True

    @field_validator("exit_reason", "note")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
