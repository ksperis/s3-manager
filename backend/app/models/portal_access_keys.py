# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal access-key API contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


class PortalAccessKey(ApiModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    is_active: bool = False
    is_portal: bool = False
    deletable: bool = True
    secret_access_key: Optional[str] = None
    expires_at: Optional[datetime] = None
    session_token: Optional[str] = None
    target_type: Literal["self", "external"] = "self"
    external_email: Optional[str] = None
    storage_space_name: Optional[str] = None
    bucket_name: Optional[str] = None
    permission: Optional[Literal["read_only", "read_write"]] = None


class PortalAccessKeyCreate(ApiModel):
    target_type: Literal["self", "external"] = "self"
    storage_space_id: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    external_email: Optional[str] = Field(default=None, max_length=254)
    permission: Optional[Literal["read_only", "read_write"]] = None

    @field_validator("storage_space_id")
    @classmethod
    def _validate_storage_space_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Storage Space is required")
        return cleaned

    @field_validator("external_email")
    @classmethod
    def _validate_external_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("External user label is required")
        return cleaned


class PortalAccessKeyStatusChange(ApiModel):
    active: bool


class PortalIAMUser(ApiModel):
    iam_user_id: Optional[str] = None
    iam_username: Optional[str] = None
    arn: Optional[str] = None
    created_at: Optional[datetime] = None


class PortalAccessKeysState(ApiModel):
    iam_user: PortalIAMUser
    s3_endpoint: Optional[str] = None
    force_path_style: bool = False
    access_keys: list[PortalAccessKey]
    can_manage_access_keys: bool = False
    max_access_keys: int = Field(default=2, ge=1)
