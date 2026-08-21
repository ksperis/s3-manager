# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User
from app.models.access_context import ManagerActor
from app.models.execution_context import ManagerContext
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies import (
    get_account_context,
    get_current_actor,
    is_manager_bucket_quota_available,
    is_manager_rgw_access_key_management_available,
)
from app.services.app_settings_service import load_app_settings
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_users_service import get_s3_users_service
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_supervision import has_supervision_credentials
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags

router = APIRouter(prefix="/manager", tags=["manager-context"])


@dataclass(frozen=True)
class _ManagerBrowserState:
    enabled: bool
    message: Optional[str]


@dataclass(frozen=True)
class _ManagerLimits:
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    max_buckets: Optional[int] = None
    max_users: Optional[int] = None
    max_roles: Optional[int] = None
    max_groups: Optional[int] = None


def _manager_stats_state(account, actor) -> tuple[bool, Optional[str], Optional[str]]:
    rgw_usage_metrics_enabled = bool(load_app_settings().manager.manager_rgw_usage_metrics_enabled)
    connection_id = getattr(account, "s3_connection_id", None)
    if connection_id is not None:
        caps = getattr(account, "manager_capabilities", None)
        if not caps or not caps.can_manage_buckets:
            return False, "Metrics are not available for this connection.", None
        source_connection = getattr(account, "source_connection", None)
        if source_connection is None:
            return False, "Metrics are unavailable: connection context is incomplete.", None
        resolution = ConnectionIdentityService().resolve_metrics_identity(source_connection)
        if not resolution.eligible:
            return False, (resolution.reason or "Metrics are unavailable for this connection."), None
        if not rgw_usage_metrics_enabled:
            return False, "RGW traffic and usage metrics are disabled.", resolution.iam_identity
        if not has_supervision_credentials(account):
            return False, "Supervision credentials are not configured for this endpoint.", resolution.iam_identity
        if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
            return False, "Metrics are not available for this profile.", resolution.iam_identity
        return True, None, resolution.iam_identity

    if not rgw_usage_metrics_enabled:
        return False, "RGW traffic and usage metrics are disabled.", None
    if not has_supervision_credentials(account):
        return False, None, None
    if getattr(account, "s3_user_id", None) is not None and not getattr(account, "rgw_user_uid", None):
        return False, None, None
    caps = getattr(account, "manager_capabilities", None)
    if not caps or not caps.can_manage_buckets:
        return False, None, None
    if isinstance(actor, ManagerSessionPrincipal):
        return bool(actor.capabilities.can_view_traffic), None, None
    if isinstance(actor, User):
        return True, None, None
    return False, None, None


def _manager_access_mode(
    actor: ManagerActor,
    s3_user_id: Optional[int],
    s3_connection_id: Optional[int],
) -> str:
    if isinstance(actor, ManagerSessionPrincipal):
        return "session"
    if s3_connection_id is not None:
        return "connection"
    if s3_user_id is not None:
        return "s3_user"
    return "admin"


def _manager_browser_state(
    account,
    actor: ManagerActor,
    db: Session,
    access_service: Optional[EffectiveAccessService],
    resolved_access: Optional[ResolvedUserAccess],
) -> _ManagerBrowserState:
    settings = load_app_settings()
    if not settings.general.browser_enabled:
        return _ManagerBrowserState(False, "Browser is disabled.")
    if not settings.general.manager_enabled:
        return _ManagerBrowserState(False, "Manager is disabled.")
    if not settings.general.browser_manager_enabled:
        return _ManagerBrowserState(False, "Manager Browser is disabled.")
    if isinstance(actor, ManagerSessionPrincipal):
        enabled = bool(actor.capabilities.access_browser)
        message = None if enabled else "Browser access is not allowed for this session."
        return _ManagerBrowserState(enabled, message)

    if resolved_access is None or access_service is None:
        raise RuntimeError("UI user effective access was not resolved")
    s3_connection_id = getattr(account, "s3_connection_id", None)
    if s3_connection_id is not None:
        connection = db.query(S3Connection).filter(S3Connection.id == s3_connection_id).first()
        enabled = bool(
            connection
            and access_service.manager_browser_connection_is_allowed(
                actor,
                connection,
            )
        )
        message = None
        if not enabled:
            message = (
                "Manager Browser requires an owned private connection with both Manager and "
                "Browser access. Shared connections are not supported."
            )
        return _ManagerBrowserState(enabled, message)

    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is not None:
        enabled = resolved_access.can_browse_s3_user(int(s3_user_id))
        message = None if enabled else "Manager Browser data access is not allowed for this RGW user."
        return _ManagerBrowserState(enabled, message)

    account_id = getattr(account, "id", None)
    link = resolved_access.account_link_for(int(account_id)) if account_id else None
    enabled = bool(link and link.manager_browser_allowed)
    message = None
    if not enabled:
        message = (
            "Manager Browser requires account administrator and explicit data access on the "
            "same association."
        )
    return _ManagerBrowserState(enabled, message)


