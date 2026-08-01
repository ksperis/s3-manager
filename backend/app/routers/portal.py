# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import asyncio
import logging
import threading
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import AccountRole, QuotaUsageDaily, S3Account, User, UserS3Account, is_admin_ui_role
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeyCreate,
    PortalAccessKeysState,
    PortalAccessKeyStatusChange,
    PortalActivityItem,
    PortalAlert,
    PortalCollaboratorsResponse,
    PortalDeletedPrefixRestoreProgress,
    PortalDeletedPrefixRestoreRequest,
    PortalDeletedPrefixRestoreResult,
    PortalEligibility,
    PortalPublicLink,
    PortalPublicLinkCreate,
    PortalServerAccessLogEntry,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogPage,
    PortalState,
    PortalTransfer,
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
    PortalStorageSpaceVersionCleanupProgress,
    PortalStorageSpaceVersionCleanupRequest,
    PortalStorageSpaceVersionCleanupResult,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
    PortalStorageSpaceSharePayload,
    PortalStorageSpaceShareUpdate,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
    PortalUsage,
    PortalTrashResponse,
)
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.routers.ceph_admin.listing_common import parse_filter_query as parse_advanced_filter_query
from app.models.manager_stats import ManagerUsageTrendsResponse
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.bucket_purge_stream import SSE_KEEPALIVE_INTERVAL_SECONDS, format_sse_event
from app.routers.dependencies import (
    AccountAccess,
    get_audit_logger,
    get_current_account_user,
    get_portal_account_access,
    require_portal_manager,
)
from app.routers.sse_worker import wait_for_cancellable_worker
from app.routers.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_http_exception_from_exception,
    sanitize_error_detail,
    sanitized_error_log_detail,
)
from app.services.audit_service import AuditService
from app.services.avatar_image_service import MAX_AVATAR_BYTES
from app.services.portal_service import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
    PortalStorageSpaceNotEmpty,
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
from app.services.usage_trends_service import account_usage_trend_filters, build_account_usage_trends
from app.services.rgw_admin import RGWAdminError
from app.services.users_service import UsersService, get_users_service
from app.services.billing_service import BillingService
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.bucket_usage_stats_service import BucketUsageStatsAggregateTarget, BucketUsageStatsService
from app.services.app_settings_service import load_app_settings
from app.services.effective_access_service import EffectiveAccessService
from app.services.usage_history_service import UsageHistoryService
from app.models.billing import BillingSubjectDetail
from app.utils.http_headers import build_attachment_content_disposition
router = APIRouter(prefix="/portal", tags=["portal"])
logger = logging.getLogger(__name__)


def _parse_server_access_log_filter(raw: Optional[str]) -> Optional[PortalServerAccessLogFilterQuery]:
    return parse_advanced_filter_query(raw, query_cls=PortalServerAccessLogFilterQuery)
settings = get_settings()


def _raise_portal_storage_runtime(exc: RuntimeError) -> None:
    detail = sanitize_error_detail(str(exc))
    safe_detail = sanitize_error_detail(detail)
    lowered = detail.lower()
    if "not found or not allowed" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if "not found" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if (
        "not allowed" in lowered
        or "not provisioned" in lowered
        or "full management access required" in lowered
        or "full content access required" in lowered
        or "only project managers" in lowered
        or "ownership applies only" in lowered
        or "already own" in lowered
        or "cannot be changed" in lowered
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=safe_detail) from exc
    raise_bad_gateway_from_runtime(exc)


def _raise_portal_access_key_runtime(exc: RuntimeError) -> None:
    detail = sanitize_error_detail(str(exc))
    safe_detail = sanitize_error_detail(detail)
    lowered = detail.lower()
    if isinstance(exc, PortalAccessKeyManagementDisabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=safe_detail) from exc
    if isinstance(exc, PortalAccessKeyLimitExceeded):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=safe_detail) from exc
    if isinstance(exc, PortalAccessKeyProtected):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_detail) from exc
    if "is required" in lowered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_detail) from exc
    if "not found" in lowered or "introuvable" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if "not allowed" in lowered or "not provisioned" in lowered or "owner content role required" in lowered or "archived" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=safe_detail) from exc
    raise_bad_gateway_from_runtime(exc)


