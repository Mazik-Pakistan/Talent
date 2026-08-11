"""Learning Provider schemas for generic provider framework.

Supports unlimited learning providers without requiring code changes.
API providers store their connection config (endpoint, authentication,
custom headers, and response mapping) on the provider record so new
providers can be added from the UI without backend code changes.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


ProviderType = Literal["api", "manual"]
ProviderImportMethod = Literal["excel", "api", "manual"]
ProviderAuthType = Literal["none", "api_key", "bearer", "basic"]

# Placeholder the UI sends instead of a real secret to mean "keep the stored one".
SECRET_MASK = "••••••••"


class ProviderApiAuth(BaseModel):
    """Authentication configuration for an API provider.

    Secrets are encrypted at rest; the public response only exposes
    ``has_*`` flags so the UI can show masked placeholders.
    """

    type: ProviderAuthType = Field(default="none", description="Authentication type")
    header_name: str | None = Field(default=None, max_length=200, description="Header name for API key auth")
    api_key: str | None = Field(default=None, max_length=2000, description="API key (encrypted at rest)")
    bearer_token: str | None = Field(default=None, max_length=5000, description="Bearer token (encrypted at rest)")
    username: str | None = Field(default=None, max_length=200, description="Username for basic auth")
    password: str | None = Field(default=None, max_length=2000, description="Password for basic auth (encrypted at rest)")


class ProviderApiMapping(BaseModel):
    """Response field mapping: course field -> JSON path (e.g. ``data[].id``)."""

    external_id: str | None = Field(default=None, max_length=300)
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=300)
    category: str | None = Field(default=None, max_length=300)
    competency: str | None = Field(default=None, max_length=300)
    designation: str | None = Field(default=None, max_length=300)
    learning_month: str | None = Field(default=None, max_length=300)
    instructor: str | None = Field(default=None, max_length=300)
    duration_minutes: str | None = Field(default=None, max_length=300)
    level: str | None = Field(default=None, max_length=300)
    language: str | None = Field(default=None, max_length=300)
    image: str | None = Field(default=None, max_length=300)
    skills: str | None = Field(default=None, max_length=300)
    tags: str | None = Field(default=None, max_length=300)


class ProviderApiConfig(BaseModel):
    """Generic API provider configuration stored on the provider record."""

    endpoint: str | None = Field(default=None, max_length=2000, description="API endpoint URL")
    auth: ProviderApiAuth = Field(default_factory=ProviderApiAuth)
    headers: dict[str, str] = Field(default_factory=dict, description="Extra custom headers")
    mapping: ProviderApiMapping | None = Field(default=None, description="Response field mapping")


class LearningProviderBase(BaseModel):
    """Base schema for learning provider."""
    
    name: str = Field(min_length=1, max_length=120, description="Provider display name")
    provider_type: ProviderType = Field(default="manual", description="API or manual entry")
    import_method: ProviderImportMethod = Field(default="manual", description="How courses are imported")
    logo_url: str | None = Field(default=None, max_length=500, description="Provider logo URL")
    description: str | None = Field(default=None, max_length=1000, description="Provider description")
    active: bool = Field(default=True, description="Whether provider is active")
    api_config: ProviderApiConfig | None = Field(default=None, description="API connection configuration")

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

    @field_validator("api_config")
    @classmethod
    def validate_api_config(cls, value: ProviderApiConfig | None) -> ProviderApiConfig | None:
        """Validate API endpoint URL format when provided."""
        if value is None or not value.endpoint:
            return value
        from app.schemas.auth import validate_url_format
        value.endpoint = validate_url_format(value.endpoint, "API endpoint")
        return value

    @model_validator(mode="after")
    def require_api_endpoint(self) -> "LearningProviderBase":
        """API providers must have an endpoint configured."""
        if self.provider_type == "api" or self.import_method == "api":
            if self.api_config is None or not (self.api_config.endpoint or "").strip():
                raise ValueError("API endpoint is required for API providers.")
        return self


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
    api_config: ProviderApiConfig | None = None
    clear_api_config: bool | None = Field(default=None, description="Explicitly clear stored API config")

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

    @field_validator("api_config")
    @classmethod
    def validate_optional_api_config(cls, value: ProviderApiConfig | None) -> ProviderApiConfig | None:
        """Validate API endpoint URL format when provided."""
        if value is None or not value.endpoint:
            return value
        from app.schemas.auth import validate_url_format
        value.endpoint = validate_url_format(value.endpoint, "API endpoint")
        return value


class ProviderTestConnection(BaseModel):
    """Test an API provider configuration without saving it."""

    name: str | None = Field(default=None, max_length=120)
    api_config: ProviderApiConfig

    @field_validator("api_config")
    @classmethod
    def validate_test_config(cls, value: ProviderApiConfig) -> ProviderApiConfig:
        if value is None or not (value.endpoint or "").strip():
            raise ValueError("API endpoint is required.")
        from app.schemas.auth import validate_url_format
        value.endpoint = validate_url_format(value.endpoint, "API endpoint")
        return value


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
    api_config: dict[str, Any] | None = None
    api_connector: str | None = Field(
        default=None,
        description="Built-in connector id when sync uses special handling (e.g. coursera)",
    )
    created_at: datetime
    updated_at: datetime
    created_by_name: str | None = None
