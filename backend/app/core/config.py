# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings


class OIDCProviderSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    display_name: str
    discovery_url: str
    client_id: str
    client_secret: Optional[str] = None
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: ["openid", "email", "profile"])
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True

    @field_validator("scopes", mode="before")
    @classmethod
    def parse_scopes(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse scopes JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=ENV_FILE_PATH,
        env_nested_delimiter="__",
        extra="ignore",
    )

    app_name: str = Field("s3-manager", description="Application name")
    api_v1_prefix: str = "/api"
    secret_key: str = Field("change-me", description="JWT secret key")
    access_token_expire_minutes: int = 60

    database_url: str = Field(
        "sqlite:///./app.db",
        description="Database connection string (default sqlite)",
    )

    s3_endpoint: str = Field("http://localhost:9000", description="RGW/S3 endpoint")
    s3_endpoint_features: Optional[str] = Field(
        None,
        description="Default endpoint features (YAML or JSON)",
    )
    s3_access_key: str = Field("minio", description="Access key for RGW/S3")
    s3_secret_key: str = Field("minio123", description="Secret key for RGW/S3")
    s3_region: str = Field("us-east-1", description="Default S3 region")

    rgw_admin_access_key: Optional[str] = Field(None, description="Admin ops access key (defaults to s3_access_key)")
    rgw_admin_secret_key: Optional[str] = Field(None, description="Admin ops secret key (defaults to s3_secret_key)")
    supervision_access_key: Optional[str] = Field(None, description="Access key dedicated to supervision usage stats")
    supervision_secret_key: Optional[str] = Field(None, description="Secret key dedicated to supervision usage stats")

    # Default super-admin seed
    super_admin_email: str = Field("admin@example.com", description="Default super-admin login")
    super_admin_password: str = Field("changeme", description="Default super-admin password")
    super_admin_full_name: Optional[str] = Field("Admin", description="Default super-admin name")

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    oidc_providers: dict[str, OIDCProviderSettings] = Field(default_factory=dict)
    oidc_state_ttl_seconds: int = Field(600, description="Validity of OIDC login state (seconds)")

@lru_cache
def get_settings() -> Settings:
    return Settings()
