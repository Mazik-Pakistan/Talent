"""Offer Letter cycle schemas.

Flow: Recruiter invites with offer -> candidate signs (or one-round negotiate -> v2) ->
documents -> IT provisioning -> activate employee.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

OFFER_STATUSES = (
    "draft",
    "sent",
    "viewed",
    "signed",
    "approved",
    "declined",
    "expired",
    "withdrawn",
)

DEFAULT_OFFER_TERMS = (
    "This offer is contingent upon verification of the documents you submit after signing. "
    "By signing this letter you accept the position, compensation, benefits, and terms described above, "
    "and agree to Mazik Global Pakistan's confidentiality and employment policies."
)

DEFAULT_BENEFITS = (
    "Medical insurance",
    "Provident fund",
    "Annual leave",
    "Hybrid / remote flexibility",
    "Company laptop",
    "Learning & training budget",
    "Fuel / conveyance allowance",
    "Performance bonus eligibility",
)


class SalaryBreakdownItem(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    amount: float = Field(..., ge=0)

    @field_validator("label")
    @classmethod
    def _strip_label(cls, value: str) -> str:
        return " ".join(value.split())


class BenefitItem(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    label: str = Field(..., min_length=1, max_length=160)
    selected: bool = True

    @field_validator("label")
    @classmethod
    def _strip_label(cls, value: str) -> str:
        return " ".join(value.split())


class OfferTermsPayload(BaseModel):
    """Shared offer fields used at invite time and for legacy create_offer."""

    job_title: str = Field(..., min_length=2, max_length=120)
    department: str = Field(..., min_length=2, max_length=120)
    employment_type: str = Field(default="Full-time", max_length=80)
    office_location: str | None = Field(default=None, max_length=120)
    # Remote: employee completes banking in profile. On-site: recruiter manages banking.
    is_remote: bool = False
    reporting_manager: str = Field(..., min_length=2, max_length=120)
    start_date: str = Field(..., min_length=4, max_length=40)
    monthly_salary: float = Field(..., ge=0)
    currency: str = Field(default="PKR", max_length=8)
    # Allowances paid on top of monthly_salary (also accepted as salary_breakdown for older clients).
    salary_breakdown: list[SalaryBreakdownItem] = Field(default_factory=list)
    allowances: list[SalaryBreakdownItem] = Field(default_factory=list)
    benefits: list[BenefitItem] = Field(default_factory=list)
    offer_expiry_days: int | None = Field(default=None, ge=1, le=90)
    terms: str = Field(default=DEFAULT_OFFER_TERMS, max_length=8000)
    message_to_candidate: str | None = Field(default=None, max_length=2000)

    @field_validator("job_title", "department", "reporting_manager", "employment_type", "currency")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("office_location")
    @classmethod
    def _strip_opt(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("start_date")
    @classmethod
    def _normalize_start_date(cls, value: str) -> str:
        normalized = " ".join(str(value or "").split())
        if "T" in normalized:
            normalized = normalized.split("T", 1)[0]
        return normalized

    @model_validator(mode="after")
    def _merge_allowances(self) -> OfferTermsPayload:
        # Prefer explicit allowances; otherwise keep salary_breakdown (legacy).
        if self.allowances:
            self.salary_breakdown = list(self.allowances)
        elif self.salary_breakdown:
            self.allowances = list(self.salary_breakdown)
        return self


class OfferCreateRequest(OfferTermsPayload):
    candidate_id: str


class OfferSignRequest(BaseModel):
    full_legal_name: str = Field(..., min_length=2)
    signature_data_url: str | None = Field(
        default=None, description="Base64 PNG data URL captured from the signature pad."
    )
    signature_upload_url: str | None = Field(
        default=None, description="Cloud storage URL for an uploaded signature image/PDF."
    )
    signature_method: str = Field(default="pad", pattern="^(pad|upload)$")
    agreed: bool

    @field_validator("agreed")
    @classmethod
    def _must_agree(cls, value: bool) -> bool:
        if not value:
            raise ValueError("You must agree to the offer terms to sign.")
        return value

    @model_validator(mode="after")
    def _require_signature(self) -> OfferSignRequest:
        if self.signature_method == "pad" and not self.signature_data_url:
            raise ValueError("Draw your signature on the pad, or switch to upload.")
        if self.signature_method == "upload" and not self.signature_upload_url:
            raise ValueError("Upload a signature file (PNG, JPG, or PDF).")
        return self


class OfferDeclineRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class OfferApproveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    force: bool = Field(default=False, description="Allow approval even if the offer has expired.")


class OfferExtendValidityRequest(BaseModel):
    extra_days: int = Field(default=7, ge=1, le=90, description="How many days to extend the offer from now.")
    note: str | None = Field(default=None, max_length=1000)


class OfferEditResendRequest(OfferTermsPayload):
    """Recruiter edits offer terms after a candidate clarification and resends as a new version."""

    recruiter_note: str | None = Field(default=None, max_length=2000)
    decision_summary: str | None = Field(default=None, max_length=2000)


class OfferNegotiateRequest(BaseModel):
    proposed_salary: float | None = Field(default=None, ge=0)
    proposed_start_date: str | None = Field(default=None, min_length=4, max_length=40)
    proposed_salary_breakdown: list[SalaryBreakdownItem] = Field(default_factory=list)
    proposed_benefits: list[BenefitItem] = Field(default_factory=list)
    requested_changes: list[str] = Field(default_factory=list)
    note: str = Field(..., min_length=1, max_length=2000)

    @field_validator("requested_changes")
    @classmethod
    def _normalize_requested_changes(cls, values: list[str]) -> list[str]:
        out: list[str] = []
        for value in values or []:
            normalized = " ".join(str(value or "").split()).lower()
            if normalized and normalized not in out:
                out.append(normalized)
        return out

    @model_validator(mode="after")
    def _validate_proposed_breakdown(self) -> OfferNegotiateRequest:
        if self.proposed_salary_breakdown and self.proposed_salary is not None:
            total = sum(item.amount for item in self.proposed_salary_breakdown)
            if total - self.proposed_salary > 0.01:
                raise ValueError("Proposed salary breakdown total cannot exceed proposed salary.")
        return self


class NegotiationRespondRequest(BaseModel):
    recruiter_note: str | None = Field(default=None, max_length=2000)
    revised_salary: float | None = Field(default=None, ge=0)
    revised_start_date: str | None = Field(default=None, min_length=4, max_length=40)
    revised_salary_breakdown: list[SalaryBreakdownItem] = Field(default_factory=list)
    revised_benefits: list[BenefitItem] = Field(default_factory=list)
    decision_summary: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _validate_revised_breakdown(self) -> NegotiationRespondRequest:
        if self.revised_salary_breakdown and self.revised_salary is not None:
            total = sum(item.amount for item in self.revised_salary_breakdown)
            if total - self.revised_salary > 0.01:
                raise ValueError("Revised salary breakdown total cannot exceed revised salary.")
        return self
