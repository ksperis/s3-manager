# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal workspace context API contracts."""

from typing import Optional

from app.db import PortalAccountRole
from app.models.base import ApiModel


class PortalAccount(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    portal_role: PortalAccountRole
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]


class PortalState(ApiModel):
    portal_role: Optional[PortalAccountRole] = None
    can_manage_buckets: bool = False
    can_create_private_storage_spaces: bool = False
    can_create_team_storage_spaces: bool = False
    can_manage_portal_users: bool = False
    allow_named_bucket_create: bool = False
    server_access_logging_enabled: bool = True
    storage_space_version_cleanup_enabled: bool = True
