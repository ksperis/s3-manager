# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import AccountRole, QuotaUsageDaily, S3Account, User, UserS3Account, is_admin_ui_role
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse
from app.models.portal import (
    PortalAccessKey,
    PortalAccessKeysState,
    PortalAccessKeyStatusChange,
    PortalActivityItem,
    PortalAlert,
    PortalEligibility,
    PortalIAMUser,
    PortalPublicLink,
    PortalPublicLinkCreate,
    PortalReplicationCreate,
    PortalReplicationList,
    PortalReplicationSummary,
    PortalState,
    PortalTransfer,
    PortalStorageObjectDeleteResponse,
    PortalStorageObjectDetail,
    PortalStorageSpace,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceCreate,
    PortalStorageSpaceImport,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
    PortalStorageSpaceSharePayload,
    PortalStorageSpaceShareUpdate,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
    PortalUsage,
    PortalUsageAccount,
    PortalUsageAccountTrend,
    PortalUsageAccountTrends,
    PortalUsageStorageSpace,
)
from app.models.project import PortalProject
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.manager_stats import ManagerUsageTrendsResponse
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow
from app.models.s3_account import S3Account as S3AccountSchema
from app.routers.dependencies import (
    AccountAccess,
    get_audit_logger,
    get_current_account_user,
    get_portal_account_access,
)
from app.routers.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_http_exception_from_exception,
    sanitize_error_detail,
    sanitized_error_log_detail,
)
from app.services.audit_service import AuditService
from app.services.portal_service import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
    PortalService,
    get_portal_service,
)
from app.services.portal.replications import PortalReplicationAccountContext
from app.services.projects_service import PortalProjectAccess, ProjectsService, get_projects_service
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
from app.utils.s3_account_ordering import s3_account_name_order_by
from app.services.billing_service import BillingService
from app.services.bucket_usage_stats_service import BucketUsageStatsAggregateTarget, BucketUsageStatsService
from app.services.app_settings_service import load_app_settings
from app.services.usage_history_service import UsageHistoryService
from app.models.billing import BillingSubjectDetail
from app.utils.http_headers import build_attachment_content_disposition
router = APIRouter(prefix="/portal", tags=["portal"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _project_space_id(account_id: int, bucket_name: str) -> str:
    return f"a{account_id}:{bucket_name}"


def _parse_project_space_id(space_id: str) -> tuple[int, str]:
    value = (space_id or "").strip()
    if not value.startswith("a") or ":" not in value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project Storage Space id is invalid")
    account_part, bucket_name = value.split(":", 1)
    account_digits = account_part[1:]
    if not account_digits.isdigit() or not bucket_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project Storage Space id is invalid")
    return int(account_digits), bucket_name


def _sum_optional(values: list[Optional[int]]) -> Optional[int]:
    known = [value for value in values if value is not None]
    if not known:
        return None
    return sum(known)


def _portal_project_label(access: PortalProjectAccess, account_id: int) -> Optional[str]:
    for link in access.account_links:
        if link.account_id == account_id:
            return link.display_name
    return None


def _with_project_space_identity(
    space: PortalStorageSpaceSummary,
    *,
    account_id: int,
    account_label: Optional[str],
) -> PortalStorageSpaceSummary:
    payload = space.model_dump()
    payload["id"] = _project_space_id(account_id, space.internal_bucket_name or space.id)
    payload["account_id"] = account_id
    payload["project_account_label"] = account_label
    return PortalStorageSpaceSummary.model_validate(payload)


def _with_project_public_link(link: PortalPublicLink, *, account_id: int) -> PortalPublicLink:
    payload = link.model_dump()
    payload["storage_space_id"] = _project_space_id(account_id, link.storage_space_id)
    return PortalPublicLink.model_validate(payload)


def _with_project_share(share: PortalStorageSpaceShare, *, account_id: int) -> PortalStorageSpaceShare:
    payload = share.model_dump()
    payload["storage_space_id"] = _project_space_id(account_id, share.storage_space_id)
    return PortalStorageSpaceShare.model_validate(payload)


def _project_replication_contexts(project_access: PortalProjectAccess, projects_service: ProjectsService) -> list[PortalReplicationAccountContext]:
    return [
        PortalReplicationAccountContext(
            access=projects_service.account_access_for_project(project_access, account_link.account_id),
            label=account_link.display_name,
        )
        for account_link in project_access.account_links
    ]


def _portal_usage_account(account_link, usage: PortalUsage) -> PortalUsageAccount:
    account = account_link.account
    endpoint = account.storage_endpoint if account is not None else None
    return PortalUsageAccount(
        account_id=account_link.account_id,
        account_name=account.name if account is not None else f"Account #{account_link.account_id}",
        display_name=account_link.display_name,
        rgw_account_id=account.rgw_account_id if account is not None else None,
        storage_endpoint_name=endpoint.name if endpoint else None,
        storage_endpoint_zonegroup=endpoint.ceph_zonegroup_name if endpoint else None,
        used_bytes=usage.used_bytes,
        used_objects=usage.used_objects,
        quota_max_size_bytes=usage.quota_max_size_bytes,
        quota_max_objects=usage.quota_max_objects,
        storage_space_count=len(usage.storage_spaces),
    )


def _portal_usage_account_trend(account_link, trend: UsageHistoryTrendResponse) -> PortalUsageAccountTrend:
    account = account_link.account
    endpoint = account.storage_endpoint if account is not None else None
    return PortalUsageAccountTrend(
        account_id=account_link.account_id,
        account_name=account.name if account is not None else f"Account #{account_link.account_id}",
        display_name=account_link.display_name,
        rgw_account_id=account.rgw_account_id if account is not None else None,
        storage_endpoint_name=endpoint.name if endpoint else None,
        storage_endpoint_zonegroup=endpoint.ceph_zonegroup_name if endpoint else None,
        trend=trend,
    )


def _raise_project_access_error(exc: ValueError) -> None:
    detail = sanitize_error_detail(str(exc))
    lowered = detail.lower()
    if "not authorized" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    if "not found" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc


def _raise_portal_storage_runtime(exc: RuntimeError) -> None:
    detail = sanitize_error_detail(str(exc))
    safe_detail = sanitize_error_detail(detail)
    lowered = detail.lower()
    if "not found or not allowed" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if "not found" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if "not allowed" in lowered or "not provisioned" in lowered or "owner role required" in lowered or "cannot be changed" in lowered:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=safe_detail) from exc
    raise_bad_gateway_from_runtime(exc)


def _raise_portal_replication_error(exc: Exception) -> None:
    detail = sanitize_error_detail(str(exc))
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    if isinstance(exc, RuntimeError):
        raise_bad_gateway_from_runtime(exc)
    raise exc


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
    if "not found" in lowered or "introuvable" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=safe_detail) from exc
    if "not allowed" in lowered or "not provisioned" in lowered:
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


