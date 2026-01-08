# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PortalExternalAccessKey(BaseModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    is_active: bool = False


class PortalExternalAccessCredentials(BaseModel):
    iam_username: str
    access_key_id: str
    secret_access_key: str
    created_at: Optional[str] = None


class PortalAccessGrant(BaseModel):
    id: int
    user_id: int
    package_key: str
    bucket: str
    prefix: Optional[str] = None
    materialization_status: str
    materialization_error: Optional[str] = None


class PortalExternalAccessStatus(BaseModel):
    allow_external_access: bool = False
    external_enabled: bool = False
    iam_username: Optional[str] = None
    active_access_key_id: Optional[str] = None
    keys: list[PortalExternalAccessKey] = Field(default_factory=list)
    grants: list[PortalAccessGrant] = Field(default_factory=list)
    allowed_packages: list[str] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class PortalGrantAssignRequest(BaseModel):
    user_id: int
    package_key: str
    bucket: str
    prefix: Optional[str] = None

