# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

from app.db import S3Account, User, UserS3Account
from app.models.account_capabilities import AccountCapabilities
from app.models.session import ManagerSessionPrincipal
from app.services.effective_access_service import EffectiveAccountLink

ManagerActor = Union[User, ManagerSessionPrincipal]


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
