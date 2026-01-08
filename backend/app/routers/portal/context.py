# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.models.portal_v2 import PortalContextResponse, PortalEndpointCapabilities
from app.routers.portal.dependencies import PortalContext, get_portal_context


router = APIRouter()


@router.get("/context", response_model=PortalContextResponse)
def get_portal_context_endpoint(
    ctx: PortalContext = Depends(get_portal_context),
) -> PortalContextResponse:
    caps = ctx.endpoint_capabilities
    return PortalContextResponse(
        account_id=ctx.account.id,
        account_name=ctx.account.name,
        portal_role=ctx.role_key,
        permissions=sorted(ctx.permissions),
        endpoint=PortalEndpointCapabilities(
            sts_enabled=caps.sts_enabled,
            presign_enabled=caps.presign_enabled,
            allow_external_access=caps.allow_external_access,
            max_session_duration=caps.max_session_duration,
            allowed_packages=list(caps.allowed_packages),
        ),
        external_enabled=ctx.external_enabled,
    )

