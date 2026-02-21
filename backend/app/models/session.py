# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.db import UserRole


class S3KeyLogin(BaseModel):
    access_key: str = Field(min_length=1)
    secret_key: str = Field(min_length=1)
    endpoint_url: Optional[str] = None

    @field_validator("endpoint_url", mode="before")
    @classmethod
    def normalize_endpoint(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip().rstrip("/")
        return normalized or None


class SessionCapabilities(BaseModel):
    can_manage_iam: bool = False
    can_manage_buckets: bool = True
    can_view_traffic: bool = False
    endpoint_url: Optional[str] = None

    @field_validator("endpoint_url", mode="before")
    @classmethod
    def normalize_capability_endpoint(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip().rstrip("/")
        return normalized or None


class SessionDescriptor(BaseModel):
    session_id: str
    actor_type: str
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    user_uid: Optional[str] = None
    capabilities: SessionCapabilities


@dataclass
class ManagerSessionPrincipal:
    session_id: str
    access_key: str
    secret_key: str
    actor_type: str
    account_id: Optional[str]
    account_name: Optional[str]
    user_uid: Optional[str]
    capabilities: SessionCapabilities
    role: str = UserRole.UI_USER.value
    email: str = "s3-session@local"
    id: Optional[int] = None

    def audit_fallbacks(self) -> tuple[str, str]:
        fallback_email = self.email or f"rgw:{self.account_id or 'unknown'}"
        fallback_role = self.role or "rgw_session"
        return fallback_email, fallback_role
