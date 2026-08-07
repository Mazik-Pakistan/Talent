"""Learning Provider schemas for generic provider framework.

Supports unlimited learning providers without requiring code changes.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ProviderType = Literal["api", "manual"]
ProviderImportMethod = Literal["excel", "api", "manual"]


class LearningProviderBase(BaseModel):
    """Base schema for learning provider."""
    
    name: str = Field(min_length=1, max_length=120, description="Provider display name")
    provider_type: ProviderType = Field(default="manual", description="API or manual entry")
    import_method: ProviderImportMethod = Field(default="manual", description="How courses are imported")
    logo_url: str | None = Field(default=None, max_length=500, description="Provider logo URL")
    description: str | None = Field(default=None, max_length=1000, description="Provider description")
    active: bool = Field(default=True, description="Whether provider is active")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        """Normalize provider name."""
        return " ".join(value.split())

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        """Clean description text."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("logo_url")
    @classmethod
    def validate_logo_url(cls, value: str | None) -> str | None:
        """Validate logo URL format."""
        if value is None:
            return None
        from app.schemas.auth import validate_url_format
        return validate_url_format(value, "logo URL")


class LearningProviderCreate(LearningProviderBase):
    """Create a new learning provider."""
    pass


class LearningProviderUpdate(BaseModel):
    """Update an existing learning provider."""
    
    name: str | None = Field(default=None, max_length=120)
    provider_type: ProviderType | None = None
    import_method: ProviderImportMethod | None = None
    logo_url: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=1000)
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_optional_name(cls, value: str | None) -> str | None:
        """Normalize provider name."""
        if value is None:
            return None
        return " ".join(value.split())

    @field_validator("description")
    @classmethod
    def clean_optional_description(cls, value: str | None) -> str | None:
        """Clean description text."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("logo_url")
    @classmethod
    def validate_optional_logo_url(cls, value: str | None) -> str | None:
        """Validate logo URL format."""
        if value is None:
            return None
        from app.schemas.auth import validate_url_format
        return validate_url_format(value, "logo URL")


class LearningProviderResponse(BaseModel):
    """Learning provider response."""
    
    id: str
    name: str
    slug: str
    provider_type: ProviderType
    import_method: ProviderImportMethod
    logo_url: str | None
    description: str | None
    active: bool
    course_count: int = 0
    created_at: datetime
    updated_at: datetime
    created_by_name: str | None = None
