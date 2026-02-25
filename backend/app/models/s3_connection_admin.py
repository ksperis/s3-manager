# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections and user access links."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class S3ConnectionAdminItem(BaseModel):
    id: int
    name: str
    storage_endpoint_id: Optional[int] = None
    endpoint_url: str
    is_public: bool = False
    is_shared: bool = False
    visibility: Literal["private", "shared", "public"] = "private"
    access_manager: bool = False
    access_browser: bool = True
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    provider_hint: Optional[str] = None
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    capabilities: dict[str, Any] = Field(default_factory=dict)
    owner_user_id: Optional[int] = None
    owner_email: Optional[str] = None
    user_count: int = 0
    user_ids: list[int] = Field(default_factory=list)
    last_used_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionSummary(BaseModel):
    id: int
    name: str
    owner_user_id: Optional[int] = None
    is_public: bool = False
    is_shared: bool = False
    visibility: Literal["private", "shared", "public"] = "private"


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
