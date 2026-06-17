from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SGDI FastAPI Backend"
    app_env: str = "production"
    app_debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api"
    allow_public_registration: bool = False
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
