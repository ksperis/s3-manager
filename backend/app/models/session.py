# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel
from app.db import UserRole
from app.utils.s3_endpoint import normalize_s3_endpoint


class S3KeyLogin(ApiModel):
    access_key: str = Field(min_length=1)
    secret_key: str = Field(min_length=1)
    endpoint_url: Optional[str] = None

    @field_validator("endpoint_url", mode="before")
    @classmethod
    def normalize_endpoint(cls, value: Optional[str]) -> Optional[str]:
        return normalize_s3_endpoint(value)


class SessionCapabilities(ApiModel):
    can_manage_iam: bool = False
    can_manage_buckets: bool = True
    can_view_traffic: bool = False
    access_browser: bool = True
    endpoint_url: Optional[str] = None

    @field_validator("endpoint_url", mode="before")
    @classmethod
    def normalize_capability_endpoint(cls, value: Optional[str]) -> Optional[str]:
        return normalize_s3_endpoint(value)


class SessionDescriptor(ApiModel):
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