@router.get("/accounts", response_model=list[S3AccountSchema])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3AccountSchema]:
    quota_service = get_s3_accounts_service(db, allow_missing_admin=True)
    projects_service = get_projects_service(db, accounts_service=quota_service)
    projects = projects_service.list_portal_projects_for_user(user)
    account_role_by_id: dict[int, str] = {}
    for project in projects:
        for project_account in project.accounts:
            account_role_by_id[project_account.account_id] = project.account_role
    account_ids = set(account_role_by_id)
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


@router.get("/projects", response_model=list[PortalProject])
def list_portal_projects(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[PortalProject]:
    quota_service = get_s3_accounts_service(db, allow_missing_admin=True)
    return get_projects_service(db, accounts_service=quota_service).list_portal_projects_for_user(user)


@router.get("/projects/{project_id}/state", response_model=PortalState)
def portal_project_state(
    project_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalState:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    states: list[PortalState] = []
    for account_link in project_access.account_links:
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            states.append(service.get_state(user, account_access))
        except RuntimeError as exc:
            raise_bad_gateway_from_runtime(exc)
    return PortalState(
        account_id=states[0].account_id if states else 0,
        iam_user=PortalIAMUser(),
        access_keys=[],
        iam_provisioned=any(state.iam_provisioned for state in states),
        max_buckets=_sum_optional([state.max_buckets for state in states]),
        s3_endpoint=None,
        used_bytes=_sum_optional([state.used_bytes for state in states]),
        used_objects=_sum_optional([state.used_objects for state in states]),
        quota_max_size_bytes=_sum_optional([state.quota_max_size_bytes for state in states]),
        quota_max_objects=_sum_optional([state.quota_max_objects for state in states]),
        just_created=False,
        account_role=project_access.role,
        can_manage_buckets=any(state.can_manage_buckets for state in states),
        can_create_storage_spaces=any(state.can_create_storage_spaces for state in states),
        can_manage_portal_users=any(state.can_manage_portal_users for state in states),
        allow_named_bucket_create=any(state.allow_named_bucket_create for state in states),
    )


@router.get("/projects/{project_id}/usage", response_model=PortalUsage)
def portal_project_usage(
    project_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalUsage:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    usages: list[PortalUsage] = []
    storage_spaces: list[PortalUsageStorageSpace] = []
    usage_accounts: list[PortalUsageAccount] = []
    for account_link in project_access.account_links:
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            usage = service.get_usage(user, account_access)
        except RuntimeError as exc:
            raise_bad_gateway_from_runtime(exc)
        usages.append(usage)
        usage_accounts.append(_portal_usage_account(account_link, usage))
        for space in usage.storage_spaces:
            label = account_link.display_name
            storage_spaces.append(
                PortalUsageStorageSpace(
                    id=_project_space_id(account_link.account_id, space.id),
                    name=f"{space.name} ({label})" if label else space.name,
                    account_id=account_link.account_id,
                    project_account_label=label,
                    used_bytes=space.used_bytes,
                    object_count=space.object_count,
                    quota_max_size_bytes=space.quota_max_size_bytes,
                    quota_max_objects=space.quota_max_objects,
                )
            )
    return PortalUsage(
        used_bytes=_sum_optional([usage.used_bytes for usage in usages]),
        used_objects=_sum_optional([usage.used_objects for usage in usages]),
        quota_max_size_bytes=_sum_optional([usage.quota_max_size_bytes for usage in usages]),
        quota_max_objects=_sum_optional([usage.quota_max_objects for usage in usages]),
        storage_spaces=storage_spaces,
        accounts=usage_accounts,
    )


@router.get("/projects/{project_id}/account-usage-trends", response_model=PortalUsageAccountTrends)
def portal_project_account_usage_trends(
    project_id: int,
    window: UsageHistoryTrendWindow = Query("month"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> PortalUsageAccountTrends:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    history_service = UsageHistoryService(db)
    if not load_app_settings().general.usage_history_enabled:
        return PortalUsageAccountTrends(
            window=window,
            available=False,
            unavailable_reason="Usage history is disabled.",
        )
    trends: list[PortalUsageAccountTrend] = []
    for account_link in project_access.account_links:
        account = account_link.account
        filters = account_usage_trend_filters(account, QuotaUsageDaily) if account is not None else None
        if filters is None or account is None:
            trend = history_service.empty_trends(
                window=window,
                unavailable_reason="Usage history trends are unavailable for this account.",
            )
        else:
            trend = history_service.aggregate_trends(
                window=window,
                extra_filter_builder=lambda model, scoped_account=account: account_usage_trend_filters(scoped_account, model) or [],
            )
        trends.append(_portal_usage_account_trend(account_link, trend))
    return PortalUsageAccountTrends(
        window=window,
        available=True,
        accounts=trends,
    )


@router.get("/projects/{project_id}/storage-spaces", response_model=list[PortalStorageSpaceSummary])
def portal_project_storage_spaces(
    project_id: int,
    search: Optional[str] = Query(None, description="Filter storage spaces by name"),
    role: Optional[str] = Query(None, description="Filter by simple Portal role"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by simple Storage Space status"),
    sort: str = Query("name", description="Sort by name, created_at, used_bytes, object_count, role, or status"),
    include_archived: bool = Query(False, description="Include archived Storage Spaces"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceSummary]:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    spaces: list[PortalStorageSpaceSummary] = []
    for account_link in project_access.account_links:
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            account_spaces = service.list_storage_spaces(
                user,
                account_access,
                search=search,
                role=role,
                status=status_filter,
                sort=sort,
                include_archived=include_archived,
            )
        except RuntimeError as exc:
            raise_bad_gateway_from_runtime(exc)
        spaces.extend(
            _with_project_space_identity(space, account_id=account_link.account_id, account_label=account_link.display_name)
            for space in account_spaces
        )
    reverse = sort.startswith("-")
    key = sort[1:] if reverse else sort
    sorters = {
        "name": lambda item: ((item.project_account_label or "").lower(), item.name.lower()),
        "created_at": lambda item: item.created_at or utcnow(),
        "used_bytes": lambda item: item.used_bytes if item.used_bytes is not None else -1,
        "object_count": lambda item: item.object_count if item.object_count is not None else -1,
        "role": lambda item: item.role,
        "status": lambda item: item.status or "",
    }
    return sorted(spaces, key=sorters.get(key, sorters["name"]), reverse=reverse)


@router.get("/projects/{project_id}/replications", response_model=PortalReplicationList)
def portal_project_replications(
    project_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalReplicationList:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
        contexts = _project_replication_contexts(project_access, projects_service)
        return service.list_replications(user, contexts)
    except ValueError as exc:
        _raise_project_access_error(exc)
    except Exception as exc:
        _raise_portal_replication_error(exc)


@router.post("/projects/{project_id}/replications", response_model=PortalReplicationSummary, status_code=status.HTTP_201_CREATED)
def create_portal_project_replication(
    project_id: int,
    payload: PortalReplicationCreate,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalReplicationSummary:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    contexts = _project_replication_contexts(project_access, projects_service)
    try:
        replication = service.create_replication(user, contexts, payload)
    except Exception as exc:
        _raise_portal_replication_error(exc)
    audit_service.record_action(
        user=user,
        scope="portal",
        action="create_bucket_replication",
        entity_type="storage_space",
        entity_id=replication.source.id,
        account_id=replication.source.account_id,
        account_name=replication.source.account_name,
        metadata={
            "project_id": project_id,
            "source_storage_space_id": replication.source.id,
            "target_storage_space_id": replication.target.id if replication.target else None,
            "source_bucket": replication.source.bucket_name,
            "target_bucket": replication.target_bucket_name,
            "zonegroup": replication.zonegroup,
            "replication_mode": replication.mode,
            "rule_id": replication.rule_id,
        },
    )
    return replication


def _project_account_id_from_payload(project_access: PortalProjectAccess, requested_account_id: Optional[int]) -> int:
    if requested_account_id is not None:
        if requested_account_id not in project_access.account_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account is not associated with this project")
        return requested_account_id
    if len(project_access.account_links) == 1:
        return project_access.account_links[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose the project account for this Storage Space")


@router.post("/projects/{project_id}/storage-spaces", response_model=PortalStorageSpace, status_code=status.HTTP_201_CREATED)
def create_portal_project_storage_space(
    project_id: int,
    payload: PortalStorageSpaceCreate,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    account_id = _project_account_id_from_payload(project_access, payload.account_id)
    account_access = projects_service.account_access_for_project(project_access, account_id)
    try:
        storage_space = service.create_storage_space(
            user,
            account_access,
            name=payload.name,
            naming_mode=payload.naming_mode,
            description=payload.description,
            owner_label=payload.owner_label,
            visibility=payload.visibility,
            share_scope=payload.share_scope,
            account_member_role=payload.account_member_role,
            initial_shares=payload.initial_shares,
            project_key=payload.project_key,
            dataset_label=payload.dataset_label,
        )
        audit_service.record_action(
            user=user,
            scope="portal",
            action="create_storage_space",
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": storage_space.id},
        )
        label = _portal_project_label(project_access, account_id)
        return PortalStorageSpace.model_validate(
            _with_project_space_identity(storage_space, account_id=account_id, account_label=label).model_dump()
        )
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.post("/projects/{project_id}/storage-spaces/import", response_model=PortalStorageSpace, status_code=status.HTTP_201_CREATED)
def import_portal_project_storage_space(
    project_id: int,
    payload: PortalStorageSpaceImport,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    account_id = _project_account_id_from_payload(project_access, payload.account_id)
    account_access = projects_service.account_access_for_project(project_access, account_id)
    try:
        storage_space = service.import_storage_space(
            user,
            account_access,
            bucket_name=payload.bucket_name,
            description=payload.description,
            owner_label=payload.owner_label,
            visibility=payload.visibility,
            share_scope=payload.share_scope,
            account_member_role=payload.account_member_role,
            initial_shares=payload.initial_shares,
            project_key=payload.project_key,
            dataset_label=payload.dataset_label,
        )
        audit_service.record_action(
            user=user,
            scope="portal",
            action="import_storage_space",
            entity_type="storage_space",
            entity_id=storage_space.id,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": storage_space.id},
        )
        label = _portal_project_label(project_access, account_id)
        return PortalStorageSpace.model_validate(
            _with_project_space_identity(storage_space, account_id=account_id, account_label=label).model_dump()
        )
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


def _project_storage_account_access(
    project_id: int,
    space_id: str,
    *,
    user: User,
    db: Session,
) -> tuple[PortalProjectAccess, AccountAccess, int, str]:
    account_id, bucket_name = _parse_project_space_id(space_id)
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
        account_access = projects_service.account_access_for_project(project_access, account_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    return project_access, account_access, account_id, bucket_name


@router.get("/projects/{project_id}/storage-spaces/{space_id}", response_model=PortalStorageSpace)
def portal_project_storage_space_detail(
    project_id: int,
    space_id: str,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        storage_space = service.get_storage_space(user, account_access, bucket_name)
    except RuntimeError as exc:
        detail = sanitize_error_detail(str(exc))
        if "autorisé" in detail.lower() or "not allowed" in detail.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
        raise_bad_gateway_from_runtime(exc)
    if storage_space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage space not found")
    label = _portal_project_label(project_access, account_id)
    return PortalStorageSpace.model_validate(
        _with_project_space_identity(storage_space, account_id=account_id, account_label=label).model_dump()
    )


@router.patch("/projects/{project_id}/storage-spaces/{space_id}", response_model=PortalStorageSpace)
def update_portal_project_storage_space(
    project_id: int,
    space_id: str,
    payload: PortalStorageSpaceUpdate,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpace:
    project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        storage_space = service.update_storage_space(
            user,
            account_access,
            bucket_name,
            name=payload.name,
            description=payload.description,
            owner_label=payload.owner_label,
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
            user=user,
            scope="portal",
            action=action,
            entity_type="storage_space",
            entity_id=bucket_name,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name},
        )
        label = _portal_project_label(project_access, account_id)
        return PortalStorageSpace.model_validate(
            _with_project_space_identity(storage_space, account_id=account_id, account_label=label).model_dump()
        )
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/access-summary", response_model=PortalStorageSpaceAccessSummary)
def portal_project_storage_space_access_summary(
    project_id: int,
    space_id: str,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceAccessSummary:
    _project_access, account_access, _account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        return service.get_storage_space_access_summary(user, account_access, bucket_name)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_project_storage_space_share_candidates(
    project_id: int,
    space_id: str,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShareCandidate]:
    _project_access, account_access, _account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        return service.list_storage_space_share_candidates(user, account_access, bucket_name)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/shares", response_model=list[PortalStorageSpaceShare])
def portal_project_storage_space_shares(
    project_id: int,
    space_id: str,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShare]:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        return [
            _with_project_share(share, account_id=account_id)
            for share in service.list_storage_space_shares(user, account_access, bucket_name)
        ]
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.post("/projects/{project_id}/storage-spaces/{space_id}/shares", response_model=PortalStorageSpaceShare, status_code=status.HTTP_201_CREATED)
def grant_portal_project_storage_space_share(
    project_id: int,
    space_id: str,
    payload: PortalStorageSpaceSharePayload,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceShare:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    target = _resolve_share_target(payload, users_service)
    try:
        share = service.set_storage_space_share(user, account_access, target, bucket_name, payload.role)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="grant_storage_space_share",
            entity_type="storage_space",
            entity_id=bucket_name,
            account=account_access.account,
            metadata={"project_id": project_id, "target_user_id": target.id, "role": payload.role},
        )
        return _with_project_share(share, account_id=account_id)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.put("/projects/{project_id}/storage-spaces/{space_id}/shares/{user_id}", response_model=PortalStorageSpaceShare)
def update_portal_project_storage_space_share(
    project_id: int,
    space_id: str,
    user_id: int,
    payload: PortalStorageSpaceShareUpdate,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageSpaceShare:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        share = service.set_storage_space_share(user, account_access, target, bucket_name, payload.role)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="update_storage_space_share",
            entity_type="storage_space",
            entity_id=bucket_name,
            account=account_access.account,
            metadata={"project_id": project_id, "target_user_id": target.id, "role": payload.role},
        )
        return _with_project_share(share, account_id=account_id)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/projects/{project_id}/storage-spaces/{space_id}/shares/{user_id}", response_model=list[PortalStorageSpaceShare])
def revoke_portal_project_storage_space_share(
    project_id: int,
    space_id: str,
    user_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShare]:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    target = users_service.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        shares = service.revoke_storage_space_share(user, account_access, target, bucket_name)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="revoke_storage_space_share",
            entity_type="storage_space",
            entity_id=bucket_name,
            account=account_access.account,
            metadata={"project_id": project_id, "target_user_id": target.id},
        )
        return [_with_project_share(share, account_id=account_id) for share in shares]
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/objects/detail", response_model=PortalStorageObjectDetail)
def portal_project_storage_space_object_detail(
    project_id: int,
    space_id: str,
    key: str = Query(..., min_length=1),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectDetail:
    _project_access, account_access, _account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        return service.get_storage_space_object_detail(user, account_access, bucket_name, key)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/projects/{project_id}/storage-spaces/{space_id}/objects", response_model=PortalStorageObjectDeleteResponse)
def portal_delete_project_storage_space_object(
    project_id: int,
    space_id: str,
    key: str = Query(..., min_length=1),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalStorageObjectDeleteResponse:
    _project_access, account_access, _account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        deleted_key = service.delete_storage_space_object(user, account_access, bucket_name, key)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="delete_object",
            entity_type="object",
            entity_id=deleted_key,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name},
        )
        return PortalStorageObjectDeleteResponse(key=deleted_key, message="Deleted")
    except RuntimeError as exc:
        audit_service.record_action(
            user=user,
            scope="portal",
            action="delete_object",
            entity_type="object",
            entity_id=key,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name},
            status="failed",
            message=sanitized_error_log_detail(exc),
        )
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/objects/download")
def portal_download_project_storage_space_object(
    project_id: int,
    space_id: str,
    key: str = Query(..., min_length=1),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> StreamingResponse:
    _project_access, account_access, _account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        stream, content_type, filename = service.download_storage_space_object(user, account_access, bucket_name, key)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="download_object",
            entity_type="object",
            entity_id=key,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name},
        )
        headers = {}
        if filename:
            headers["Content-Disposition"] = build_attachment_content_disposition(filename)
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        audit_service.record_action(
            user=user,
            scope="portal",
            action="download_object",
            entity_type="object",
            entity_id=key,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name},
            status="failed",
            message=sanitized_error_log_detail(exc),
        )
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/storage-spaces/{space_id}/public-links", response_model=list[PortalPublicLink])
def portal_project_storage_space_public_links(
    project_id: int,
    space_id: str,
    object_key: Optional[str] = Query(None),
    include_revoked: bool = Query(False),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalPublicLink]:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        return [
            _with_project_public_link(link, account_id=account_id)
            for link in service.list_storage_space_public_links(
                user,
                account_access,
                bucket_name,
                object_key=object_key,
                include_revoked=include_revoked,
            )
        ]
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.post("/projects/{project_id}/storage-spaces/{space_id}/public-links", response_model=PortalPublicLink, status_code=status.HTTP_201_CREATED)
def create_portal_project_storage_space_public_link(
    project_id: int,
    space_id: str,
    payload: PortalPublicLinkCreate,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalPublicLink:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        link = service.create_storage_space_public_link(
            user,
            account_access,
            bucket_name,
            object_key=payload.object_key,
            label=payload.label,
            expires_at=payload.expires_at,
        )
        audit_service.record_action(
            user=user,
            scope="portal",
            action="create_public_link",
            entity_type="object",
            entity_id=payload.object_key,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name, "public_link_id": link.id},
        )
        return _with_project_public_link(link, account_id=account_id)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.delete("/projects/{project_id}/storage-spaces/{space_id}/public-links/{link_id}", response_model=list[PortalPublicLink])
def revoke_portal_project_storage_space_public_link(
    project_id: int,
    space_id: str,
    link_id: int,
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalPublicLink]:
    _project_access, account_access, account_id, bucket_name = _project_storage_account_access(
        project_id,
        space_id,
        user=user,
        db=db,
    )
    try:
        links = service.revoke_storage_space_public_link(user, account_access, bucket_name, link_id)
        audit_service.record_action(
            user=user,
            scope="portal",
            action="revoke_public_link",
            entity_type="storage_space",
            entity_id=bucket_name,
            account=account_access.account,
            metadata={"project_id": project_id, "storage_space_id": bucket_name, "public_link_id": link_id},
        )
        return [_with_project_public_link(link, account_id=account_id) for link in links]
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/share-candidates", response_model=list[PortalStorageSpaceShareCandidate])
def portal_project_share_candidates(
    project_id: int,
    account_id: Optional[int] = Query(None),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalStorageSpaceShareCandidate]:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    target_account_id = _project_account_id_from_payload(project_access, account_id)
    account_access = projects_service.account_access_for_project(project_access, target_account_id)
    if not account_access.capabilities.can_manage_portal_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this project")
    try:
        return service.list_storage_space_share_candidates(user, account_access)
    except RuntimeError as exc:
        _raise_portal_storage_runtime(exc)


@router.get("/projects/{project_id}/activity", response_model=list[PortalActivityItem])
def portal_project_activity(
    project_id: int,
    space_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalActivityItem]:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    requested_account_id = requested_bucket = None
    if space_id:
        requested_account_id, requested_bucket = _parse_project_space_id(space_id)
    items: list[PortalActivityItem] = []
    for account_link in project_access.account_links:
        if requested_account_id is not None and account_link.account_id != requested_account_id:
            continue
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            account_items = service.list_portal_activity(
                user,
                account_access,
                space_id=requested_bucket if requested_account_id is not None else None,
                limit=limit,
            )
        except RuntimeError as exc:
            _raise_portal_storage_runtime(exc)
        for item in account_items:
            payload = item.model_dump()
            if item.storage_space_id:
                payload["storage_space_id"] = _project_space_id(account_link.account_id, item.storage_space_id)
            if account_link.display_name and item.storage_space_name:
                payload["storage_space_name"] = f"{item.storage_space_name} ({account_link.display_name})"
            items.append(PortalActivityItem.model_validate(payload))
    return sorted(items, key=lambda item: item.created_at, reverse=True)[:limit]


@router.get("/projects/{project_id}/transfers", response_model=list[PortalTransfer])
def portal_project_transfers(
    project_id: int,
    space_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalTransfer]:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    requested_account_id = requested_bucket = None
    if space_id:
        requested_account_id, requested_bucket = _parse_project_space_id(space_id)
    items: list[PortalTransfer] = []
    for account_link in project_access.account_links:
        if requested_account_id is not None and account_link.account_id != requested_account_id:
            continue
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            account_items = service.list_portal_transfers(
                user,
                account_access,
                space_id=requested_bucket if requested_account_id is not None else None,
                limit=limit,
            )
        except RuntimeError as exc:
            _raise_portal_storage_runtime(exc)
        for item in account_items:
            payload = item.model_dump()
            if item.storage_space_id:
                payload["storage_space_id"] = _project_space_id(account_link.account_id, item.storage_space_id)
            if account_link.display_name and item.storage_space_name:
                payload["storage_space_name"] = f"{item.storage_space_name} ({account_link.display_name})"
            items.append(PortalTransfer.model_validate(payload))
    return sorted(items, key=lambda item: item.started_at, reverse=True)[:limit]


@router.get("/projects/{project_id}/alerts", response_model=list[PortalAlert])
def portal_project_alerts(
    project_id: int,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> list[PortalAlert]:
    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        _raise_project_access_error(exc)
    items: list[PortalAlert] = []
    for account_link in project_access.account_links:
        account_access = projects_service.account_access_for_project(project_access, account_link.account_id)
        try:
            account_items = service.list_portal_alerts(user, account_access, limit=limit)
        except RuntimeError as exc:
            _raise_portal_storage_runtime(exc)
        for item in account_items:
            payload = item.model_dump()
            if item.storage_space_id:
                payload["storage_space_id"] = _project_space_id(account_link.account_id, item.storage_space_id)
            if account_link.display_name:
                payload["title"] = f"{item.title} ({account_link.display_name})"
            items.append(PortalAlert.model_validate(payload))
    return sorted(items, key=lambda item: item.created_at or utcnow(), reverse=True)[:limit]


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


@router.get("/replications", response_model=PortalReplicationList)
def portal_replications(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalReplicationList:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_replications(actor, [PortalReplicationAccountContext(access=access)])
    except Exception as exc:
        _raise_portal_replication_error(exc)


@router.post("/replications", response_model=PortalReplicationSummary, status_code=status.HTTP_201_CREATED)
def create_portal_replication(
    payload: PortalReplicationCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_logger),
    service: PortalService = Depends(lambda db=Depends(get_db): get_portal_service(db)),
) -> PortalReplicationSummary:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        replication = service.create_replication(actor, [PortalReplicationAccountContext(access=access)], payload)
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_bucket_replication",
            entity_type="storage_space",
            entity_id=replication.source.id,
            account_id=replication.source.account_id,
            account_name=replication.source.account_name,
            metadata={
                "source_storage_space_id": replication.source.id,
                "target_storage_space_id": replication.target.id if replication.target else None,
                "source_bucket": replication.source.bucket_name,
                "target_bucket": replication.target_bucket_name,
                "zonegroup": replication.zonegroup,
                "replication_mode": replication.mode,
                "rule_id": replication.rule_id,
            },
        )
        return replication
    except Exception as exc:
        _raise_portal_replication_error(exc)


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
            owner_label=payload.owner_label,
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
            owner_label=payload.owner_label,
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
