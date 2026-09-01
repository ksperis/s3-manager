# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared API contract for independent Manager and Portal account grants."""

from __future__ import annotations

from typing import Optional

from pydantic import model_validator

from app.models.base import ApiModel
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue


class AccountAccessGrant(ApiModel):
    manager_role: Optional[ManagerAccountRoleValue]
    portal_role: Optional[PortalAccountRoleValue]
    allow_manager_browser_data_access: bool = False

    @model_validator(mode="after")
    def _validate_account_roles(self) -> "AccountAccessGrant":
        if self.manager_role is None and self.portal_role is None:
            raise ValueError("At least one account role is required")
        if self.allow_manager_browser_data_access and self.manager_role is None:
            raise ValueError("Manager Browser data access requires a Manager role")
        return self
