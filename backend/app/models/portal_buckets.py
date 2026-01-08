# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator


_BUCKET_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
_BUCKET_IP_RE = re.compile(r"^(?:\\d{1,3}\\.){3}\\d{1,3}$")


class PortalBucketCreateRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=63)
    versioning: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        return value.strip()

    @field_validator("name")
    @classmethod
    def validate_bucket_name(cls, value: str) -> str:
        if not value:
            raise ValueError("Bucket name is required")
        if value.lower() != value:
            raise ValueError("Bucket name must be lowercase")
        if not _BUCKET_NAME_RE.match(value):
            raise ValueError("Bucket name must be 3-63 chars and contain only lowercase letters, digits, dots, and hyphens")
        if _BUCKET_IP_RE.match(value):
            raise ValueError("Bucket name must not be formatted as an IP address")
        if ".." in value or ".-" in value or "-." in value:
            raise ValueError("Bucket name has invalid dot/hyphen sequence")
        return value


class PortalBucketCreateResponse(BaseModel):
    name: str
    versioning: bool = False
    tags: dict[str, str] = Field(default_factory=dict)

