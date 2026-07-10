# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.routers.ceph_admin.dependencies import CephAdminContext


def record_ceph_admin_action(
    ctx: CephAdminContext,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, Any] | None = None,
    status: str = "success",
    message: str | None = None,
) -> None:
    actor = getattr(ctx, "actor", None)
    audit_service = getattr(ctx, "audit_service", None)
    if actor is None or audit_service is None:
        return
    endpoint_metadata = {
        "endpoint_id": getattr(ctx.endpoint, "id", None),
        "endpoint_name": getattr(ctx.endpoint, "name", None),
    }
    if metadata:
        endpoint_metadata.update(metadata)
    audit_service.record_action(
        user=actor,
        scope="ceph-admin",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata=endpoint_metadata,
        status=status,
        message=message,
    )
