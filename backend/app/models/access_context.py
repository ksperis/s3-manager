# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from app.db import S3Account, User, UserS3Account
from app.models.account_capabilities import AccountCapabilities
from app.models.session import ManagerSessionPrincipal
from app.utils.account_roles import portal_role_for


ManagerActor = Union[User, ManagerSessionPrincipal]


@dataclass(frozen=True)
class EffectiveAccountGroupRole:
    group_id: int
    group_name: str
    role: str
    determines_effective_role: bool = False
    allow_manager_browser_data_access: bool = False


@dataclass(frozen=True)
class EffectiveAccountLink:
    account_id: int
    role: str
    is_root: bool = False
    direct_role: Optional[str] = None
    direct_determines_effective_role: bool = False
    direct_allow_manager_browser_data_access: bool = False
    group_sources: tuple[EffectiveAccountGroupRole, ...] = ()

    @property
    def portal_role(self) -> Optional[str]:
        return portal_role_for(self.role)

    @property
    def manager_browser_allowed(self) -> bool:
        admin_role = "account_administrator"
        return bool(
            self.direct_role == admin_role
            and self.direct_allow_manager_browser_data_access
        ) or any(
            source.role == admin_role
            and source.allow_manager_browser_data_access
            for source in self.group_sources
        )


@dataclass
class AccountAccess:
    account: S3Account
    actor: ManagerActor
    membership: Optional[UserS3Account | EffectiveAccountLink]
    capabilities: AccountCapabilities
    role: Optional[str] = None


@dataclass
class BucketMigrationAccessScope:
    user: User
    allowed_context_ids: set[str]
    admin_account_context_ids: set[str] = field(default_factory=set)
