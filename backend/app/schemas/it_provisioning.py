"""IT provisioning schemas — public form + recruiter send/remind."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


ASSET_TYPES = ("laptop", "monitor", "phone", "headset", "badge", "license", "other")


class SendItProvisioningRequest(BaseModel):
    offer_id: str = Field(min_length=1)
    it_manager_email: EmailStr | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("offer_id")
    @classmethod
    def strip_offer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for note."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class RemindItProvisioningRequest(BaseModel):
    offer_id: str = Field(min_length=1)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("offer_id")
    @classmethod
    def strip_offer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for note."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class BulkSendItProvisioningRequest(BaseModel):
    """Send IT provisioning for multiple signed offers in one action."""

    offer_ids: list[str] = Field(min_length=1, max_length=100)
    it_manager_email: EmailStr | None = None
    note: str | None = Field(default=None, max_length=1000)
    batch_email: bool = False
    batch_form: bool = False

    @field_validator("offer_ids")
    @classmethod
    def strip_offer_ids(cls, value: list[str]) -> list[str]:
        cleaned = []
        seen: set[str] = set()
        for item in value:
            oid = (item or "").strip()
            if not oid or oid in seen:
                continue
            seen.add(oid)
            cleaned.append(oid)
        if not cleaned:
            raise ValueError("At least one offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class BulkRemindItProvisioningRequest(BaseModel):
    offer_ids: list[str] = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("offer_ids")
    @classmethod
    def strip_offer_ids(cls, value: list[str]) -> list[str]:
        cleaned = []
        seen: set[str] = set()
        for item in value:
            oid = (item or "").strip()
            if not oid or oid in seen:
                continue
            seen.add(oid)
            cleaned.append(oid)
        if not cleaned:
            raise ValueError("At least one offer_id is required.")
        return cleaned

    @field_validator("note")
    @classmethod
    def sanitize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)


class ItAssetItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    asset_type: str = Field(default="other", max_length=64)
    serial_number: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name", "asset_type")
    @classmethod
    def strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field is required.")
        return cleaned

    @field_validator("asset_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        lowered = value.strip().lower()
        if lowered not in ASSET_TYPES:
            return "other"
        return lowered

    @field_validator("name", "asset_type", "serial_number", "notes")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for text fields."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("serial_number", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ItLicenseItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    vendor: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("License name is required.")
        return cleaned

    @field_validator("vendor", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ItProvisioningSubmitRequest(BaseModel):
    company_email: EmailStr
    # No separate mailbox password anymore — the employee's single account
    # password covers both the personal and company email login. Kept optional
    # for backward compatibility with older clients; its value is ignored.
    company_email_password: str | None = Field(default=None, min_length=4, max_length=128)
    # First-time password: IT sets (or generates) a temporary password used for
    # the very first sign-in. The employee is then forced to set their own
    # password, which covers both the personal and company email login.
    temporary_password: str | None = Field(default=None, min_length=8, max_length=128)
    # Asset assignment is optional — an employee may be provisioned without
    # any hardware or software licenses. Empty/omitted lists are accepted.
    assets: list[ItAssetItem] = Field(default_factory=list, max_length=40)
    licenses: list[ItLicenseItem] = Field(default_factory=list, max_length=40)
    it_notes: str | None = Field(default=None, max_length=2000)
    submitted_by_name: str | None = Field(default=None, max_length=120)

    @field_validator("company_email_password")
    @classmethod
    def strip_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 4:
            raise ValueError("Company email password must be at least 4 characters.")
        if any(c.isspace() for c in cleaned):
            raise ValueError("Company email password must not contain spaces.")
        return cleaned

    @field_validator("temporary_password")
    @classmethod
    def validate_temporary_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 8:
            raise ValueError("First-time password must be at least 8 characters.")
        if any(c.isspace() for c in cleaned):
            raise ValueError("First-time password must not contain spaces.")
        if not (
            any(c.isupper() for c in cleaned)
            and any(c.islower() for c in cleaned)
            and any(c.isdigit() for c in cleaned)
            and any(c in "!@#$%&*" for c in cleaned)
        ):
            raise ValueError(
                "First-time password needs an uppercase letter, a lowercase letter, a number, and a special character."
            )
        return cleaned

    @field_validator("it_notes", "submitted_by_name")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class RevealCompanyEmailPasswordRequest(BaseModel):
    otp: str = Field(min_length=4, max_length=12)

    @field_validator("otp")
    @classmethod
    def strip_otp(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("OTP is required.")
        return cleaned


class ItKitCreateRequest(BaseModel):
    """Reusable standard setup: assets + licenses + applicable roles."""

    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    assets: list[ItAssetItem] = Field(default_factory=list, max_length=40)
    licenses: list[ItLicenseItem] = Field(default_factory=list, max_length=40)
    roles: list[str] = Field(default_factory=list, max_length=20)
    is_default: bool = False

    @field_validator("name", "description")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("roles")
    @classmethod
    def clean_roles(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            role = (item or "").strip()
            if not role or role.lower() in seen:
                continue
            seen.add(role.lower())
            cleaned.append(role)
        return cleaned

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Kit name is required.")
        return cleaned

    @model_validator(mode="after")
    def require_asset_or_license(self) -> ItKitCreateRequest:
        if not self.assets and not self.licenses:
            raise ValueError("A kit needs at least one asset or software license.")
        return self


class ItKitUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    assets: list[ItAssetItem] | None = None
    licenses: list[ItLicenseItem] | None = None
    roles: list[str] | None = None
    is_default: bool | None = None

    @field_validator("name", "description")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("roles")
    @classmethod
    def clean_roles(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            role = (item or "").strip()
            if not role or role.lower() in seen:
                continue
            seen.add(role.lower())
            cleaned.append(role)
        return cleaned


class ItBatchSubmitEntry(BaseModel):
    """One person's provisioning in a batch submit."""

    offer_id: str
    company_email: EmailStr
    # No separate mailbox password — kept optional for backward compatibility;
    # its value is ignored (one password covers both login emails).
    company_email_password: str | None = Field(default=None, min_length=4, max_length=128)
    # Optional per-person first-time password. When omitted the system
    # generates one and it is emailed to the employee at activation.
    temporary_password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("offer_id")
    @classmethod
    def strip_offer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Offer id is required.")
        return cleaned

    @field_validator("company_email_password")
    @classmethod
    def strip_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 4:
            raise ValueError("Company email password must be at least 4 characters.")
        if any(c.isspace() for c in cleaned):
            raise ValueError("Company email password must not contain spaces.")
        return cleaned

    @field_validator("temporary_password")
    @classmethod
    def validate_temporary_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if len(cleaned) < 8:
            raise ValueError("First-time password must be at least 8 characters.")
        if any(c.isspace() for c in cleaned):
            raise ValueError("First-time password must not contain spaces.")
        if not (
            any(c.isupper() for c in cleaned)
            and any(c.islower() for c in cleaned)
            and any(c.isdigit() for c in cleaned)
            and any(c in "!@#$%&*" for c in cleaned)
        ):
            raise ValueError(
                "First-time password needs an uppercase letter, a lowercase letter, a number, and a special character."
            )
        return cleaned


class ItProvisioningBatchSubmitRequest(BaseModel):
    """IT provisions a whole batch at once. assets/licenses apply to every person."""

    entries: list[ItBatchSubmitEntry] = Field(min_length=1, max_length=100)
    # Asset assignment is optional — a batch may be provisioned without any
    # hardware or software licenses. Empty/omitted lists are accepted.
    assets: list[ItAssetItem] = Field(default_factory=list, max_length=40)
    licenses: list[ItLicenseItem] = Field(default_factory=list, max_length=40)
    it_notes: str | None = Field(default=None, max_length=2000)
    submitted_by_name: str | None = Field(default=None, max_length=120)

    @field_validator("it_notes", "submitted_by_name")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
