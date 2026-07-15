from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.auth import PASSWORD_PATTERN, PHONE_PATTERN


class CreateInvitationRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    job_title: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)
    start_date: date | None = None
    expires_in_days: int = Field(default=7, ge=1, le=30)

    @field_validator("full_name", "job_title", "department")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Value must contain at least two characters.")
        return normalized

    @field_validator("office_location")
    @classmethod
    def normalize_office_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return value.lower()


class CandidateRegisterRequest(BaseModel):
    invitation_token: str = Field(min_length=16)
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str
    password: str
    confirm_password: str
    terms_accepted: bool

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Full name must contain at least two characters.")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return value.lower()

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid phone number.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not PASSWORD_PATTERN.fullmatch(value):
            raise ValueError(
                "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
            )
        return value

    @model_validator(mode="after")
    def validate_registration(self):
        if self.password != self.confirm_password:
            raise ValueError("Password confirmation does not match.")
        if not self.terms_accepted:
            raise ValueError("You must accept the Terms & Conditions.")
        return self


class OnboardingPersonalInfo(BaseModel):
    date_of_birth: date
    national_id: str = Field(min_length=5, max_length=40)
    address_line1: str = Field(min_length=3, max_length=200)
    address_line2: str = Field(default="", max_length=200)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(min_length=3, max_length=20)
    country: str = Field(min_length=2, max_length=100)


class OnboardingEmergencyContact(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    relationship: str = Field(min_length=2, max_length=60)
    phone: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid phone number.")
        return normalized


class OnboardingEmploymentInfo(BaseModel):
    bank_name: str = Field(min_length=2, max_length=100)
    account_holder_name: str = Field(min_length=2, max_length=100)
    account_number: str = Field(min_length=4, max_length=40)
    tax_id: str = Field(min_length=4, max_length=40)


class EducationEntry(BaseModel):
    institution: str = Field(min_length=2, max_length=200)
    degree: str = Field(min_length=2, max_length=120)
    field_of_study: str = Field(min_length=2, max_length=120)
    year_completed: str = Field(min_length=4, max_length=4)
    certificate_file: str | None = None


class OnboardingEducationInfo(BaseModel):
    entries: list[EducationEntry] = Field(min_length=1)


class GovernmentDocument(BaseModel):
    doc_type: Literal["cnic", "passport", "other_id"]
    document_number: str = Field(min_length=5, max_length=60)
    file_name: str | None = None
    file_url: str | None = None


class OnboardingGovernmentDocs(BaseModel):
    documents: list[GovernmentDocument] = Field(min_length=1)


class ReferenceEntry(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    relationship: str = Field(min_length=2, max_length=60)
    email: EmailStr
    phone: str
    company: str = Field(min_length=2, max_length=120)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid phone number.")
        return normalized


class OnboardingReferences(BaseModel):
    references: list[ReferenceEntry] = Field(min_length=2, max_length=5)


class OnboardingDocumentsAck(BaseModel):
    accepted_code_of_conduct: bool
    accepted_privacy_policy: bool
    accepted_employee_handbook: bool

    @model_validator(mode="after")
    def require_acceptances(self):
        if not (
            self.accepted_code_of_conduct
            and self.accepted_privacy_policy
            and self.accepted_employee_handbook
        ):
            raise ValueError("You must acknowledge all required documents.")
        return self


class OnboardingSignature(BaseModel):
    full_legal_name: str = Field(min_length=2, max_length=100)
    agreed: bool
    signed_at: str | None = None

    @model_validator(mode="after")
    def require_agreement(self):
        if not self.agreed:
            raise ValueError("You must agree to sign this document.")
        return self


class OnboardingResume(BaseModel):
    summary: str = Field(min_length=20, max_length=2000)
    file_name: str | None = None
    file_url: str | None = None

    @model_validator(mode="after")
    def require_file(self):
        if not self.file_url and not self.file_name:
            raise ValueError("Upload a resume file before continuing.")
        return self


ONBOARDING_STEPS = Literal[
    "personal",
    "emergency",
    "employment",
    "education",
    "government_docs",
    "references",
    "documents",
    "nda",
    "contract",
    "resume",
    "submit",
]


class OnboardingSaveRequest(BaseModel):
    step: ONBOARDING_STEPS
    personal: OnboardingPersonalInfo | None = None
    emergency: OnboardingEmergencyContact | None = None
    employment: OnboardingEmploymentInfo | None = None
    education: OnboardingEducationInfo | None = None
    government_docs: OnboardingGovernmentDocs | None = None
    references: OnboardingReferences | None = None
    documents: OnboardingDocumentsAck | None = None
    nda: OnboardingSignature | None = None
    contract: OnboardingSignature | None = None
    resume: OnboardingResume | None = None
