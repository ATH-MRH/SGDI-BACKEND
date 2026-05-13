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
    admin_initial_password: str | None = None

    database_url: str = "postgresql://sgdi:change-me@localhost:5432/sgdi"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 720

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
