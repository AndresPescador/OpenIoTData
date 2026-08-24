from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    app_name: str = "OpenIoTData API"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite+aiosqlite:///./openiotdata.db"
    auto_create_db: bool = True

    redis_url: str = "redis://localhost:6379/0"
    celery_task_always_eager: bool = True

    storage_backend: Literal["local", "s3"] = "local"
    local_storage_path: Path = Path("./data")
    s3_endpoint_url: str | None = None
    s3_public_endpoint_url: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str = "openiotdata"
    s3_region: str = "us-east-1"
    clamav_host: str | None = None
    clamav_port: int = 3310
    clamav_required: bool = False
    clamav_timeout_seconds: int = 300

    oidc_issuer_url: str | None = None
    oidc_audience: str = "openiotdata-api"
    oidc_algorithms: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["RS256"])
    dev_auth_bypass: bool = False
    token_hash_pepper: str = "development-only-change-me"

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    max_upload_bytes: int = 1024 * 1024 * 1024
    max_account_bytes: int = 20 * 1024 * 1024 * 1024
    max_batch_records: int = 10_000
    max_batch_bytes: int = 10 * 1024 * 1024
    max_preview_rows: int = 500
    max_query_rows: int = 2_000
    max_query_body_bytes: int = 64 * 1024
    max_inferred_rows: int = 20_000_000
    max_inferred_columns: int = 1_000
    max_tabular_inference_bytes: int = 256 * 1024 * 1024
    max_parquet_logical_bytes: int = 1024 * 1024 * 1024
    duckdb_memory_limit: str = "256MB"
    duckdb_threads: int = 2
    public_query_timeout_seconds: int = 15
    max_concurrent_queries: int = 4
    rate_limit_per_minute: int = 120
    allowed_extensions: set[str] = Field(
        default_factory=lambda: {"csv", "tsv", "json", "ndjson", "jsonl", "parquet", "geojson"}
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("oidc_algorithms", mode="before")
    @classmethod
    def parse_algorithms(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("duckdb_memory_limit")
    @classmethod
    def validate_duckdb_memory_limit(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized[:-2].isdigit() or normalized[-2:] not in {"MB", "GB"}:
            raise ValueError("DUCKDB_MEMORY_LIMIT must look like 256MB or 1GB")
        return normalized

    @model_validator(mode="after")
    def validate_security(self) -> Settings:
        if self.dev_auth_bypass and self.app_env not in {"development", "test"}:
            raise ValueError("DEV_AUTH_BYPASS is forbidden outside development/test")
        if not self.dev_auth_bypass and not self.oidc_issuer_url and self.app_env == "production":
            raise ValueError("OIDC_ISSUER_URL is required in production")
        if self.app_env == "production" and self.token_hash_pepper == "development-only-change-me":
            raise ValueError("TOKEN_HASH_PEPPER must be changed in production")
        if self.app_env == "production" and self.auto_create_db:
            raise ValueError("AUTO_CREATE_DB must be false in production; use Alembic migrations")
        if self.max_upload_bytes <= 0 or self.max_batch_bytes <= 0:
            raise ValueError("Upload limits must be positive")
        return self

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url

    @property
    def sync_database_url(self) -> str:
        return self.async_database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace(
            "sqlite+aiosqlite:///", "sqlite:///", 1
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
