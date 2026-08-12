# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import AccountRole, S3Account, User
from app.models.portal import (
    PortalAccount,
    PortalDeletedPrefixRestoreRequest,
    PortalEligibility,
    PortalProjectSettings,
    PortalPublicLink,
    PortalPublicLinkCreate,
    PortalState,
    PortalStorageObjectDeleteResponse,
    PortalStorageObjectDetail,
    PortalStorageObjectRestoreRequest,
    PortalStorageObjectRestoreResponse,
    PortalStorageObjectVersionsResponse,
    PortalStorageSpace,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceCreate,
    PortalStorageSpaceImport,
    PortalStorageSpaceIcon,
    PortalStorageSpaceIconChoice,
    PortalStorageSpaceSettings,
    PortalStorageSpaceSettingsUpdate,
    PortalStorageSpaceVersionCleanupRequest,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
    PortalStorageSpaceSharePayload,
    PortalStorageSpaceShareUpdate,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
    PortalTrashResponse,
)
from app.models.access_context import AccountAccess
from app.models.app_settings import PortalSettingsOverride
from app.routers.dependencies import (
    get_audit_service,
    get_current_account_user,
    get_portal_account_access,
    require_portal_manager,
)
from app.routers import (
    portal_access_keys,
    portal_access_logs,
    portal_collaboration,
    portal_monitoring,
    portal_usage,
)
from app.routers.portal_common import raise_portal_storage_runtime
from app.routers.portal_streams import (
    stream_portal_deleted_prefix_restore,
    stream_portal_storage_space_version_cleanup,
)
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
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_feature_flags,
)
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.services.traffic_service import TrafficService, TrafficWindow, WINDOW_RESOLUTION_LABELS, WINDOW_DELTAS
from app.services.rgw_admin import RGWAdminError
from app.services.users_service import UsersService, get_users_service
from app.services.billing_service import BillingService
from app.services.app_settings_service import load_app_settings
from app.services.effective_access_service import EffectiveAccessService
from app.models.billing import BillingSubjectDetail
from app.utils.http_headers import build_attachment_content_disposition
from app.utils.time import utcnow
router = APIRouter(prefix="/portal", tags=["portal"])
router.include_router(portal_access_keys.router)
router.include_router(portal_access_logs.router)
router.include_router(portal_collaboration.router)
router.include_router(portal_monitoring.router)
router.include_router(portal_usage.router)


