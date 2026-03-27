# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections and user access links."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list


class S3ConnectionAdminItem(BaseModel):
    id: int
    name: str
    storage_endpoint_id: Optional[int] = None
    endpoint_url: str
    is_shared: bool = False
    is_active: bool = True
    access_manager: bool = False
    access_browser: bool = True
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    provider_hint: Optional[str] = None
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int
    created_by_email: Optional[str] = None
    user_count: int = 0
    user_ids: list[int] = Field(default_factory=list)
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    last_used_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionSummary(BaseModel):
    id: int
    name: str
    created_by_user_id: int
    is_shared: bool = False
    is_active: bool = True


class S3ConnectionAdminCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    access_manager: bool = False
    access_browser: bool = True
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: str
    secret_access_key: str
    force_path_style: bool = False
    verify_tls: bool = True
    tags: list[TagDefinitionInput] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[dict[str, str]]:
        return validate_tag_definition_list(value, allow_none=False) or []


class S3ConnectionAdminUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_active: Optional[bool] = None
    access_manager: Optional[bool] = None
    access_browser: Optional[bool] = None
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    tags: Optional[list[TagDefinitionInput]] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)


class PaginatedS3ConnectionsResponse(BaseModel):
    items: list[S3ConnectionAdminItem]
    total: int
    page: int
    page_size: int
    has_next: bool


class S3ConnectionUserLink(BaseModel):
    user_id: int
    email: Optional[str] = None
    full_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionUserLinkUpsert(BaseModel):
    user_id: int
