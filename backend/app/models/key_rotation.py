# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class KeyRotationType(str, Enum):
    ENDPOINT_ADMIN = "endpoint_admin"
    ENDPOINT_SUPERVISION = "endpoint_supervision"
    ACCOUNT = "account"
    S3_USER = "s3_user"
    CEPH_ADMIN = "ceph_admin"


class KeyRotationRequest(BaseModel):
    endpoint_ids: list[int] = Field(default_factory=list, min_length=1)
    key_types: list[KeyRotationType] = Field(default_factory=list, min_length=1)
    deactivate_only: bool = False

    @field_validator("endpoint_ids")
    @classmethod
    def normalize_endpoint_ids(cls, value: list[int]) -> list[int]:
        normalized: list[int] = []
        for item in value:
            endpoint_id = int(item)
            if endpoint_id <= 0:
                raise ValueError("endpoint_ids must only contain positive integers")
            if endpoint_id not in normalized:
                normalized.append(endpoint_id)
        return normalized

    @field_validator("key_types")
    @classmethod
    def normalize_key_types(cls, value: list[KeyRotationType]) -> list[KeyRotationType]:
        normalized: list[KeyRotationType] = []
        for item in value:
            if item not in normalized:
                normalized.append(item)
        return normalized


class KeyRotationResultItem(BaseModel):
    endpoint_id: int
    endpoint_name: str
    key_type: KeyRotationType
    target_type: str
    target_id: Optional[str] = None
    target_label: Optional[str] = None
    status: Literal["rotated", "failed", "skipped"]
    message: Optional[str] = None
    old_access_key: Optional[str] = None
    new_access_key: Optional[str] = None


class KeyRotationSummary(BaseModel):
    total: int = 0
    rotated: int = 0
    failed: int = 0
    skipped: int = 0
    deleted_old_keys: int = 0
    disabled_old_keys: int = 0


class KeyRotationResponse(BaseModel):
    mode: Literal["delete_old_keys", "deactivate_old_keys"]
    summary: KeyRotationSummary
    results: list[KeyRotationResultItem] = Field(default_factory=list)
