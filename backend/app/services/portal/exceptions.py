# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


class PortalAccessKeyLimitExceeded(RuntimeError):
    """Raised when a portal user reaches the configured IAM user key limit."""


class PortalAccessKeyManagementDisabled(RuntimeError):
    """Raised when portal access-key mutations are disabled by settings."""


class PortalAccessKeyProtected(RuntimeError):
    """Raised when a request targets the active portal credential."""


class PortalStorageSpaceNotEmpty(RuntimeError):
    """Raised when a Storage Space still contains current or historical data."""