@router.get("/accounts", response_model=list[PortalAccount])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[PortalAccount]:
    access_service = EffectiveAccessService(db)
    resolved = access_service.resolve_user(user)
    portal_roles = {
        link.account_id: link.portal_role
        for link in resolved.account_links
        if link.portal_role is not None
    }
    accounts = sorted(
        access_service.list_portal_accounts(user, resolved=resolved),
        key=lambda account: (account.name or "").lower(),
    )
    return [
        PortalAccount(
            id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            account_role=portal_roles[account.id],
            storage_endpoint_name=account.storage_endpoint.name,
            storage_endpoint_url=account.storage_endpoint.endpoint_url,
            storage_endpoint_is_default=bool(account.storage_endpoint.is_default),
            storage_endpoint_capabilities=features_to_capabilities(
                normalize_features_config(
                    account.storage_endpoint.provider,
                    account.storage_endpoint.features_config,
                )
            ),
        )
        for account in accounts
    ]


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
        return service.get_state(access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/settings", response_model=PortalProjectSettings, response_model_exclude_unset=True)
def get_portal_project_settings(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalProjectSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    can_update = bool(
        access.role == AccountRole.PORTAL_MANAGER.value
        and access.account.portal_settings_delegated
    )
    return service.get_portal_project_settings(access.account, can_update=can_update)


@router.put("/settings", response_model=PortalProjectSettings, response_model_exclude_unset=True)
def update_portal_project_settings(
    payload: PortalSettingsOverride,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalProjectSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    if access.role != AccountRole.PORTAL_MANAGER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal manager rights required")
    if not access.account.portal_settings_delegated:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal settings delegation is disabled")
    try:
        updated = service.update_admin_portal_settings_override(access.account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="update_project_portal_settings",
        entity_type="account",
        entity_id=str(access.account.id),
        account=access.account,
        metadata={"project_override": payload.model_dump(exclude_unset=True, exclude_none=False)},
    )
    return service.get_portal_project_settings(
        access.account,
        can_update=updated.delegated_to_portal_managers,
    )


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


@router.post("/storage-spaces/{space_id}/versions/cleanup/stream")
def portal_storage_space_version_cleanup_stream(
    request: Request,
    space_id: str,
    payload: PortalStorageSpaceVersionCleanupRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        target = service.prepare_storage_space_version_cleanup(
            actor,
            access,
            space_id,
            confirmation=payload.confirmation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    return stream_portal_storage_space_version_cleanup(
        request,
        actor=actor,
        access=access,
        service=service,
        audit_service=audit_service,
        target=target,
    )


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
        raise_portal_storage_runtime(exc)


@router.get(
    "/storage-spaces/{space_id}/objects/versions",
    response_model=PortalStorageObjectVersionsResponse,
)
def portal_storage_space_object_versions(
    space_id: str,
    key: str = Query(..., min_length=1),
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectVersionsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_storage_space_object_versions(
            actor,
            access,
            space_id,
            key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/trash", response_model=PortalTrashResponse)
def portal_storage_space_trash(
    space_id: str,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalTrashResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_trash(
            actor,
            access,
            space_id,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post(
    "/storage-spaces/{space_id}/objects/restore",
    response_model=PortalStorageObjectRestoreResponse,
)
def portal_restore_storage_space_object(
    space_id: str,
    payload: PortalStorageObjectRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectRestoreResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.restore_storage_space_object_version(
            actor,
            access,
            space_id,
            payload.key,
            version_id=payload.version_id,
        )
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/trash/restore-prefix/stream")
def portal_restore_deleted_prefix_stream(
    request: Request,
    space_id: str,
    payload: PortalDeletedPrefixRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Portal endpoints require a UI user",
        )
    try:
        target = service.prepare_deleted_prefix_restore(
            actor,
            access,
            space_id,
            prefix=payload.prefix,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    return stream_portal_deleted_prefix_restore(
        request,
        actor=actor,
        access=access,
        service=service,
        audit_service=audit_service,
        target=target,
    )


@router.delete("/storage-spaces/{space_id}/objects", response_model=PortalStorageObjectDeleteResponse)
def portal_delete_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectDeleteResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        deleted_key = service.delete_storage_space_object(actor, access, space_id, key)
        return PortalStorageObjectDeleteResponse(key=deleted_key, message="Deleted")
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/objects/download")
def portal_download_storage_space_object(
    space_id: str,
    key: str = Query(..., min_length=1),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        stream, content_type, filename = service.download_storage_space_object(actor, access, space_id, key)
        headers = {}
        if filename:
            headers["Content-Disposition"] = build_attachment_content_disposition(filename)
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


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
        raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/public-links", response_model=PortalPublicLink, status_code=status.HTTP_201_CREATED)
def create_portal_storage_space_public_link(
    space_id: str,
    payload: PortalPublicLinkCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/public-links/{link_id}", response_model=list[PortalPublicLink])
def revoke_portal_storage_space_public_link(
    space_id: str,
    link_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_portal_storage_runtime(exc)


@router.get("/public-links/{token}/download")
def download_portal_public_link(
    token: str,
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    try:
        stream, content_type, filename = service.download_public_link(token)
    except RuntimeError as exc:
        detail = sanitize_error_detail(str(exc))
        lowered = detail.lower()
        if "not found" in lowered:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        if "expired" in lowered or "revoked" in lowered or "archived" in lowered or "suspended" in lowered:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail=detail) from exc
        raise_bad_gateway_from_runtime(exc)
    headers = {"Content-Disposition": build_attachment_content_disposition(filename)}
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
        raise_portal_storage_runtime(exc)


@router.get("/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_share_candidates(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShareCandidate]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    if not access.capabilities.can_manage_portal_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this account")
    try:
        return service.list_storage_space_share_candidates(actor, access)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/storage-spaces/{space_id}/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_storage_space_share_candidates(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShareCandidate]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_storage_space_share_candidates(actor, access, space_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


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
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/shares/{user_id}", response_model=PortalStorageSpaceShare)
def update_portal_storage_space_share(
    space_id: str,
    user_id: int,
    payload: PortalStorageSpaceShareUpdate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
        raise_portal_storage_runtime(exc)


@router.delete("/storage-spaces/{space_id}/shares/{user_id}", response_model=list[PortalStorageSpaceShare])
def revoke_portal_storage_space_share(
    space_id: str,
    user_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
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
