from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.auth import PASSWORD_PATTERN, PHONE_PATTERN

# Pakistani IBAN: PK + 2 check digits + 4-letter bank code + 16 digits = 24 chars
IBAN_PATTERN = __import__("re").compile(r"^PK\d{2}[A-Z]{4}\d{16}$", __import__("re").IGNORECASE)


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


def _optional_phone(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not PHONE_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid phone number.")
    return normalized


class OnboardingPersonalInfo(BaseModel):
    """US-025 personal + US-026 contact fields in one intake step."""

    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    date_of_birth: date
    gender: Literal["male", "female", "other", "prefer_not_to_say"]
    nationality: str = Field(min_length=2, max_length=80)
    marital_status: Literal["single", "married", "divorced", "widowed", "other"]
    blood_group: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] = "unknown"
    national_id: str = Field(min_length=5, max_length=40)
    profile_picture: str | None = None
    # Optional fields populated from CNIC/Passport OCR (editable by candidate)
    father_name: str | None = Field(default=None, max_length=120)
    id_issue_date: str | None = Field(default=None, max_length=40)
    id_expiry_date: str | None = Field(default=None, max_length=40)
    # Contact (US-026)
    alternate_phone: str | None = None
    current_address: str = Field(min_length=3, max_length=300)
    permanent_address: str = Field(min_length=3, max_length=300)
    same_as_current: bool = False
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(min_length=3, max_length=20)
    country: str = Field(min_length=2, max_length=100)
    # Backward-compatible aliases still accepted by older clients
    address_line1: str | None = Field(default=None, max_length=200)
    address_line2: str | None = Field(default=None, max_length=200)

    @field_validator("first_name", "last_name", "nationality", "city", "state", "country")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("alternate_phone")
    @classmethod
    def validate_alternate_phone(cls, value: str | None) -> str | None:
        return _optional_phone(value)

    @model_validator(mode="after")
    def apply_address_defaults(self):
        if self.same_as_current:
            self.permanent_address = self.current_address
        # Keep legacy fields populated for older readers
        if not self.address_line1:
            self.address_line1 = self.current_address
        return self


class OnboardingEmergencyContact(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    relationship: str = Field(min_length=2, max_length=60)
    phone: str
    alternate_phone: str | None = None
    address: str | None = Field(default=None, max_length=300)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid phone number.")
        return normalized

    @field_validator("alternate_phone")
    @classmethod
    def validate_alternate_phone(cls, value: str | None) -> str | None:
        return _optional_phone(value)


class OnboardingEmploymentInfo(BaseModel):
    """US-031 banking (post-hire). Plaintext in request; service encrypts at rest."""

    bank_name: str = Field(min_length=2, max_length=100)
    account_holder_name: str = Field(min_length=2, max_length=100)
    account_number: str = Field(min_length=4, max_length=40)
    tax_id: str = Field(min_length=4, max_length=40)
    iban: str = Field(min_length=15, max_length=34)
    branch: str = Field(min_length=2, max_length=120)
    branch_code: str = Field(min_length=1, max_length=40)
    swift_code: str | None = Field(default=None, max_length=20)

    @field_validator("iban")
    @classmethod
    def validate_iban(cls, value: str) -> str:
        normalized = value.replace(" ", "").upper()
        if not IBAN_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid Pakistani IBAN (e.g. PK36SCBL0000001123456702).")
        return normalized

    @field_validator("swift_code")
    @classmethod
    def normalize_swift(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().upper()
        return cleaned or None


class EducationEntry(BaseModel):
    institution: str = Field(min_length=2, max_length=200)
    board_university: str | None = Field(default=None, max_length=200)
    degree: str = Field(min_length=2, max_length=120)
    field_of_study: str = Field(min_length=2, max_length=120)
    year_completed: str = Field(min_length=4, max_length=4)
    cgpa_or_percentage: str | None = Field(default=None, max_length=20)
    certificate_file: str | None = None


class OnboardingEducationInfo(BaseModel):
    entries: list[EducationEntry] = Field(min_length=1)


class CertificationEntry(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    document_url: str | None = None
    expiry_date: date | None = None


class OnboardingSkillsInfo(BaseModel):
    technical_skills: list[str] = Field(default_factory=list)
    soft_skills: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    certifications: list[CertificationEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_some_skills(self):
        has_skills = bool(self.technical_skills or self.soft_skills or self.languages or self.certifications)
        if not has_skills:
            raise ValueError("Add at least one technical skill, soft skill, language, or certification.")
        # Normalize skill tags
        self.technical_skills = [s.strip() for s in self.technical_skills if s and s.strip()]
        self.soft_skills = [s.strip() for s in self.soft_skills if s and s.strip()]
        self.languages = [s.strip() for s in self.languages if s and s.strip()]
        return self


class GovernmentDocument(BaseModel):
    # Identity for profile autofill: National ID or Passport only (no other_id / license).
    doc_type: Literal["cnic", "passport"]
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
    "education",
    "skills",
    "government_docs",
    "resume",
    "submit",
]


class OnboardingSaveRequest(BaseModel):
    step: ONBOARDING_STEPS
    personal: OnboardingPersonalInfo | None = None
    emergency: OnboardingEmergencyContact | None = None
    employment: OnboardingEmploymentInfo | None = None
    education: OnboardingEducationInfo | None = None
    skills: OnboardingSkillsInfo | None = None
    government_docs: OnboardingGovernmentDocs | None = None
    references: OnboardingReferences | None = None
    documents: OnboardingDocumentsAck | None = None
    nda: OnboardingSignature | None = None
    contract: OnboardingSignature | None = None
    resume: OnboardingResume | None = None
