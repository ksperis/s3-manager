# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from app.db import ManagerAccountRole, S3Account, User, UserS3Account
from app.models.account_capabilities import AccountCapabilities
from app.models.session import ManagerSessionPrincipal
from app.utils.account_roles import (
    ManagerAccountRoleValue,
    PortalAccountRoleValue,
)


ManagerActor = Union[User, ManagerSessionPrincipal]


@dataclass(frozen=True)
class EffectiveAccountGroupRole:
    group_id: int
    group_name: str
    manager_role: Optional[ManagerAccountRoleValue] = None
    portal_role: Optional[PortalAccountRoleValue] = None
    determines_effective_manager_role: bool = False
    determines_effective_portal_role: bool = False
    allow_manager_browser_data_access: bool = False


@dataclass(frozen=True)
class EffectiveAccountLink:
    account_id: int
    manager_role: Optional[ManagerAccountRoleValue] = None
    portal_role: Optional[PortalAccountRoleValue] = None
    direct_manager_role: Optional[ManagerAccountRoleValue] = None
    direct_portal_role: Optional[PortalAccountRoleValue] = None
    direct_determines_effective_manager_role: bool = False
    direct_determines_effective_portal_role: bool = False
    direct_allow_manager_browser_data_access: bool = False
    group_sources: tuple[EffectiveAccountGroupRole, ...] = ()

    @property
    def manager_browser_allowed(self) -> bool:
        admin_role = ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
        return bool(
            self.direct_manager_role == admin_role
            and self.direct_allow_manager_browser_data_access
        ) or any(
            source.manager_role == admin_role
            and source.allow_manager_browser_data_access
            for source in self.group_sources
        )


@dataclass
class AccountAccess:
    """Resolved Portal access for one account and one UI user."""

    account: S3Account
    actor: User
    membership: Optional[UserS3Account | EffectiveAccountLink]
    capabilities: AccountCapabilities
    portal_role: PortalAccountRoleValue


@dataclass
class BucketMigrationAccessScope:
    user: User
    allowed_context_ids: set[str]
    admin_account_context_ids: set[str] = field(default_factory=set)
