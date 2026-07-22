"""Schemas for internal employee career timeline (promotions, role changes)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CareerEventType = Literal[
    "joined",
    "promoted",
    "title_change",
    "department_change",
    "manager_change",
    "status_change",
]


class RoleAssignRequest(BaseModel):
    """Recruiter assigns or changes designation + department (from org taxonomy lists)."""

    job_title: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    event_type: Literal["promoted", "title_change", "department_change"] = "title_change"
    effective_date: date | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("job_title", "department")
    @classmethod
    def normalize_required(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def infer_event_type(self):
        # Keep explicit event_type from client; default stays title_change.
        return self


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
