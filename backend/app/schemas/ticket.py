"""Support tickets — recruiters/employees raise issues; super admins triage and resolve."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

TICKET_STATUSES = {"open", "in_progress", "waiting", "resolved", "closed"}
TICKET_PRIORITIES = {"low", "medium", "high", "critical"}
TICKET_CATEGORIES = {
    "bug_report",
    "feature_request",
    "performance",
    "ui_issue",
    "login_issue",
    "permission_issue",
    "ai_assistant",
    "recruitment",
    "employee_module",
    "learning",
    "analytics",
    "billing",
    "security",
    "integration",
    "api",
    "other",
}
TICKET_MODULES = {
    "recruitment",
    "employees",
    "learning",
    "analytics",
    "ai",
    "reports",
    "dashboard",
    "organization",
    "settings",
    "system",
}

_UPDATE_FIELDS = (
    "subject",
    "description",
    "category",
    "priority",
    "affected_module",
    "browser",
    "os",
    "steps_to_reproduce",
    "expected_behaviour",
    "actual_behaviour",
    "additional_notes",
)


def _strip(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _require_in(value: str, allowed: set[str], label: str) -> str:
    cleaned = (value or "").strip().lower()
    if cleaned not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(sorted(allowed))}.")
    return cleaned


class TicketCreateRequest(BaseModel):
    subject: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=10, max_length=50000)
    category: str
    priority: str
    affected_module: str
    browser: str | None = Field(default=None, max_length=200)
    os: str | None = Field(default=None, max_length=200)
    steps_to_reproduce: str | None = Field(default=None, max_length=20000)
    expected_behaviour: str | None = Field(default=None, max_length=20000)
    actual_behaviour: str | None = Field(default=None, max_length=20000)
    additional_notes: str | None = Field(default=None, max_length=20000)

    @field_validator(
        "subject",
        "description",
        "browser",
        "os",
        "steps_to_reproduce",
        "expected_behaviour",
        "actual_behaviour",
        "additional_notes",
    )
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return _strip(value)

    @field_validator("subject", "description")
    @classmethod
    def require_non_empty(cls, value: str | None) -> str | None:
        cleaned = _strip(value)
        if not cleaned:
            raise ValueError("This field is required.")
        return cleaned

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        return _require_in(value, TICKET_CATEGORIES, "category")

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, value: str) -> str:
        return _require_in(value, TICKET_PRIORITIES, "priority")

    @field_validator("affected_module")
    @classmethod
    def validate_module(cls, value: str) -> str:
        return _require_in(value, TICKET_MODULES, "affected_module")


class TicketUpdateRequest(BaseModel):
    subject: str | None = Field(default=None, min_length=5, max_length=200)
    description: str | None = Field(default=None, min_length=10, max_length=50000)
    category: str | None = None
    priority: str | None = None
    affected_module: str | None = None
    browser: str | None = Field(default=None, max_length=200)
    os: str | None = Field(default=None, max_length=200)
    steps_to_reproduce: str | None = Field(default=None, max_length=20000)
    expected_behaviour: str | None = Field(default=None, max_length=20000)
    actual_behaviour: str | None = Field(default=None, max_length=20000)
    additional_notes: str | None = Field(default=None, max_length=20000)

    @field_validator(
        "subject",
        "description",
        "browser",
        "os",
        "steps_to_reproduce",
        "expected_behaviour",
        "actual_behaviour",
        "additional_notes",
    )
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return _strip(value)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _require_in(value, TICKET_CATEGORIES, "category")

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _require_in(value, TICKET_PRIORITIES, "priority")

    @field_validator("affected_module")
    @classmethod
    def validate_module(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _require_in(value, TICKET_MODULES, "affected_module")

    @model_validator(mode="after")
    def require_change(self):
        if all(getattr(self, field) is None for field in _UPDATE_FIELDS):
            raise ValueError("At least one ticket field must be provided.")
        return self


class TicketReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=50000)

    @field_validator("message")
    @classmethod
    def require_message(cls, value: str | None) -> str | None:
        cleaned = _strip(value)
        if not cleaned:
            raise ValueError("Message is required.")
        return cleaned


class TicketAssignRequest(BaseModel):
    assignee_id: str = Field(min_length=1, max_length=120)

    @field_validator("assignee_id")
    @classmethod
    def strip_id(cls, value: str) -> str:
        return value.strip()


class TicketStatusUpdateRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        return _require_in(value, TICKET_STATUSES, "status")


class TicketPriorityUpdateRequest(BaseModel):
    priority: str

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, value: str) -> str:
        return _require_in(value, TICKET_PRIORITIES, "priority")


class TicketMergeRequest(BaseModel):
    target_ticket_id: str = Field(min_length=1, max_length=120)

    @field_validator("target_ticket_id")
    @classmethod
    def strip_id(cls, value: str) -> str:
        return value.strip()
