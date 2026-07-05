# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from app.db import AccountRole, S3Account, User, UserS3Account
from app.models.app_settings import PortalSettingsOverride
from app.models.session import ManagerSessionPrincipal
from app.services.effective_access_service import EffectiveAccountLink

ManagerActor = Union[User, ManagerSessionPrincipal]


@dataclass
class AccountCapabilities:
    can_manage_buckets: bool = False
    can_manage_portal_users: bool = False
    can_manage_iam: bool = False
    can_view_root_key: bool = False
    using_root_key: bool = False


@dataclass
class AccountAccess:
    account: S3Account
    actor: ManagerActor
    membership: Optional[UserS3Account | EffectiveAccountLink]
    capabilities: AccountCapabilities
    role: str = AccountRole.PORTAL_NONE.value
    portal_settings_override: Optional[PortalSettingsOverride] = None


@dataclass
class BucketMigrationAccessScope:
    user: User
    allowed_context_ids: set[str]
    admin_account_context_ids: set[str] = field(default_factory=set)
