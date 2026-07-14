from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str
    DEBUG: bool

    SECRET_KEY: str
    JWT_ALGORITHM: str
    ACCESS_TOKEN_EXPIRE: int

    MONGODB_URI: str
    DATABASE_NAME: str

    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_BUCKET: str

    GEMINI_API_KEY: str
    REDIS_URL: str
    ALLOWED_ORIGINS: str

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