def _portal_usage_stats_source_scope_id(account: S3Account) -> str:
    connection_id = getattr(account, "s3_connection_id", None)
    if isinstance(connection_id, int) and connection_id > 0:
        return f"conn-{connection_id}"

    s3_user_id = getattr(account, "s3_user_id", None)
    if isinstance(s3_user_id, int) and s3_user_id > 0:
        return f"s3u-{s3_user_id}"

    ceph_admin_endpoint_id = getattr(account, "ceph_admin_endpoint_id", None)
    if isinstance(ceph_admin_endpoint_id, int) and ceph_admin_endpoint_id > 0:
        return f"ceph-admin-{ceph_admin_endpoint_id}"

    account_id = getattr(account, "id", None)
    if isinstance(account_id, int) and account_id > 0:
        return str(account_id)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported portal account context")


def _ensure_portal_bucket_usage_stats_enabled() -> None:
    if not bool(load_app_settings().general.bucket_usage_stats_enabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket usage stats feature is disabled")


def _stream_portal_storage_space_version_cleanup(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        cancel_event = threading.Event()

        def push_message(payload: str | None) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        def progress_callback(progress: PortalStorageSpaceVersionCleanupProgress) -> None:
            payload = progress.model_copy(update={"request_id": request_id}).model_dump(mode="json")
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketPurgeCancelled()

        audit_metadata = {
            "request_id": request_id,
            "storage_space_id": target.storage_space_id,
            "storage_space_name": target.storage_space_name,
            "bucket_name": target.bucket_name,
        }

        def worker() -> None:
            try:
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="start_storage_space_history_cleanup",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                )
                result = service.run_storage_space_version_cleanup(
                    target,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                )
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="finish_storage_space_history_cleanup",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata={
                        **audit_metadata,
                        "deleted_versions": result.deleted_versions,
                        "deleted_delete_markers": result.deleted_delete_markers,
                        "bytes_freed": result.bytes_freed,
                    },
                )
                push_message(format_sse_event("result", result.model_dump(mode="json")))
                push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
            except BucketPurgeCancelled:
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="cancel_storage_space_history_cleanup",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                    status="canceled",
                    message="Storage Space history cleanup canceled",
                )
                push_message(format_sse_event("done", {"request_id": request_id, "status": "canceled"}))
            except Exception as exc:  # pragma: no cover - defensive streaming boundary.
                logger.exception("Portal Storage Space history cleanup failed: %s", exc)
                safe_message = sanitized_error_log_detail(exc)
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="fail_storage_space_history_cleanup",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                    status="failed",
                    message=safe_message,
                )
                push_message(format_sse_event("error", {"request_id": request_id, "detail": safe_message}))
                push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))
            finally:
                push_message(None)

        worker_task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel_event.set()
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        cancel_event.set()
                        break
                    yield ": keepalive\n\n"
                    continue
                if message is None:
                    break
                yield message
        finally:
            await wait_for_cancellable_worker(
                worker_task,
                cancel_event,
                logger=logger,
                operation="portal_storage_space_history_cleanup",
                request_id=request_id,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _stream_portal_deleted_prefix_restore(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        cancel_event = threading.Event()

        def push_message(payload: str | None) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        def progress_callback(progress: PortalDeletedPrefixRestoreProgress) -> None:
            payload = progress.model_copy(
                update={"request_id": request_id}
            ).model_dump(mode="json")
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketPurgeCancelled()

        audit_metadata = {
            "request_id": request_id,
            "storage_space_id": target.storage_space_id,
            "storage_space_name": target.storage_space_name,
            "bucket_name": target.bucket_name,
            "prefix": target.prefix,
        }

        def worker() -> None:
            try:
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="start_restore_deleted_prefix",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                )
                result = service.run_deleted_prefix_restore(
                    target,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                )
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="finish_restore_deleted_prefix",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata={
                        **audit_metadata,
                        "restore_candidates": result.restore_candidates,
                        "restored_objects": result.restored_objects,
                        "failed_objects": result.failed_objects,
                    },
                    status="success" if result.status == "completed" else "partial",
                )
                push_message(format_sse_event("result", result.model_dump(mode="json")))
                push_message(
                    format_sse_event(
                        "done",
                        {"request_id": request_id, "status": result.status},
                    )
                )
            except BucketPurgeCancelled:
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="cancel_restore_deleted_prefix",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                    status="canceled",
                    message="Deleted prefix restoration canceled",
                )
                push_message(
                    format_sse_event(
                        "done",
                        {"request_id": request_id, "status": "canceled"},
                    )
                )
            except Exception as exc:  # pragma: no cover - defensive streaming boundary.
                logger.exception("Portal deleted prefix restoration failed: %s", exc)
                safe_message = sanitized_error_log_detail(exc)
                audit_service.record_action(
                    user=actor,
                    scope="portal",
                    action="fail_restore_deleted_prefix",
                    entity_type="storage_space",
                    entity_id=target.storage_space_id,
                    account=access.account,
                    metadata=audit_metadata,
                    status="failed",
                    message=safe_message,
                )
                push_message(
                    format_sse_event(
                        "error",
                        {"request_id": request_id, "detail": safe_message},
                    )
                )
                push_message(
                    format_sse_event(
                        "done",
                        {"request_id": request_id, "status": "failed"},
                    )
                )
            finally:
                push_message(None)

        worker_task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel_event.set()
                    break
                try:
                    message = await asyncio.wait_for(
                        queue.get(),
                        timeout=SSE_KEEPALIVE_INTERVAL_SECONDS,
                    )
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        cancel_event.set()
                        break
                    yield ": keepalive\n\n"
                    continue
                if message is None:
                    break
                yield message
        finally:
            await wait_for_cancellable_worker(
                worker_task,
                cancel_event,
                logger=logger,
                operation="portal_deleted_prefix_restore",
                request_id=request_id,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/accounts", response_model=list[S3AccountSchema])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    access_service = EffectiveAccessService(db)
    links = [
        link
        for link in access_service.resolve_user(user).account_links
        if link.portal_role is not None
    ]
    account_role_by_id = {link.account_id: link.portal_role for link in links}
    accounts = sorted(
        access_service.list_portal_accounts(user),
        key=lambda account: (account.name or "").lower(),
    )
    results: list[S3AccountSchema] = []
    for acc in accounts:
        endpoint = acc.storage_endpoint
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
        results.append(
            S3AccountSchema(
                id=str(acc.id),
                name=acc.name,
                rgw_account_id=acc.rgw_account_id,
                quota_max_size_gb=None,
                quota_max_objects=None,
                root_user_email=root_link[0] if root_link else None,
                root_user_id=root_link[1] if root_link else None,
                storage_endpoint_id=endpoint.id if endpoint else None,
                storage_endpoint_name=endpoint.name if endpoint else None,
                storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                storage_endpoint_is_default=bool(endpoint.is_default) if endpoint else None,
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


@router.get("/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def portal_usage_stats_latest(
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
    db: Session = Depends(get_db),
) -> BucketUsageStatsAggregateResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    _ensure_portal_bucket_usage_stats_enabled()
    try:
        spaces = portal_service.list_storage_spaces(actor, access)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)
    source_scope_id = _portal_usage_stats_source_scope_id(access.account)
    targets = [
        BucketUsageStatsAggregateTarget(
            scope_kind="manager",
            scope_id=source_scope_id,
            bucket_name=space.internal_bucket_name or space.id,
        )
        for space in spaces
        if space.internal_bucket_name or space.id
    ]
    aggregate = BucketUsageStatsService().get_aggregate_for_targets(
        db,
        scope_kind="portal",
        scope_id=str(access.account.id),
        scope_name=getattr(access.account, "name", None),
        targets=targets,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.get("/usage-history-trends", response_model=UsageHistoryTrendResponse)
def portal_usage_history_trends(
    window: UsageHistoryTrendWindow = Query("month"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    service = UsageHistoryService(db)
    if not load_app_settings().general.usage_history_enabled:
        return service.empty_trends(window=window, unavailable_reason="Usage history is disabled.")
    if account_usage_trend_filters(access.account, QuotaUsageDaily) is None:
        return service.empty_trends(window=window, unavailable_reason="Usage history trends are unavailable for this context.")
    return service.aggregate_trends(
        window=window,
        extra_filter_builder=lambda model: account_usage_trend_filters(access.account, model) or [],
    )


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


@router.get("/collaborators", response_model=PortalCollaboratorsResponse)
def portal_collaborators(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalCollaboratorsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_portal_collaborators(actor, access)
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


@router.get("/transfers/server-access-logs", response_model=list[PortalServerAccessLogEntry])
def portal_server_access_logs(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    mode: str = Query("transfers", pattern=r"^(transfers|operations)$"),
    space_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    advanced_filter: Optional[str] = Query(None),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalServerAccessLogEntry]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        parsed_filter = _parse_server_access_log_filter(advanced_filter)
        return service.list_portal_server_access_logs(
            actor,
            access,
            date=date,
            mode=mode,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
            limit=limit,
            offset=offset,
            advanced_filter=parsed_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/transfers/server-access-logs/page", response_model=PortalServerAccessLogPage)
def portal_server_access_logs_page(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    mode: str = Query("transfers", pattern=r"^(transfers|operations)$"),
    space_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    advanced_filter: Optional[str] = Query(None),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalServerAccessLogPage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        parsed_filter = _parse_server_access_log_filter(advanced_filter)
        return service.list_portal_server_access_log_page(
            actor,
            access,
            date=date,
            mode=mode,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
            limit=limit,
            offset=offset,
            advanced_filter=parsed_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/transfers/server-access-logs/raw")
def portal_server_access_logs_raw(
    date_from: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    space_id: Optional[str] = Query(None),
    timezone_offset_minutes: int = Query(0, ge=-840, le=840),
    access: AccountAccess = Depends(require_portal_manager),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        content = service.get_portal_server_access_logs_raw(
            actor,
            access,
            date_from=date_from,
            date_to=date_to,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)
    filename = (
        f"portal-server-access-logs-{date_from}.log"
        if date_from == date_to
        else f"portal-server-access-logs-{date_from}-{date_to}.log"
    )
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


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
    payload: Optional[PortalAccessKeyCreate] = None,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.create_access_key(actor, access, payload)
        audit_metadata = {"access_key_id": key.access_key_id}
        if key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.storage_space_id,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_portal_access_key",
            entity_type="portal_access_key",
            entity_id=key.access_key_id,
            account=access.account,
            metadata=audit_metadata,
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
        audit_metadata = {"access_key_id": access_key_id, "active": payload.active}
        if key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.storage_space_id,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_portal_access_key_status",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata=audit_metadata,
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
        key = service.delete_access_key(actor, access, access_key_id)
        audit_metadata = {"access_key_id": access_key_id}
        if key is not None and key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.storage_space_id,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_portal_access_key",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata=audit_metadata,
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
        _raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/take-ownership", response_model=PortalStorageSpace)
def take_portal_storage_space_ownership(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)


@router.put("/storage-spaces/{space_id}/icon", response_model=PortalStorageSpaceIcon)
def update_portal_storage_space_icon(
    space_id: str,
    payload: PortalStorageSpaceIconChoice,
    access: AccountAccess = Depends(require_portal_manager),
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)
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
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)
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
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceIcon:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        icon = service.remove_storage_space_icon_image(actor, access, space_id)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)
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
        _raise_portal_storage_runtime(exc)
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
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)
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
        _raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/versions/cleanup/stream")
def portal_storage_space_version_cleanup_stream(
    request: Request,
    space_id: str,
    payload: PortalStorageSpaceVersionCleanupRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)
    return _stream_portal_storage_space_version_cleanup(
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
        _raise_portal_storage_runtime(exc)


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
        _raise_portal_storage_runtime(exc)


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
        _raise_portal_storage_runtime(exc)


@router.post(
    "/storage-spaces/{space_id}/objects/restore",
    response_model=PortalStorageObjectRestoreResponse,
)
def portal_restore_storage_space_object(
    space_id: str,
    payload: PortalStorageObjectRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectRestoreResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    action = "restore_object_version" if payload.version_id else "restore_deleted_object"
    try:
        result = service.restore_storage_space_object_version(
            actor,
            access,
            space_id,
            payload.key,
            version_id=payload.version_id,
        )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action=action,
            entity_type="object",
            entity_id=result.key,
            account=access.account,
            metadata={
                "storage_space_id": space_id,
                "restored_from_version_id": result.restored_from_version_id,
            },
        )
        return result
    except RuntimeError as exc:
        audit_service.record_action(
            user=actor,
            scope="portal",
            action=action,
            entity_type="object",
            entity_id=payload.key,
            account=access.account,
            metadata={
                "storage_space_id": space_id,
                "requested_version_id": payload.version_id,
            },
            status="failed",
            message=sanitized_error_log_detail(exc),
        )
        _raise_portal_storage_runtime(exc)


@router.post("/storage-spaces/{space_id}/trash/restore-prefix/stream")
def portal_restore_deleted_prefix_stream(
    request: Request,
    space_id: str,
    payload: PortalDeletedPrefixRestoreRequest,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
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
        _raise_portal_storage_runtime(exc)
    return _stream_portal_deleted_prefix_restore(
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
            message=sanitized_error_log_detail(exc),
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
            headers["Content-Disposition"] = build_attachment_content_disposition(filename)
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
            message=sanitized_error_log_detail(exc),
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
        _raise_portal_storage_runtime(exc)


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
        _raise_portal_storage_runtime(exc)


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
