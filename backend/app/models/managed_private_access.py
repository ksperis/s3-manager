# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel
from app.models.s3_connection import S3Connection


class ManagedInlinePolicy(ApiModel):
    name: str = Field(min_length=1, max_length=128)
    document: dict[str, Any]

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Inline policy name is required")
        return normalized


class _ManagedPrivateAccessRequest(ApiModel):
    connection_name: str = Field(min_length=1, max_length=255)
    access_browser: bool
    access_manager: bool

    @field_validator("connection_name")
    @classmethod
    def normalize_connection_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Connection name is required")
        return normalized

    @model_validator(mode="after")
    def validate_access_flags(self):
        if not self.access_browser and not self.access_manager:
            raise ValueError("At least one access flag must be enabled")
        return self


class ManagedIAMPrivateAccessRequest(_ManagedPrivateAccessRequest):
    groups: list[str] = Field(default_factory=list)
    managed_policies: list[str] = Field(default_factory=list)
    inline_policies: list[ManagedInlinePolicy] = Field(default_factory=list)

    @field_validator("groups", "managed_policies")
    @classmethod
    def normalize_unique_values(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            candidate = value.strip()
            if not candidate:
                raise ValueError("Empty group or policy identifiers are not allowed")
            if candidate not in normalized:
                normalized.append(candidate)
        return normalized


class ManagedRGWUserPrivateAccessRequest(_ManagedPrivateAccessRequest):
    pass


class ManagedPrivateAccessResult(ApiModel):
    provisioning_id: int
    status: Literal["active", "cleanup_pending"]
    connection: S3Connection
