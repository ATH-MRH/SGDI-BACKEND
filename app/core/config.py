from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SGDI FastAPI Backend"
    app_env: str = "production"
    app_debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api"
    allow_public_registration: bool = False
    cors_allowed_origins: str | None = None
    # Noms d'hôte qui servent le Portail RH mobile (séparés par des virgules).
    # Permet d'ajouter un domaine de test (ex. portail-rh-test.irongs.com) sans toucher au code.
    portal_hostnames: str = "portail-rh.irongs.com"
    startup_maintenance_enabled: bool = False
    public_employee_pages_require_token: bool = True
    max_photo_upload_bytes: int = 5_000_000
    admin_system_password: str | None = None
    admin_system_username: str | None = None
    admin_initial_username: str | None = None
    admin_initial_password: str | None = None

    database_url: str

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 720

    anthropic_api_key: str | None = None
    assistant_paid_ai_enabled: bool = False
    # Agent IA ATLAS. Nécessite ANTHROPIC_API_KEY.
    assistant_agent_enabled: bool = False
    assistant_agent_model: str = "claude-opus-4-8"
    # Repli automatique sur un modèle local (Ollama) si Claude échoue / pour éviter les coûts.
    assistant_fallback_enabled: bool = True
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gpt-oss:120b"

    contract_email_alerts_enabled: bool = True
    contract_email_alert_window_days: int = 30
    contract_email_alert_days: str | None = None
    contract_email_alert_recipients: str | None = None
    contract_email_alert_interval_hours: int = 24

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "SGDI"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def require_postgresql_in_production(self) -> "Settings":
        if self.app_env.strip().lower() in {"production", "prod"}:
            database_url = self.database_url.strip().lower()
            if not database_url.startswith(("postgresql://", "postgresql+psycopg2://", "postgres://")):
                raise ValueError("DATABASE_URL doit cibler PostgreSQL en production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
