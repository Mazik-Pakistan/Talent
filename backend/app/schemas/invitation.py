from datetime import date
from typing import Literal
import re

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.auth import (
    PASSWORD_PATTERN,
    CNIC_PATTERN,
    normalize_optional_pk_mobile,
    normalize_pk_mobile,
    validate_cnic_format,
    validate_date_not_future,
    validate_url_format,
)
from app.schemas.date_utils import parse_natural_date
from app.schemas.offer import OfferTermsPayload

# Pakistani IBAN: PK + 2 check digits + 4-letter bank code + 16 digits = 24 chars
IBAN_PATTERN = __import__("re").compile(r"^PK\d{2}[A-Z]{4}\d{16}$", __import__("re").IGNORECASE)


class CreateInvitationRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    full_name: str = Field(min_length=2, max_length=100)
    job_title: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    office_location: str | None = Field(default=None, max_length=120)
    # Remote employees enter banking themselves; on-site banking is recruiter-managed.
    is_remote: bool = False
    start_date: date | None = None
    expires_in_days: int = Field(default=365, ge=1, le=365)
    # When present, invitation email includes the offer letter (new primary flow).
    offer: OfferTermsPayload | None = None

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
    def normalize_email(cls, value: str) -> str:
        normalized = " ".join(value.split()).lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("Invalid email address.")
        local, domain = normalized.rsplit("@", 1)
        if len(local) < 1 or len(domain) < 3 or "." not in domain:
            raise ValueError("Invalid email address.")
        return normalized

    @field_validator("start_date", mode="before")
    @classmethod
    def normalize_start_date_input(cls, value):
        parsed = parse_natural_date(value)
        return parsed if parsed is not None else value

    @field_validator("start_date")
    @classmethod
    def validate_start_date(cls, value: date | None) -> date | None:
        """Validate start date is not in the past."""
        if value is None:
            return None
        if value < date.today():
            raise ValueError("Start date cannot be in the past.")
        return value

    @field_validator("full_name", "job_title", "department", "office_location")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for text fields."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @model_validator(mode="after")
    def _sync_offer_role_fields(self) -> "CreateInvitationRequest":
        if self.offer is None:
            return self
        self.offer.job_title = self.job_title
        self.offer.department = self.department
        if self.office_location and not self.offer.office_location:
            self.offer.office_location = self.office_location
        self.offer.is_remote = bool(self.is_remote or self.offer.is_remote)
        if self.start_date and (not self.offer.start_date or self.offer.start_date in ("", "—")):
            self.offer.start_date = self.start_date.isoformat()
        return self


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
        return normalize_pk_mobile(value)

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
    return normalize_optional_pk_mobile(value)


class OnboardingPersonalInfo(BaseModel):
    """US-025 personal + US-026 contact fields in one intake step."""

    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    date_of_birth: date
    gender: Literal["male", "female", "other", "prefer_not_to_say"]
    nationality: str = Field(min_length=2, max_length=80)
    marital_status: Literal["single", "married", "divorced", "widowed", "other"]
    blood_group: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "N/A"]
    national_id: str = Field(min_length=5, max_length=40)
    profile_picture: str | None = None
    # Required fields — collected during pre-hire intake
    father_name: str = Field(min_length=2, max_length=120)
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

    @field_validator("blood_group", mode="before")
    @classmethod
    def normalize_blood_group(cls, value: str | None) -> str:
        """Reject missing/empty — but 'N/A' is a valid explicit choice."""
        raw = (value or "").strip()
        if not raw or raw.lower() == "unknown":
            raise ValueError("Blood group is required. Select your blood group (e.g. A+, O-, or N/A).")
        return raw

    @field_validator("alternate_phone")
    @classmethod
    def validate_alternate_phone(cls, value: str | None) -> str | None:
        return _optional_phone(value)

    @field_validator("national_id")
    @classmethod
    def validate_national_id(cls, value: str) -> str:
        """Validate Pakistani CNIC/NIC format."""
        return validate_cnic_format(value)

    @field_validator("date_of_birth")
    @classmethod
    def validate_date_of_birth(cls, value: date) -> date:
        """Validate date of birth is not in the future."""
        return validate_date_not_future(value, "date of birth")

    @field_validator("profile_picture")
    @classmethod
    def validate_profile_picture(cls, value: str | None) -> str | None:
        """Validate profile picture URL format."""
        return validate_url_format(value, "profile picture URL")

    @field_validator("current_address", "permanent_address")
    @classmethod
    def sanitize_address(cls, value: str) -> str:
        """Basic HTML sanitization for address fields."""
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

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
        return normalize_pk_mobile(value)

    @field_validator("alternate_phone")
    @classmethod
    def validate_alternate_phone(cls, value: str | None) -> str | None:
        return _optional_phone(value)


