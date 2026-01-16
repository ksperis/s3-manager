# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections and user access links."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class S3ConnectionAdminItem(BaseModel):
    id: int
    name: str
    storage_endpoint_id: Optional[int] = None
    endpoint_url: str
    is_public: bool = False
    provider_hint: Optional[str] = None
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    owner_user_id: Optional[int] = None
    owner_email: Optional[str] = None
    user_count: int = 0
    user_ids: list[int] = []
    last_used_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionSummary(BaseModel):
    id: int
    name: str
    owner_user_id: Optional[int] = None
    is_public: bool = False


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
    can_browser: bool = True
    can_manager: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class S3ConnectionUserLinkUpsert(BaseModel):
    user_id: int
    can_browser: bool = True
    can_manager: bool = True
