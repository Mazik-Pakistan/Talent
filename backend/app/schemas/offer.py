"""Offer Letter cycle schemas — sits between candidate intake and employee activation.

Flow: Recruiter reviews submitted intake -> creates & sends Offer Letter ->
Candidate digitally signs -> Recruiter/HR approves -> candidate becomes Employee.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

OFFER_STATUSES = ("draft", "sent", "viewed", "signed", "approved", "declined", "expired", "withdrawn")


class OfferCreateRequest(BaseModel):
    candidate_id: str
    job_title: str = Field(..., min_length=2)
    department: str = Field(..., min_length=2)
    employment_type: str = Field(default="Full-time")
    office_location: str | None = None
    reporting_manager: str = Field(..., min_length=2, max_length=120)
    start_date: str
    monthly_salary: float | None = Field(default=None, ge=0)
    currency: str = Field(default="PKR")
    offer_expiry_days: int | None = Field(default=None, ge=1, le=90)
    terms: str = Field(
        default=(
            "This offer is contingent upon verification of the documents you have submitted. "
            "By signing this letter you accept the position, compensation, and terms described above, "
            "and agree to Team Talent's confidentiality and employment policies."
        ),
        max_length=8000,
    )
    message_to_candidate: str | None = Field(default=None, max_length=2000)

    @field_validator("job_title", "department", "reporting_manager")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class OfferSignRequest(BaseModel):
    full_legal_name: str = Field(..., min_length=2)
    signature_data_url: str | None = Field(
        default=None, description="Base64 PNG data URL captured from the signature pad."
    )
    agreed: bool

    @field_validator("agreed")
    @classmethod
    def _must_agree(cls, value: bool) -> bool:
        if not value:
            raise ValueError("You must agree to the offer terms to sign.")
        return value


class OfferDeclineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class OfferApproveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
