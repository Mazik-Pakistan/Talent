"""US-036..US-050: Document Management & Verification schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

DOCUMENT_CATEGORIES = ("identity", "education", "employment", "banking", "legal", "other")

DOCUMENT_TYPES = (
    "cnic",
    "passport",
    "degree",
    "transcript",
    "certificate",
    "experience_letter",
    "relieving_letter",
    "salary_certificate",
    "reference_letter",
    "resume",
    "other",
)

DOCUMENT_STATUSES = (
    "uploaded",
    "processing",
    "ocr_pending",
    "pending_verification",
    "verified",
    "rejected",
    "reupload_required",
)

REJECTION_REASONS = (
    "blurry_or_unreadable",
    "wrong_document_type",
    "expired_document",
    "information_mismatch",
    "incomplete_document",
    "other",
)


class DocumentVerifyRequest(BaseModel):
    status: str = Field(..., description="verified | rejected | reupload_required")
    rejection_reason: str | None = None
    note: str | None = None
