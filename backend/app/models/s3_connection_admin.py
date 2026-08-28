# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list
from app.models.s3_connection import (
    CredentialOwnerType,
    S3ConnectionCredentialsUpdate,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAssociationDetail, UserAvatar


class S3ConnectionGroupDetail(ApiModel):
    id: int
    name: str
    avatar: Optional[UiGroupAvatar] = None


class S3ConnectionAdminItem(ApiModel):
    id: int
    name: str
    storage_endpoint_id: Optional[int] = None
    endpoint_url: str
    is_active: bool = True
    execution_status: Literal["ready", "remediation_required"] = "ready"
    remediation_reason: Optional[str] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    provider_hint: Optional[str] = None
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int
    created_by_email: Optional[str] = None
    created_by_full_name: Optional[str] = None
    created_by_avatar: Optional[UserAvatar] = None
    user_count: int = 0
    user_details: list[UserAssociationDetail] = Field(default_factory=list)
    group_details: list[S3ConnectionGroupDetail] = Field(default_factory=list)
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    last_used_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionSummary(ApiModel):
    id: int
    name: str
    created_by_user_id: int
    is_active: bool = True
    execution_status: Literal["ready", "remediation_required"] = "ready"


class S3ConnectionAdminCreate(ApiModel):
    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
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


class S3ConnectionAdminUpdate(ApiModel):
    name: Optional[str] = None
    group_ids: Optional[list[int]] = None
    user_ids: Optional[list[int]] = None
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_active: Optional[bool] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    tags: Optional[list[TagDefinitionInput]] = None
    credentials: Optional[S3ConnectionCredentialsUpdate] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)


class PaginatedS3ConnectionsResponse(ApiModel):
    items: list[S3ConnectionAdminItem]
    total: int
    page: int
    page_size: int
    has_next: bool


class S3ConnectionRemediationAction(ApiModel):
    action: Literal["activate_manager"]
