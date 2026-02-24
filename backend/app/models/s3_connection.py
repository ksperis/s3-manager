# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.models.pagination import PaginatedResponse


class S3Connection(BaseModel):
    id: int
    name: str
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_public: bool = False
    is_shared: bool = False
    visibility: Literal["private", "shared", "public"] = "private"
    iam_capable: bool = False
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: str
    region: Optional[str] = None
    access_key_id: str
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None


class S3ConnectionCreate(BaseModel):
    name: str
    visibility: Optional[Literal["private", "shared", "public"]] = None
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_public: Optional[bool] = False
    is_shared: Optional[bool] = False
    iam_capable: bool = False
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: str
    secret_access_key: str
    force_path_style: bool = False
    verify_tls: bool = True


class S3ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    visibility: Optional[Literal["private", "shared", "public"]] = None
    provider_hint: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    is_public: Optional[bool] = None
    is_shared: Optional[bool] = None
    iam_capable: Optional[bool] = None
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None


class S3ConnectionCredentialsUpdate(BaseModel):
    """Write-only credential rotation payload.

    The API never returns secrets back to the client.
    """

    access_key_id: str
    secret_access_key: str


class PaginatedS3ConnectionsResponse(PaginatedResponse):
    items: list[S3Connection]
