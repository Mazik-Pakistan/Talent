"""Schemas for internal employee career timeline (promotions, role changes)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

CareerEventType = Literal[
    "joined",
    "promoted",
    "title_change",
    "department_change",
    "manager_change",
    "status_change",
]


class CareerEventCreateRequest(BaseModel):
    event_type: CareerEventType
    effective_date: date
    from_title: str | None = Field(default=None, max_length=120)
    to_title: str | None = Field(default=None, max_length=120)
    from_department: str | None = Field(default=None, max_length=120)
    to_department: str | None = Field(default=None, max_length=120)
    from_manager: str | None = Field(default=None, max_length=120)
    to_manager: str | None = Field(default=None, max_length=120)
    from_status: str | None = Field(default=None, max_length=40)
    to_status: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator(
        "from_title",
        "to_title",
        "from_department",
        "to_department",
        "from_manager",
        "to_manager",
        "from_status",
        "to_status",
        "note",
    )
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
