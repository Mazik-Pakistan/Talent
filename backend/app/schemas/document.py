"""US-036..US-050: Document Management & Verification schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

DOCUMENT_CATEGORIES = ("identity", "education", "employment", "banking", "legal", "other")

# Profile auto-fill allowed document types (identity = CNIC or Passport only).
PROFILE_IDENTITY_TYPES = ("cnic", "passport")
PROFILE_DOCUMENT_TYPES = ("cnic", "passport", "resume", "transcript")

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
    "mismatch",
    "deleted",
)

VERIFICATION_STATUSES = (
    "pending",
    "verified",
    "mismatch",
    "rejected",
    "reupload_required",
)

# Classification categories returned by the extraction engine.
EXTRACTION_CATEGORIES = (
    "cnic",
    "passport",
    "resume",
    "academic_transcript",
    "certificate",
    "payroll",
    "invoice",
    "driving_license",
    "unknown",
)

# purpose → accepted extraction categories
PURPOSE_EXPECTED_CATEGORIES = {
    "resume": ("resume",),
    "government_doc": ("cnic", "passport"),
    "education_cert": ("academic_transcript",),
    "identity": ("cnic", "passport"),
    "cnic": ("cnic",),
    "passport": ("passport",),
    "transcript": ("academic_transcript",),
}

PURPOSE_REJECT_MESSAGES = {
    "resume": "Uploaded document is not a valid resume.",
    "government_doc": "This is not a valid National ID or Passport.",
    "cnic": "This is not a valid National ID.",
    "passport": "This is not a valid passport.",
    "education_cert": "Uploaded document is not a valid academic transcript.",
    "transcript": "Uploaded document is not a valid academic transcript.",
    "identity": "This is not a valid National ID or Passport.",
}

REJECTION_REASONS = (
    "blurry_or_unreadable",
    "wrong_document_type",
    "expired_document",
    "information_mismatch",
    "incomplete_document",
    "other",
)


class DocumentVerifyRequest(BaseModel):
    status: str = Field(..., description="verified | rejected | reupload_required | mismatch")
    rejection_reason: str | None = None
    note: str | None = None
    # Recruiter judgment override when approving despite mismatches
    approve_despite_mismatch: bool = False


class MismatchItem(BaseModel):
    field: str
    reason: str
    values: dict[str, str | None] = Field(default_factory=dict)
    sources: list[str] = Field(default_factory=list)
