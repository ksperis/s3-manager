# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Literal

from pydantic import Field

from app.models.base import ApiModel
from app.models.tagging import TagDefinitionSummary
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue


class ExecutionContextCapabilities(ApiModel):
    can_manage_iam: bool
    sts_capable: bool
    admin_api_capable: bool


class ExecutionContext(ApiModel):
    kind: Literal["account", "connection", "s3_user", "portal_account"]
    id: str
    display_name: str
    manager_role: Optional[ManagerAccountRoleValue] = None
    portal_role: Optional[PortalAccountRoleValue] = None
    rgw_account_id: Optional[str] = None
    endpoint_id: Optional[int] = None
    endpoint_name: str
    endpoint_is_default: bool
    endpoint_provider: Optional[str] = None
    endpoint_url: str
    storage_endpoint_capabilities: dict[str, bool]
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    endpoint_tags: list[TagDefinitionSummary] = Field(default_factory=list)
    capabilities: ExecutionContextCapabilities


class ManagerContext(ApiModel):
    access_mode: str
    context_kind: str = "account"
    iam_identity: Optional[str] = None
    manager_stats_enabled: bool = False
    manager_stats_message: Optional[str] = None
    manager_browser_enabled: bool
    manager_browser_message: Optional[str] = None
    manager_bucket_quota_enabled: bool = False
    manager_ceph_keys_enabled: bool = False
    manager_private_access_enabled: bool = False
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    max_buckets: Optional[int] = None
    max_users: Optional[int] = None
    max_roles: Optional[int] = None
    max_groups: Optional[int] = None


class WorkspaceAvailability(ApiModel):
    available: bool = False
    context_count: int = 0


class WorkspaceAccess(ApiModel):
    admin: WorkspaceAvailability
    ceph_admin: WorkspaceAvailability
    storage_ops: WorkspaceAvailability
    manager: WorkspaceAvailability
    browser: WorkspaceAvailability
    portal: WorkspaceAvailability
    default_workspace: Optional[Literal["admin", "ceph-admin", "storage-ops", "manager", "portal", "browser"]] = None
