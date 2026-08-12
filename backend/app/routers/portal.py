# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, User
from app.models.portal import (
    PortalStorageSpace,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceCreate,
    PortalStorageSpaceImport,
    PortalStorageSpaceIcon,
    PortalStorageSpaceIconChoice,
    PortalStorageSpaceSettings,
    PortalStorageSpaceSettingsUpdate,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
)
from app.models.access_context import AccountAccess
from app.routers.dependencies import (
    get_audit_service,
    get_portal_account_access,
    require_portal_manager,
)
from app.routers import (
    portal_access_keys,
    portal_access_logs,
    portal_collaboration,
    portal_context,
    portal_monitoring,
    portal_objects,
    portal_sharing,
    portal_usage,
)
from app.routers.portal_common import raise_portal_storage_runtime
from app.utils.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_http_exception_from_exception,
)
from app.core.sensitive_data import sanitize_error_detail
from app.services.audit_service import AuditService
from app.services.avatar_image_service import MAX_AVATAR_BYTES
from app.services.portal.exceptions import PortalStorageSpaceNotEmpty
from app.services.portal_service import (
    PortalService,
    get_portal_service,
)
from app.services.s3_accounts_service import get_s3_accounts_service
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.rgw_admin import RGWAdminError
from app.services.billing_service import BillingService
from app.services.app_settings_service import load_app_settings
from app.models.billing import BillingSubjectDetail
from app.utils.http_headers import build_attachment_content_disposition
from app.utils.time import utcnow
router = APIRouter(prefix="/portal", tags=["portal"])
router.include_router(portal_access_keys.router)
router.include_router(portal_access_logs.router)
router.include_router(portal_collaboration.router)
router.include_router(portal_context.router)
router.include_router(portal_monitoring.router)
router.include_router(portal_objects.router)
router.include_router(portal_sharing.router)
router.include_router(portal_usage.router)


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
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)


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
    audit_service: AuditService = Depends(get_audit_service),
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
            visibility=payload.visibility,
            share_scope=payload.share_scope,
            account_member_role=payload.account_member_role,
            initial_shares=payload.initial_shares,
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
                "share_scope": storage_space.share_scope,
                "account_member_role": storage_space.account_member_role,
                "initial_share_count": len(payload.initial_shares),
                "owner_user_id": storage_space.owner_user_id,
            },
        )
        return storage_space
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/import", response_model=PortalStorageSpace, status_code=status.HTTP_201_CREATED)
def import_portal_storage_space(
    payload: PortalStorageSpaceImport,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
            visibility=payload.visibility,
            share_scope=payload.share_scope,
            account_member_role=payload.account_member_role,
            initial_shares=payload.initial_shares,
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
                "share_scope": storage_space.share_scope,
                "account_member_role": storage_space.account_member_role,
                "initial_share_count": len(payload.initial_shares),
                "owner_user_id": storage_space.owner_user_id,
            },
        )
        return storage_space
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.patch("/storage-spaces/{space_id}", response_model=PortalStorageSpace)
def update_portal_storage_space(
    space_id: str,
    payload: PortalStorageSpaceUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
            visibility=payload.visibility,
            share_scope=payload.share_scope,
            account_member_role=payload.account_member_role,
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
                "share_scope": storage_space.share_scope,
                "account_member_role": storage_space.account_member_role,
                "owner_user_id": storage_space.owner_user_id,
                "archived": storage_space.archived_at is not None,
            },
        )
        return storage_space
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/take-ownership", response_model=PortalStorageSpace)
def take_portal_storage_space_ownership(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        previous = service.get_storage_space(actor, access, space_id)
        storage_space = service.take_private_storage_space_ownership(actor, access, space_id)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="take_storage_space_ownership",
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=access.account,
            metadata={
                "storage_space_id": storage_space.id,
                "previous_owner_user_id": previous.owner_user_id if previous else None,
                "owner_user_id": storage_space.owner_user_id,
            },
        )
        return storage_space
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/icon", response_model=PortalStorageSpaceIcon)
def update_portal_storage_space_icon(
    space_id: str,
    payload: PortalStorageSpaceIconChoice,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceIcon:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        icon = service.set_storage_space_icon_choice(
            actor,
            access,
            space_id,
            source=payload.source,
            preset=payload.preset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="update_storage_space_icon",
        entity_type="storage_space",
        entity_id=space_id,
        account=access.account,
        metadata={
            "storage_space_id": space_id,
            "icon_source": icon.source,
            "icon_preset": icon.preset,
        },
    )
    return icon


@router.put("/storage-spaces/{space_id}/icon/image", response_model=PortalStorageSpaceIcon)
async def upload_portal_storage_space_icon(
    space_id: str,
    file: UploadFile = File(...),
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceIcon:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    image_payload = await file.read(MAX_AVATAR_BYTES + 1)
    try:
        icon = service.store_storage_space_icon_image(
            actor,
            access,
            space_id,
            image_payload,
            file.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="upload_storage_space_icon",
        entity_type="storage_space",
        entity_id=space_id,
        account=access.account,
        metadata={
            "storage_space_id": space_id,
            "content_type": file.content_type,
            "size_bytes": len(image_payload),
        },
    )
    return icon


@router.delete("/storage-spaces/{space_id}/icon/image", response_model=PortalStorageSpaceIcon)
def delete_portal_storage_space_icon(
    space_id: str,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceIcon:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        icon = service.remove_storage_space_icon_image(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="delete_storage_space_icon",
        entity_type="storage_space",
        entity_id=space_id,
        account=access.account,
        metadata={"storage_space_id": space_id},
    )
    return icon


@router.get("/storage-spaces/{space_id}/icon/image")
def read_portal_storage_space_icon(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        payload, content_type, version = service.storage_space_icon_image(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    return Response(
        content=payload,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"storage-space-icon-{access.account.id}-{space_id}-{version}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/storage-spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portal_storage_space(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        result = service.delete_storage_space(actor, access, space_id)
    except PortalStorageSpaceNotEmpty as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="delete_storage_space",
        entity_type="storage_space",
        entity_id=result["storage_space_id"],
        account=access.account,
        metadata=result,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/storage-spaces/{space_id}/access-summary", response_model=PortalStorageSpaceAccessSummary)
def portal_storage_space_access_summary(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceAccessSummary:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_access_summary(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/settings", response_model=PortalStorageSpaceSettings)
def get_portal_storage_space_settings(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_settings(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/settings", response_model=PortalStorageSpaceSettings)
def update_portal_storage_space_settings(
    space_id: str,
    payload: PortalStorageSpaceSettingsUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        updated = service.update_storage_space_settings(actor, access, space_id, payload)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="update_storage_space_settings",
        entity_type="storage_space",
        entity_id=space_id,
        account=access.account,
        metadata={
            "storage_space_id": space_id,
            "versioning_enabled": updated.versioning_enabled,
            "versioning_status": updated.versioning_status,
            "lifecycle_enabled": updated.lifecycle_enabled,
            "version_history_retention_days": updated.version_history_retention_days,
        },
    )
    return updated


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
        detail = sanitize_error_detail(str(exc))
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
    requested_bucket = (bucket or "").strip()
    allowed_buckets = set(portal_service.list_existing_user_bucket_access(actor, account, access.role))
    if requested_bucket and requested_bucket not in allowed_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket access not allowed for this role.")
    bucket_filters: Optional[set[str]] = None
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
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
