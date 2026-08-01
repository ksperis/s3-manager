# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Literal

from pydantic import BaseModel, Field
from app.models.tagging import TagDefinitionSummary


class ExecutionContextCapabilities(BaseModel):
    can_manage_iam: bool
    sts_capable: bool
    admin_api_capable: bool


class ExecutionContext(BaseModel):
    kind: Literal["account", "connection", "legacy_user"]
    id: str
    display_name: str
    hidden: bool = False
    role: Optional[str] = None
    account_role: Optional[str] = Field(default=None, deprecated=True)
    manager_account_is_admin: Optional[bool] = None
    rgw_account_id: Optional[str] = None
    max_buckets: Optional[int] = None
    max_users: Optional[int] = None
    max_roles: Optional[int] = None
    max_groups: Optional[int] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    endpoint_id: Optional[int] = None
    endpoint_name: Optional[str] = None
    endpoint_is_default: Optional[bool] = None
    endpoint_provider: Optional[str] = None
    endpoint_url: Optional[str] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    endpoint_tags: list[TagDefinitionSummary] = Field(default_factory=list)
    capabilities: ExecutionContextCapabilities


class WorkspaceAvailability(BaseModel):
    available: bool = False
    context_count: int = 0


class WorkspaceAccess(BaseModel):
    admin: WorkspaceAvailability
    ceph_admin: WorkspaceAvailability
    storage_ops: WorkspaceAvailability
    manager: WorkspaceAvailability
    browser: WorkspaceAvailability
    portal: WorkspaceAvailability
    default_workspace: Optional[Literal["admin", "ceph-admin", "storage-ops", "manager", "portal", "browser"]] = None
