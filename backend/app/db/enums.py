# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from enum import Enum


class UserRole(str, Enum):
    UI_ADMIN = "ui_admin"
    UI_USER = "ui_user"
    UI_NONE = "ui_none"


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