class OnboardingEmploymentInfo(BaseModel):
    """US-031 banking (post-hire). Plaintext in request; service encrypts at rest."""

    bank_name: str = Field(min_length=2, max_length=100)
    account_holder_name: str = Field(min_length=2, max_length=100)
    account_number: str = Field(min_length=4, max_length=40)
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
    # city is optional — it is not collected by the post-hire profile form or the AI
    # assistant, so requiring it would block employees from saving education entries.
    city: str | None = Field(default=None, max_length=100)
    board_university: str | None = Field(default=None, max_length=200)
    degree: str = Field(min_length=2, max_length=120)
    field_of_study: str = Field(min_length=2, max_length=120)
    year_completed: str = Field(min_length=4, max_length=4)
    cgpa_or_percentage: str | None = Field(default=None, max_length=20)
    certificate_file: str | None = None

    @field_validator("year_completed")
    @classmethod
    def validate_year_completed(cls, value: str) -> str:
        """Validate year completed is not in the future."""
        current_year = date.today().year
        try:
            year = int(value)
            if year > current_year:
                raise ValueError("Year completed cannot be in the future.")
            if year < 1900:
                raise ValueError("Year completed must be after 1900.")
        except ValueError:
            raise ValueError("Year completed must be a valid 4-digit year.")
        return value

    @field_validator("cgpa_or_percentage")
    @classmethod
    def validate_cgpa_or_percentage(cls, value: str | None) -> str | None:
        """Validate CGPA or percentage format."""
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        
        # Check if it's a percentage (e.g., "85%", "85", "85.5%")
        if re.match(r"^\d+(\.\d+)?%?$", cleaned):
            # Extract numeric value
            num_str = cleaned.rstrip("%")
            try:
                num = float(num_str)
                if num < 0 or num > 100:
                    raise ValueError("Percentage must be between 0 and 100.")
            except ValueError:
                raise ValueError("Invalid percentage format.")
        # Could be CGPA (e.g., "3.5/4.0", "3.5")
        elif re.match(r"^\d+(\.\d+)?(/\d+(\.\d+)?)?$", cleaned):
            # Basic CGPA validation
            try:
                if "/" in cleaned:
                    parts = cleaned.split("/")
                    if len(parts) == 2:
                        cgpa = float(parts[0])
                        max_cgpa = float(parts[1])
                        if cgpa < 0 or cgpa > max_cgpa:
                            raise ValueError(f"CGPA must be between 0 and {max_cgpa}.")
                else:
                    cgpa = float(cleaned)
                    if cgpa < 0 or cgpa > 4.0:
                        raise ValueError("CGPA must be between 0 and 4.0.")
            except ValueError:
                raise ValueError("Invalid CGPA format.")
        else:
            raise ValueError("Enter a valid percentage (e.g., 85%) or CGPA (e.g., 3.5/4.0).")
        
        return cleaned

    @field_validator("certificate_file")
    @classmethod
    def validate_certificate_file(cls, value: str | None) -> str | None:
        """Validate certificate file URL format."""
        return validate_url_format(value, "certificate file URL")

    @field_validator("institution", "city", "degree", "field_of_study", "board_university")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for text fields."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class OnboardingEducationInfo(BaseModel):
    entries: list[EducationEntry] = Field(min_length=1)


class CertificationEntry(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    document_url: str | None = None
    expiry_date: date | None = None

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, value: str) -> str:
        """Basic HTML sanitization for certification name."""
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("document_url")
    @classmethod
    def validate_document_url(cls, value: str | None) -> str | None:
        """Validate certification document URL format."""
        return validate_url_format(value, "certification document URL")

    @field_validator("expiry_date")
    @classmethod
    def validate_expiry_date(cls, value: date | None) -> date | None:
        """Validate expiry date is not in the past."""
        if value is None:
            return None
        if value < date.today():
            raise ValueError("Certification expiry date cannot be in the past.")
        return value


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

    @field_validator("document_number")
    @classmethod
    def validate_document_number(cls, value: str, info) -> str:
        """Validate document number based on document type."""
        doc_type = info.data.get("doc_type")
        if doc_type == "cnic":
            return validate_cnic_format(value)
        # For passport, basic validation - at least 5 characters
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Passport number must be at least 5 characters.")
        return cleaned

    @field_validator("file_url")
    @classmethod
    def validate_file_url(cls, value: str | None) -> str | None:
        """Validate file URL format."""
        return validate_url_format(value, "file URL")


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
        return normalize_pk_mobile(value)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).lower()

    @field_validator("full_name", "relationship", "company")
    @classmethod
    def sanitize_text(cls, value: str) -> str:
        """Basic HTML sanitization for text fields."""
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class OnboardingReferences(BaseModel):
    references: list[ReferenceEntry] = Field(min_length=2, max_length=5)

    @model_validator(mode="after")
    def unique_reference_emails(self):
        emails = [ref.email.lower() for ref in self.references]
        if len(emails) != len(set(emails)):
            raise ValueError("Each reference must use a different email address.")
        return self


class OnboardingDocumentsAck(BaseModel):
    
    accepted_privacy_policy: bool
    accepted_employee_handbook: bool

    @model_validator(mode="after")
    def require_acceptances(self):
        if not (
            # self.accepted_code_of_conduct
            self.accepted_privacy_policy
            and self.accepted_employee_handbook
        ):
            raise ValueError("You must acknowledge all required documents.")
        return self


class OnboardingSignature(BaseModel):
    full_legal_name: str = Field(min_length=2, max_length=100)
    agreed: bool
    signed_at: str | None = None
    # signature is a base64 data URL drawn or uploaded by the employee in the UI.
    # It is optional so the AI path (typed name + agreed) continues to work.
    signature: str | None = None

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
