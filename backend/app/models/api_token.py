# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


API_SCOPE_DOMAINS = {
    "profile",
    "admin",
    "manager",
    "browser",
    "portal",
    "ceph-admin",
    "storage-ops",
}
API_SCOPES = {f"{domain}:{access}" for domain in API_SCOPE_DOMAINS for access in ("read", "write")}


class ApiTokenCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=128)
    expires_in_days: Optional[int] = Field(default=None, ge=1)
    scopes: list[str] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Token name is required")
        return normalized

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, value: list[str]) -> list[str]:
        normalized = sorted({str(scope).strip().lower() for scope in value if str(scope).strip()})
        invalid = sorted(set(normalized) - API_SCOPES)
        if not normalized or invalid:
            raise ValueError(f"Invalid API token scopes: {', '.join(invalid) if invalid else 'none provided'}")
        return normalized


class ApiTokenInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    scopes: list[str] = Field(default_factory=list)


class ApiTokenCreateResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    api_token: ApiTokenInfo
