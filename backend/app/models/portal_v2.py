# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pydantic import BaseModel, Field

from app.db_models import PortalRoleKey


class PortalEndpointCapabilities(BaseModel):
    sts_enabled: bool = False
    presign_enabled: bool = True
    allow_external_access: bool = False
    max_session_duration: int = 3600
    allowed_packages: list[str] = Field(default_factory=list)


class PortalAccountListItem(BaseModel):
    id: int
    name: str
    portal_role: PortalRoleKey
    access_mode: str
    integrated_mode: str
    storage_endpoint_id: int | None = None
    storage_endpoint_name: str | None = None
    storage_endpoint_url: str | None = None
    endpoint: PortalEndpointCapabilities
    external_enabled: bool = False


class PortalContextResponse(BaseModel):
    account_id: int
    account_name: str
    portal_role: PortalRoleKey
    permissions: list[str] = Field(default_factory=list)
    endpoint: PortalEndpointCapabilities
    external_enabled: bool = False


class PortalMember(BaseModel):
    user_id: int
    email: str
    portal_role: PortalRoleKey
    external_enabled: bool = False


class PortalMemberRoleUpdate(BaseModel):
    role_key: PortalRoleKey

