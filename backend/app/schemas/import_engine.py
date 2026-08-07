"""Universal Import Engine schemas (Phase 2).

Provider-agnostic import validation, preview, commit, and history.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RowStatus = Literal["new", "updated", "duplicate", "invalid", "skipped"]
MissingAction = Literal["keep", "archive", "delete"]

IMPORT_MAX_SIZE_BYTES = 8 * 1024 * 1024
IMPORT_MAX_ROWS = 5000


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