def _manager_iam_identity(
    account,
    actor: ManagerActor,
    access_mode: str,
    connection_iam_identity: Optional[str],
) -> Optional[str]:
    if access_mode == "admin":
        return resolve_admin_uid(
            getattr(account, "rgw_account_id", None),
            getattr(account, "rgw_user_uid", None),
        )
    if access_mode == "session" and isinstance(actor, ManagerSessionPrincipal):
        return actor.user_uid or actor.account_id or actor.account_name
    if access_mode == "s3_user":
        return getattr(account, "rgw_user_uid", None)
    if access_mode == "connection":
        return connection_iam_identity
    return None


def _manager_private_access_enabled(
    account,
    actor: ManagerActor,
    db: Session,
    resolved_access: Optional[ResolvedUserAccess],
) -> bool:
    if not isinstance(actor, User):
        return False
    if resolved_access is None:
        raise RuntimeError("UI user effective access was not resolved")
    if getattr(account, "s3_user_id", None) is not None:
        return ManagedPrivateAccessService(db).rgw_user_provisioning_available(actor, account)

    capabilities = getattr(account, "manager_capabilities", None)
    endpoint = getattr(account, "storage_endpoint", None)
    return bool(
        resolved_access.can_provision_managed_private_connections
        and capabilities
        and capabilities.can_manage_iam
        and (endpoint is None or resolve_feature_flags(endpoint).iam_enabled)
    )


def _manager_limits(
    account,
    db: Session,
    *,
    include_limits: bool,
    s3_user_id: Optional[int],
    s3_connection_id: Optional[int],
) -> _ManagerLimits:
    if not include_limits or s3_connection_id is not None:
        return _ManagerLimits()
    if s3_user_id is not None:
        s3_user = db.query(S3User).filter(S3User.id == s3_user_id).first()
        if s3_user is None:
            return _ManagerLimits()
        quota_max_size_gb, quota_max_objects, max_buckets = get_s3_users_service(db).get_user_limits(s3_user)
        return _ManagerLimits(
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            max_buckets=max_buckets,
        )

    account_id = getattr(account, "id", None)
    s3_account = db.query(S3Account).filter(S3Account.id == account_id).first() if account_id else None
    if s3_account is None:
        return _ManagerLimits()
    (
        quota_max_size_gb,
        quota_max_objects,
        max_buckets,
        max_users,
        max_roles,
        max_groups,
    ) = get_s3_accounts_service(db).get_account_limits(s3_account)
    return _ManagerLimits(
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        max_buckets=max_buckets,
        max_users=max_users,
        max_roles=max_roles,
        max_groups=max_groups,
    )


@router.get("/context", response_model=ManagerContext)
def get_manager_context(
    account=Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
    include_limits: bool = Query(default=False),
) -> ManagerContext:
    s3_user_id = getattr(account, "s3_user_id", None)
    s3_connection_id = getattr(account, "s3_connection_id", None)
    manager_stats_enabled, manager_stats_message, connection_iam_identity = _manager_stats_state(account, actor)
    access_mode = _manager_access_mode(actor, s3_user_id, s3_connection_id)
    access_service = EffectiveAccessService(db) if isinstance(actor, User) else None
    resolved_access = access_service.resolve_user(actor) if access_service else None
    browser_state = _manager_browser_state(
        account,
        actor,
        db,
        access_service,
        resolved_access,
    )
    iam_identity = _manager_iam_identity(
        account,
        actor,
        access_mode,
        connection_iam_identity,
    )

    manager_ceph_keys_enabled = (
        is_manager_rgw_access_key_management_available(account, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    manager_private_access_enabled = _manager_private_access_enabled(
        account,
        actor,
        db,
        resolved_access,
    )
    manager_bucket_quota_enabled = (
        is_manager_bucket_quota_available(account, actor, db=db)
        if isinstance(actor, User)
        else False
    )
    limits = _manager_limits(
        account,
        db,
        include_limits=include_limits,
        s3_user_id=s3_user_id,
        s3_connection_id=s3_connection_id,
    )

    return ManagerContext(
        access_mode=access_mode,
        context_kind=("connection" if access_mode == "connection" else "account"),
        iam_identity=iam_identity,
        manager_stats_enabled=manager_stats_enabled,
        manager_stats_message=manager_stats_message,
        manager_browser_enabled=browser_state.enabled,
        manager_browser_message=browser_state.message,
        manager_bucket_quota_enabled=manager_bucket_quota_enabled,
        manager_ceph_keys_enabled=manager_ceph_keys_enabled,
        manager_private_access_enabled=manager_private_access_enabled,
        quota_max_size_gb=limits.quota_max_size_gb,
        quota_max_objects=limits.quota_max_objects,
        max_buckets=limits.max_buckets,
        max_users=limits.max_users,
        max_roles=limits.max_roles,
        max_groups=limits.max_groups,
    )
