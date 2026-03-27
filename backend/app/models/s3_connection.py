# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list


class S3Connection(BaseModel):
    id: int
    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    created_by_user_id: int
    is_shared: bool = False
    is_active: bool = True
    access_manager: bool = False
    access_browser: bool = True
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: str
    region: Optional[str] = None
    access_key_id: str
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None


class S3ConnectionCreate(BaseModel):
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


class S3ConnectionUpdate(BaseModel):
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
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    tags: Optional[list[TagDefinitionInput]] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)


class S3ConnectionCredentialsUpdate(BaseModel):
    """Write-only credential rotation payload.

    The API never returns secrets back to the client.
    """

    access_key_id: str
    secret_access_key: str


class S3ConnectionCredentialsValidationRequest(BaseModel):
    storage_endpoint_id: Optional[int] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: str
    secret_access_key: str
    force_path_style: bool = False
    verify_tls: bool = True


class S3ConnectionCredentialsValidationResult(BaseModel):
    ok: bool
    severity: Literal["success", "warning", "error"]
    code: Optional[str] = None
    message: str


class PaginatedS3ConnectionsResponse(PaginatedResponse):
    items: list[S3Connection]
