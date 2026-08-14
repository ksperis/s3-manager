# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal endpoint health and alert routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import User
from app.models.access_context import AccountAccess
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.portal import PortalAlert
from app.routers.dependencies import get_portal_account_access
from app.routers.portal_common import raise_portal_storage_runtime
from app.services.app_settings_service import load_app_settings
from app.services.healthcheck_query_service import HealthCheckQueryService
from app.services.portal_service import PortalService, get_portal_service
from app.utils.time import utcnow

router = APIRouter()
settings = get_settings()


@router.get("/endpoint-health", response_model=WorkspaceEndpointHealthOverviewResponse)
def portal_endpoint_health(
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> WorkspaceEndpointHealthOverviewResponse:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint Status feature is disabled.")
    account = access.account
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return WorkspaceEndpointHealthOverviewResponse(
            generated_at=utcnow().isoformat(),
            incident_highlight_minutes=max(1, int(settings.healthcheck_incident_recent_minutes or 720)),
            endpoint_count=0,
            up_count=0,
            degraded_count=0,
            down_count=0,
            unknown_count=0,
            endpoints=[],
            incidents=[],
        )
    service = HealthCheckQueryService(db)
    return WorkspaceEndpointHealthOverviewResponse(
        **service.build_workspace_health_overview(endpoint_id=int(endpoint_id))
    )


def _portal_endpoint_alerts(access: AccountAccess, db: Session) -> list[PortalAlert]:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        return []
    endpoint_id = getattr(access.account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return []
    overview = HealthCheckQueryService(db).build_workspace_health_overview(endpoint_id=int(endpoint_id))
    down_count = int(overview.get("down_count") or 0)
    degraded_count = int(overview.get("degraded_count") or 0)
    if down_count <= 0 and degraded_count <= 0:
        return []
    return [
        PortalAlert(
            id="endpoint-degraded",
            tone="danger" if down_count > 0 else "warning",
            title="Storage service availability issue",
            description="One storage service is currently unavailable." if down_count > 0 else "One storage service is degraded.",
            severity_label="Critical" if down_count > 0 else "Warning",
        )
    ]


@router.get("/alerts", response_model=list[PortalAlert])
def portal_alerts(
    limit: int = Query(50, ge=1, le=100),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalAlert]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        alerts = service.list_portal_alerts(actor, access, limit=limit)
        health_alerts = _portal_endpoint_alerts(access, db)
        return service.dedupe_portal_alerts([*health_alerts, *alerts])[:limit]
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
