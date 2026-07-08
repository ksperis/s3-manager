# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.db import AccountIAMUser, PortalExternalAccessCredential
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


def portal_access_key_from_external_credential(
    credential: PortalExternalAccessCredential,
    *,
    storage_space_name: Optional[str] = None,
    secret_access_key: Optional[str] = None,
) -> PortalAccessKey:
    return PortalAccessKey(
        access_key_id=credential.access_key_id,
        status=credential.status,
        created_at=credential.created_at.isoformat() if credential.created_at else None,
        is_active=credential.revoked_at is None and portal_access_key_is_active(credential.status, default=True),
        is_portal=False,
        deletable=credential.revoked_at is None,
        secret_access_key=secret_access_key,
        target_type="external",
        external_email=credential.external_email,
        storage_space_id=credential.bucket_name,
        storage_space_name=storage_space_name,
        permission=credential.permission,
    )
