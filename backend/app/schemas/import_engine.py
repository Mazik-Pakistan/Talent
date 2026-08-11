"""Universal Import Engine schemas (Phase 2).

Provider-agnostic import validation, preview, commit, and history.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

RowStatus = Literal["new", "updated", "duplicate", "invalid", "skipped"]
MissingAction = Literal["keep", "archive", "delete"]

IMPORT_MAX_SIZE_BYTES = 8 * 1024 * 1024
IMPORT_MAX_ROWS = 5000


def _clean_required_text(value: str) -> str:
    return " ".join(value.split())


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


class ImportCourseCreateRequest(BaseModel):
    """Create a single course through the Import Engine (sets provider_id)."""

    provider_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=1000)
    external_id: str | None = Field(default=None, max_length=200)
    designation: str = Field(default="", max_length=120)
    learning_month: str = Field(default="", max_length=120)
    category: str = Field(default="", max_length=120)
    competency: str = Field(default="", max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=1, le=20000)
    instructor: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list)
    archived: bool = False

    @field_validator("title", "designation", "learning_month", "category", "competency")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return _clean_required_text(value)

    @field_validator("external_id", "instructor")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)

    @field_validator("url")
    @classmethod
    def clean_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import validate_url_format

        return validate_url_format(value, "course URL")

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html

        return sanitize_html(value)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value or []:
            text = _clean_optional_text(item)
            if text and text not in cleaned:
                cleaned.append(text)
        return cleaned


class ImportCourseUpdateRequest(BaseModel):
    """Update a single course through the Import Engine."""

    provider_id: str | None = Field(default=None, min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=1000)
    external_id: str | None = Field(default=None, max_length=200)
    designation: str | None = Field(default=None, max_length=120)
    learning_month: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=120)
    competency: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=1, le=20000)
    instructor: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = None
    archived: bool | None = None

    @field_validator("title", "designation", "learning_month", "category", "competency")
    @classmethod
    def clean_optional_required_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _clean_required_text(value)

    @field_validator("external_id", "instructor")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)

    @field_validator("url")
    @classmethod
    def clean_optional_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import validate_url_format

        return validate_url_format(value, "course URL")

    @field_validator("description")
    @classmethod
    def clean_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html

        return sanitize_html(value)

    @field_validator("tags")
    @classmethod
    def clean_optional_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            text = _clean_optional_text(item)
            if text and text not in cleaned:
                cleaned.append(text)
        return cleaned


class ImportIssue(BaseModel):
    """A single validation issue on an import row."""
    row: int | None = None
    field: str | None = None
    message: str
    severity: Literal["error", "warning"] = "error"


class ImportPreviewRow(BaseModel):
    """Preview of a single row before commit."""
    row: int
    status: RowStatus = "new"
    external_id: str | None = None
    title: str | None = None
    url: str | None = None
    provider: str | None = None
    designation: str | None = None
    learning_month: str | None = None
    category: str | None = None
    competency: str | None = None
    duration_minutes: int | None = None
    description: str | None = None
    instructor: str | None = None
    tags: list[str] = Field(default_factory=list)
    issues: list[ImportIssue] = Field(default_factory=list)
    existing_id: str | None = None
    match_method: str | None = None  # external_id | url | provider_name


class FileLevelIssue(BaseModel):
    """File-level validation problem (blocks import)."""
    code: str  # unsupported_format, too_large, too_many_rows, corrupted, no_header, ...
    message: str


class ImportPreview(BaseModel):
    """Full validation preview returned before commit."""
    provider_id: str | None = None
    provider_name: str | None = None
    filename: str | None = None
    sheet_name: str | None = None
    total_rows: int = 0
    new_courses: int = 0
    updated_courses: int = 0
    duplicate_rows: int = 0
    invalid_rows: int = 0
    skipped_rows: int = 0
    rows: list[ImportPreviewRow] = Field(default_factory=list)
    file_issues: list[FileLevelIssue] = Field(default_factory=list)
    valid: bool = True


class ImportHistoryEntry(BaseModel):
    """A recorded import/sync run."""
    id: str
    provider_id: str | None
    provider_name: str | None
    imported_by_id: str
    imported_by_name: str | None
    import_type: Literal["excel", "api"] = "excel"
    status: Literal["completed", "failed", "rolled_back"] = "completed"
    filename: str | None = None
    rows_total: int = 0
    rows_imported: int = 0
    rows_updated: int = 0
    rows_failed: int = 0
    rows_archived: int = 0
    rows_deleted: int = 0
    validation_summary: dict = Field(default_factory=dict)
    message: str | None = None
    created_at: datetime
    rollback_at: datetime | None = None
