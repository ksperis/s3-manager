# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ApiTokenCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    expires_in_days: Optional[int] = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Token name is required")
        return normalized


class ApiTokenInfo(BaseModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: datetime
    revoked_at: Optional[datetime] = None


class ApiTokenCreateResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    api_token: ApiTokenInfo
