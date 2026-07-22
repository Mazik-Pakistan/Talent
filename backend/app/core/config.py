from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str
    DEBUG: bool

    SECRET_KEY: str
    JWT_SECRET: str
    JWT_ALGORITHM: str
    ACCESS_TOKEN_EXPIRE: int
    JWT_EXPIRE_MINUTES: int

    MONGODB_URI: str
    DATABASE_NAME: str

    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""
    CLOUDINARY_FOLDER: str = "talent"

    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_BUCKET: str

    GEMINI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    # OpenRouter model id, e.g. google/gemini-2.5-flash or openai/gpt-4o-mini
    OPENROUTER_MODEL: str = "google/gemini-2.5-flash"
    OPENROUTER_MAX_TOKENS: int = 4096
    # Direct Gemini fallback model (only used if OpenRouter fails / missing)
    GEMINI_MODEL: str = "gemini-2.0-flash"
    REDIS_URL: str
    ALLOWED_ORIGINS: str

    SMTP_HOST: str
    SMTP_PORT: int
    SMTP_USERNAME: str
    SMTP_PASSWORD: str
    SMTP_FROM_EMAIL: str
    SMTP_FROM_NAME: str
    MAIL_USE_TLS: bool = True
    MAIL_USE_SSL: bool = False

    FRONTEND_URL: str
    BACKEND_URL: str
    OTP_EXPIRE_MINUTES: int = 10
    INVITATION_EXPIRE_HOURS: int = 48

    # ── Phase 2: Document management / OCR / embeddings ──────────────────
    ENABLE_OCR: bool = True
    OCR_LANG: str = "en"
    OCR_USE_GPU: bool = False
    # Embeddings are a Phase 3 concern — generated now (only for resumes) so
    # Phase 3 can consume them without re-processing every document.
    ENABLE_EMBEDDINGS: bool = False
    EMBEDDING_MODEL: str = "BAAI/bge-m3"
    MAX_DOCUMENT_MB: int = 10
    SIGNED_URL_EXPIRE_SECONDS: int = 3600
    OFFER_EXPIRE_DAYS: int = 14

    # US-031: Fernet key (url-safe base64 32-byte). If empty, derived from SECRET_KEY.
    BANKING_ENCRYPTION_KEY: str = ""

    # ── Phase 4: AI Coach / AI Assistant (RAG) ────────────────────────────
    ENABLE_AI_COACH: bool = True
    RAG_TOP_K: int = 6
    RAG_CANDIDATE_LIMIT: int = 400
    RAG_CHUNK_CHARS: int = 1000
    RAG_CHUNK_OVERLAP: int = 150
    RAG_MAX_CONTEXT_CHARS: int = 6000
    AI_COACH_HISTORY_TURNS: int = 6
    AI_COACH_MAX_MESSAGE_CHARS: int = 2000

    @field_validator("GEMINI_API_KEY", "OPENROUTER_API_KEY", mode="before")
    @classmethod
    def strip_api_keys(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def verification_redirect_url(self) -> str:
        if not self.allowed_origins:
            raise ValueError("ALLOWED_ORIGINS must include the frontend origin.")
        return f"{self.allowed_origins[0]}/verify-email"

    @property
    def password_reset_redirect_url(self) -> str:
        """URL where the user lands after clicking the password‑reset link."""
        if not self.allowed_origins:
            raise ValueError("ALLOWED_ORIGINS must include the frontend origin.")
        return f"{self.allowed_origins[0]}/reset-password"

    @property
    def frontend_base_url(self) -> str:
        if not self.allowed_origins:
            raise ValueError("ALLOWED_ORIGINS must include the frontend origin.")
        return self.allowed_origins[0]

    def invitation_link(self, token: str) -> str:
        return f"{self.frontend_base_url}/invite/{token}"


settings = Settings()
