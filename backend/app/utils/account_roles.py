# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Independent Manager and Portal account-role utilities."""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator

from app.db.enums import ManagerAccountRole, PortalAccountRole


PORTAL_ROLE_RANK: dict[str, int] = {
    PortalAccountRole.PORTAL_USER.value: 1,
    PortalAccountRole.PORTAL_MANAGER.value: 2,
}
MANAGER_ROLE_VALUES = frozenset({ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value})
PORTAL_ROLE_VALUES = frozenset(PORTAL_ROLE_RANK)


def require_manager_account_role(value: str) -> str:
    if value not in MANAGER_ROLE_VALUES:
        raise ValueError("Invalid Manager account role")
    return value


def require_portal_account_role(value: str) -> str:
    if value not in PORTAL_ROLE_VALUES:
        raise ValueError("Invalid Portal account role")
    return value


ManagerAccountRoleValue = Annotated[
    str,
    AfterValidator(require_manager_account_role),
]
PortalAccountRoleValue = Annotated[
    str,
    AfterValidator(require_portal_account_role),
]


def portal_account_role_rank(role: str | None) -> int:
    if role is None:
        return 0
    try:
        return PORTAL_ROLE_RANK[role]
    except KeyError as exc:
        raise ValueError("Invalid Portal account role") from exc


def max_portal_account_role(*roles: str | None) -> str | None:
    present = [role for role in roles if role is not None]
    if not present:
        return None
    return max(present, key=portal_account_role_rank)
