# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import logging
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import AccountRole, S3Account, User, UserS3Account, is_admin_ui_role
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeysState,
    PortalAccessKeyStatusChange,
    PortalActivityItem,
    PortalAlert,
    PortalEligibility,
    PortalPublicLink,
    PortalPublicLinkCreate,
    PortalState,
    PortalTransfer,
    PortalStorageObjectDeleteResponse,
    PortalStorageObjectDetail,
    PortalStorageSpace,
    PortalStorageSpaceCreate,
    PortalStorageSpaceImport,
    PortalStorageSpaceShare,
    PortalStorageSpaceSharePayload,
    PortalStorageSpaceShareUpdate,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
    PortalUsage,
)
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.manager_stats import ManagerUsageTrendsResponse
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.dependencies import (
    AccountAccess,
    get_audit_logger,
    get_current_account_user,
    get_portal_account_access,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.services.audit_service import AuditService
from app.services.portal_service import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
    PortalService,
    get_portal_service,
)
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.healthcheck_service import HealthCheckService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_feature_flags,
)
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.usage_trends_service import build_account_usage_trends
from app.services.rgw_admin import RGWAdminError
from app.services.users_service import UsersService, get_users_service
from app.utils.s3_account_ordering import s3_account_name_order_by
from app.services.billing_service import BillingService
from app.services.app_settings_service import load_app_settings
from app.services.effective_access_service import EffectiveAccessService
from app.models.billing import BillingSubjectDetail
router = APIRouter(prefix="/portal", tags=["portal"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _build_attachment_content_disposition(filename: str) -> str:
    fallback = "".join(char if 0x20 <= ord(char) <= 0x7E else "_" for char in filename).replace('"', '\\"')
    encoded = quote(filename, safe="")
    return f'attachment; filename="{fallback or "download"}"; filename*=UTF-8\'\'{encoded}'


def _raise_portal_storage_runtime(exc: RuntimeError) -> None:
    detail = str(exc)
    lowered = detail.lower()
    if "not found or not allowed" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if "not found" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if "not allowed" in lowered or "not provisioned" in lowered or "owner role required" in lowered or "cannot be changed" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    raise_bad_gateway_from_runtime(exc)


def _raise_portal_access_key_runtime(exc: RuntimeError) -> None:
    detail = str(exc)
    lowered = detail.lower()
    if isinstance(exc, PortalAccessKeyManagementDisabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    if isinstance(exc, PortalAccessKeyLimitExceeded):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    if isinstance(exc, PortalAccessKeyProtected):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    if "not found" in lowered or "introuvable" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if "not allowed" in lowered or "not provisioned" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    raise_bad_gateway_from_runtime(exc)


@router.get("/accounts", response_model=list[S3AccountSchema])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    quota_service = get_s3_accounts_service(db, allow_missing_admin=True)
    links = [
        link
        for link in EffectiveAccessService(db).resolve_user(user).account_links
        if link.account_role in {AccountRole.PORTAL_USER.value, AccountRole.PORTAL_MANAGER.value}
    ]
    account_ids = {link.account_id for link in links}
    account_role_by_id = {link.account_id: link.account_role for link in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).order_by(*s3_account_name_order_by(S3Account)).all()
        if account_ids
        else []
    )
    results: list[S3AccountSchema] = []
    for acc in accounts:
        endpoint = acc.storage_endpoint
        # Only show accounts eligible for portal workflows.
        if not acc.rgw_account_id:
            continue
        if endpoint is None:
            continue
        if str(endpoint.provider) != "ceph":
            continue
        if not resolve_feature_flags(endpoint).iam_enabled:
            continue
        root_link = None
        if is_admin_ui_role(user.role):
            root_link = (
                db.query(UserS3Account)
                .filter(
                    UserS3Account.account_id == acc.id,
                    UserS3Account.is_root.is_(True),
                )
                .join(User)
                .with_entities(User.email, User.id)
                .first()
            )
        quota_max_size_gb, quota_max_objects = quota_service.get_account_quota(acc)
        results.append(
            S3AccountSchema(
                id=str(acc.id),
                name=acc.name,
                rgw_account_id=acc.rgw_account_id,
                quota_max_size_gb=quota_max_size_gb,
                quota_max_objects=quota_max_objects,
                root_user_email=root_link[0] if root_link else None,
                root_user_id=root_link[1] if root_link else None,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                storage_endpoint_capabilities=(
                    features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
                    if endpoint
                    else None
                ),
                account_role=account_role_by_id.get(acc.id),
            )
        )
    return results


@router.get("/eligibility", response_model=PortalEligibility)
def portal_eligibility(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalEligibility:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    return PortalEligibility(eligible=eligible, reasons=reasons)


@router.get("/state", response_model=PortalState)
def portal_state(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    if not eligible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="; ".join(reasons) or "Portal not available")
    try:
        return service.get_state(actor, access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/usage", response_model=PortalUsage)
def portal_usage(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUsage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    endpoint = getattr(access.account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    try:
        return service.get_usage(actor, access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/usage-trends", response_model=ManagerUsageTrendsResponse, response_model_exclude_none=True)
def portal_usage_trends(
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> ManagerUsageTrendsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    endpoint = getattr(access.account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    if not load_app_settings().general.usage_history_enabled:
        return ManagerUsageTrendsResponse()
    return build_account_usage_trends(db, access.account, reference_date=utcnow().date())


@router.get("/activity", response_model=list[PortalActivityItem])
def portal_activity(
    space_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalActivityItem]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_portal_activity(actor, access, space_id=space_id, limit=limit)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/transfers", response_model=list[PortalTransfer])
def portal_transfers(
    space_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalTransfer]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_portal_transfers(actor, access, space_id=space_id, limit=limit)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


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
    service = HealthCheckService(db)
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
    overview = HealthCheckService(db).build_workspace_health_overview(endpoint_id=int(endpoint_id))
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
        _raise_portal_storage_runtime(exc)


@router.get("/access-keys", response_model=PortalAccessKeysState)
def portal_access_keys(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKeysState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_access_keys_state(actor, access)
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.post("/access-keys", response_model=PortalAccessKey, status_code=status.HTTP_201_CREATED)
def create_portal_access_key(
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.create_access_key(actor, access)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_portal_access_key",
            entity_type="portal_access_key",
            entity_id=key.access_key_id,
            account=access.account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.put("/access-keys/{access_key_id}/status", response_model=PortalAccessKey)
def update_portal_access_key_status(
    access_key_id: str,
    payload: PortalAccessKeyStatusChange,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.update_access_key_status(actor, access, access_key_id, payload.active)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_portal_access_key_status",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata={"access_key_id": access_key_id, "active": payload.active},
        )
        return key
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.delete("/access-keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_portal_access_key(
    access_key_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        service.delete_access_key(actor, access, access_key_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_portal_access_key",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata={"access_key_id": access_key_id},
        )
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/billing/me", response_model=BillingSubjectDetail)
def portal_billing_me(
    month: str = Query(..., description="YYYY-MM"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    app_settings = load_app_settings()
    if not app_settings.general.billing_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled")
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    if account.storage_endpoint_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not configured")
    service = BillingService(db)
    try:
        return service.subject_detail(month, account.storage_endpoint_id, "account", account.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/storage-spaces", response_model=list[PortalStorageSpaceSummary])
def portal_storage_spaces(
    search: Optional[str] = Query(None, description="Filter storage spaces by name"),
    role: Optional[str] = Query(None, description="Filter by simple Portal role"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by simple Storage Space status"),
    sort: str = Query("name", description="Sort by name, created_at, used_bytes, object_count, role, or status"),
    include_archived: bool = Query(False, description="Include archived Storage Spaces"),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceSummary]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_spaces(
            actor,
            access,
            search=search,
            role=role,
            status=status_filter,
            sort=sort,
            include_archived=include_archived,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/storage-spaces", response_model=PortalStorageSpace, status_code=status.HTTP_201_CREATED)
def create_portal_storage_space(
    payload: PortalStorageSpaceCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        storage_space = service.create_storage_space(
            actor,
            access,
            name=payload.name,
            naming_mode=payload.naming_mode,
            description=payload.description,
            owner_label=payload.owner_label,
            visibility=payload.visibility,
            project_key=payload.project_key,
            dataset_label=payload.dataset_label,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_storage_space",
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=access.account,
            metadata={
                "storage_space_id": storage_space.id,
                "visibility": storage_space.visibility,
                "owner_user_id": storage_space.owner_user_id,
            },
        )
        return storage_space
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/import", response_model=PortalStorageSpace, status_code=status.HTTP_201_CREATED)
def import_portal_storage_space(
    payload: PortalStorageSpaceImport,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        storage_space = service.import_storage_space(
            actor,
            access,
            bucket_name=payload.bucket_name,
            description=payload.description,
            owner_label=payload.owner_label,
            visibility=payload.visibility,
            project_key=payload.project_key,
            dataset_label=payload.dataset_label,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="import_storage_space",
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=access.account,
            metadata={
                "storage_space_id": storage_space.id,
                "visibility": storage_space.visibility,
                "owner_user_id": storage_space.owner_user_id,
            },
        )
        return storage_space
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.patch("/storage-spaces/{space_id}", response_model=PortalStorageSpace)
def update_portal_storage_space(
    space_id: str,
    payload: PortalStorageSpaceUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        storage_space = service.update_storage_space(
            actor,
            access,
            space_id,
            name=payload.name,
            description=payload.description,
            owner_label=payload.owner_label,
            visibility=payload.visibility,
            project_key=payload.project_key,
            dataset_label=payload.dataset_label,
            archived=payload.archived,
        )
        action = (
            "archive_storage_space"
            if payload.archived is True
            else "restore_storage_space"
            if payload.archived is False
            else "update_storage_space"
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action=action,
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=access.account,
            metadata={
                "storage_space_id": storage_space.id,
                "visibility": storage_space.visibility,
                "owner_user_id": storage_space.owner_user_id,
                "archived": storage_space.archived_at is not None,
            },
        )
        return storage_space
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/objects/detail", response_model=PortalStorageObjectDetail)
def portal_storage_space_object_detail(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectDetail:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_object_detail(actor, access, space_id, key)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/objects", response_model=PortalStorageObjectDeleteResponse)
def portal_delete_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectDeleteResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        deleted_key = service.delete_storage_space_object(actor, access, space_id, key)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_object",
            entity_type="object",
            entity_id=deleted_key,
            account=access.account,
            metadata={"storage_space_id": space_id},
        )
        return PortalStorageObjectDeleteResponse(key=deleted_key, message="Deleted")
    except RuntimeError as exc:
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_object",
            entity_type="object",
            entity_id=key,
            account=access.account,
            metadata={"storage_space_id": space_id},
            status="failed",
            message=str(exc),
        )
        _raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/objects/download")
def portal_download_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        stream, content_type, filename = service.download_storage_space_object(actor, access, space_id, key)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="download_object",
            entity_type="object",
            entity_id=key,
            account=access.account,
            metadata={"storage_space_id": space_id},
        )
        headers = {}
        if filename:
            headers["Content-Disposition"] = _build_attachment_content_disposition(filename)
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="download_object",
            entity_type="object",
            entity_id=key,
            account=access.account,
            metadata={"storage_space_id": space_id},
            status="failed",
            message=str(exc),
        )
        _raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/public-links", response_model=list[PortalPublicLink])
def portal_storage_space_public_links(
    space_id: str,
    object_key: Optional[str] = Query(None),
    include_revoked: bool = Query(False),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalPublicLink]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_public_links(
            actor,
            access,
            space_id,
            object_key=object_key,
            include_revoked=include_revoked,
        )
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/public-links", response_model=PortalPublicLink, status_code=status.HTTP_201_CREATED)
def create_portal_storage_space_public_link(
    space_id: str,
    payload: PortalPublicLinkCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalPublicLink:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        link = service.create_storage_space_public_link(
            actor,
            access,
            space_id,
            object_key=payload.object_key,
            label=payload.label,
            expires_at=payload.expires_at,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_public_link",
            entity_type="object",
            entity_id=payload.object_key,
            account=access.account,
            metadata={
                "storage_space_id": space_id,
                "public_link_id": link.id,
                "expires_at": link.expires_at.isoformat() if link.expires_at else None,
            },
        )
        return link
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/public-links/{link_id}", response_model=list[PortalPublicLink])
def revoke_portal_storage_space_public_link(
    space_id: str,
    link_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalPublicLink]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        links = service.revoke_storage_space_public_link(actor, access, space_id, link_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="revoke_public_link",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"storage_space_id": space_id, "public_link_id": link_id},
        )
        return links
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/public-links/{token}/download")
def download_portal_public_link(
    token: str,
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    try:
        stream, content_type, filename = service.download_public_link(token)
    except RuntimeError as exc:
        detail = str(exc)
        lowered = detail.lower()
        if "not found" in lowered:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        if "expired" in lowered or "revoked" in lowered or "archived" in lowered or "suspended" in lowered:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail=detail) from exc
        raise_bad_gateway_from_runtime(exc)
    headers = {"Content-Disposition": _build_attachment_content_disposition(filename)}
    return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)


@router.get("/storage-spaces/{space_id}/shares", response_model=list[PortalStorageSpaceShare])
def portal_storage_space_shares(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShare]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_shares(actor, access, space_id)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


def _resolve_share_target(payload: PortalStorageSpaceSharePayload, users_service: UsersService) -> User:
    target = None
    if payload.user_id is not None:
        target = users_service.get_by_id(payload.user_id)
    elif payload.email:
        target = users_service.get_by_email_case_insensitive(payload.email)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target


@router.post("/storage-spaces/{space_id}/shares", response_model=PortalStorageSpaceShare, status_code=status.HTTP_201_CREATED)
def grant_portal_storage_space_share(
    space_id: str,
    payload: PortalStorageSpaceSharePayload,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceShare:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = _resolve_share_target(payload, users_service)
    try:
        share = service.set_storage_space_share(actor, access, target, space_id, payload.role)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="grant_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id, "role": payload.role},
        )
        return share
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/shares/{user_id}", response_model=PortalStorageSpaceShare)
def update_portal_storage_space_share(
    space_id: str,
    user_id: int,
    payload: PortalStorageSpaceShareUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceShare:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        share = service.set_storage_space_share(actor, access, target, space_id, payload.role)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id, "role": payload.role},
        )
        return share
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/shares/{user_id}", response_model=list[PortalStorageSpaceShare])
def revoke_portal_storage_space_share(
    space_id: str,
    user_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShare]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        shares = service.revoke_storage_space_share(actor, access, target, space_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="revoke_storage_space_share",
            entity_type="storage_space",
            entity_id=space_id,
            account=access.account,
            metadata={"target_user_id": target.id},
        )
        return shares
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}", response_model=PortalStorageSpace)
def portal_storage_space_detail(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        storage_space = service.get_storage_space(actor, access, space_id)
    except RuntimeError as exc:
        detail = str(exc)
        if "autorisé" in detail.lower() or "not allowed" in detail.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
        raise_bad_gateway_from_runtime(exc)
    if storage_space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage space not found")
    return storage_space


@router.get("/traffic")
def portal_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> dict:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).usage_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
    bucket_filters: Optional[set[str]] = None
    if not access.capabilities.can_manage_buckets:
        requested_bucket = (bucket or "").strip()
        allowed_buckets = set(portal_service.list_existing_user_bucket_access(actor, account, access.role))
        if requested_bucket and requested_bucket not in allowed_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket access not allowed for this role.")
        if requested_bucket:
            bucket = requested_bucket
        else:
            bucket = None
            bucket_filters = allowed_buckets
    try:
        traffic_service = TrafficService(account)
    except ValueError as exc:
        raise_bad_gateway_from_runtime(exc)
    try:
        return traffic_service.get_traffic(window=window, bucket=bucket, bucket_filters=bucket_filters)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RGWAdminError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch traffic logs: {exc}") from exc
