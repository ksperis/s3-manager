# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.db import AccountIAMUser
from app.models.portal import PortalAccessKey


def portal_access_key_is_active(status: Optional[str], *, default: bool = True) -> bool:
    if status is None:
        return default
    return str(status).lower() == "active"


def portal_access_key_from_iam_metadata(
    metadata: Any,
    *,
    is_portal: bool,
    deletable: bool,
    secret_access_key: Optional[str] = None,
    is_active: Optional[bool] = None,
    active_default: bool = True,
    status: Optional[str] = None,
) -> PortalAccessKey:
    status_value = status if status is not None else getattr(metadata, "status", None)
    return PortalAccessKey(
        access_key_id=getattr(metadata, "access_key_id", None),
        status=status_value,
        created_at=getattr(metadata, "created_at", None),
        is_active=portal_access_key_is_active(status_value, default=active_default) if is_active is None else is_active,
        secret_access_key=secret_access_key,
        is_portal=is_portal,
        deletable=deletable,
    )


def portal_access_key_from_active_link(
    link: AccountIAMUser,
    *,
    include_secret: bool,
) -> PortalAccessKey:
    return PortalAccessKey(
        access_key_id=link.active_access_key,
        status="Active",
        is_active=True,
        secret_access_key=link.active_secret_key if include_secret else None,
        is_portal=True,
        deletable=False,
    )
