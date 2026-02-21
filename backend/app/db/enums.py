# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from enum import Enum


class UserRole(str, Enum):
    UI_SUPERADMIN = "ui_superadmin"
    UI_ADMIN = "ui_admin"
    UI_USER = "ui_user"
    UI_NONE = "ui_none"


ADMIN_UI_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
}


def is_admin_ui_role(role: str | None) -> bool:
    return bool(role in ADMIN_UI_ROLES)


def is_superadmin_ui_role(role: str | None) -> bool:
    return role == UserRole.UI_SUPERADMIN.value


class AccountRole(str, Enum):
    PORTAL_MANAGER = "portal_manager"
    PORTAL_USER = "portal_user"
    PORTAL_NONE = "portal_none"


class StorageProvider(str, Enum):
    CEPH = "ceph"
    OTHER = "other"


class HealthCheckStatus(str, Enum):
    UNKNOWN = "unknown"
    UP = "up"
    DEGRADED = "degraded"
    DOWN = "down"
