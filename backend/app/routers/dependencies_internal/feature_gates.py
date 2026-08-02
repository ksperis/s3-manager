# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3User, StorageEndpoint, StorageProvider, User, UserRole, UserS3Account
from app.models.access_context import BucketMigrationAccessScope, EffectiveAccountLink, ManagerActor
from app.models.account_capabilities import AccountCapabilities
from app.models.session import ManagerSessionPrincipal
from app.services import app_settings_service, effective_access_service
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.effective_access_service import EffectiveAccessService
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.rgw import has_supervision_credentials
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags

from .account_context import get_account_context
from .auth_session import get_current_actor, get_current_storage_ops_admin, get_current_user

ManagerToolKey = Literal[
    "bucket_compare",
    "bucket_integrity_check",
    "bucket_migration",
    "feature_rules",
    "bucket_quota",
    "bucket_purge",
    "ceph_s3_user_keys",
]

_MANAGER_TOOL_ACCESS_FIELDS: dict[ManagerToolKey, str] = {
    "bucket_compare": "can_access_manager_bucket_compare",
    "bucket_integrity_check": "can_access_manager_bucket_integrity_check",
    "bucket_migration": "can_access_manager_bucket_migration",
    "feature_rules": "can_access_manager_feature_rules",
    "bucket_quota": "can_access_manager_bucket_quota",
    "bucket_purge": "can_access_manager_bucket_purge",
    "ceph_s3_user_keys": "can_access_manager_ceph_s3_user_keys",
}

_MANAGER_TOOL_GLOBAL_FIELDS: dict[ManagerToolKey, tuple[str, str]] = {
    "bucket_compare": ("bucket_compare_enabled", "Bucket compare feature is disabled"),
    "bucket_integrity_check": ("bucket_integrity_check_enabled", "Bucket integrity check feature is disabled"),
    "bucket_migration": ("bucket_migration_enabled", "Bucket migration feature is disabled"),
    "bucket_purge": ("bucket_purge_enabled", "Bucket purge feature is disabled"),
    "ceph_s3_user_keys": ("manager_ceph_s3_user_keys_enabled", "Ceph key management feature is disabled"),
}

_MANAGER_TOOL_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
    UserRole.UI_USER.value,
}

def _ensure_manager_capabilities(account: S3ExecutionTarget, require_iam: bool = False, require_usage: bool = False) -> None:
    caps: Optional[AccountCapabilities] = getattr(account, "manager_capabilities", None)  # type: ignore[attr-defined]
    if not caps:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account context unavailable")
    if require_iam and not caps.can_manage_iam:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM management not allowed for this account")
    if require_iam:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint and not resolve_feature_flags(endpoint).iam_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IAM is disabled for this endpoint")
    if require_usage and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics not available for this account")


def _require_supervision_access(
    account: S3ExecutionTarget,
    actor: ManagerActor,
    disabled_detail: str,
    required_feature: str,
) -> ManagerActor:
    caps: Optional[AccountCapabilities] = getattr(account, "manager_capabilities", None)  # type: ignore[attr-defined]
    endpoint = getattr(account, "storage_endpoint", None)

    connection_id = getattr(account, "s3_connection_id", None)
    if connection_id is not None:
        source_connection = getattr(account, "source_connection", None)
        if source_connection is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Metrics are unavailable: connection context is incomplete.",
            )
        resolution = ConnectionIdentityService().resolve_metrics_identity(source_connection)
        if not resolution.eligible:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=resolution.reason or disabled_detail)
        if required_feature == "metrics" and not resolution.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
        if required_feature == "usage" and not resolution.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
        if resolution.rgw_account_id:
            account.rgw_account_id = resolution.rgw_account_id
        if resolution.rgw_user_uid:
            account.rgw_user_uid = resolution.rgw_user_uid

    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if required_feature == "metrics" and not flags.metrics_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
        if required_feature == "usage" and not flags.usage_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
    if not has_supervision_credentials(account):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Supervision credentials are not configured for this account")
    if isinstance(actor, ManagerSessionPrincipal) and not actor.capabilities.can_view_traffic:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this profile")
    if caps and not caps.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this account")
    if caps and isinstance(actor, User) and not caps.using_root_key:
        settings = app_settings_service.load_app_settings()
        if not settings.manager.allow_manager_user_usage_stats:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics are not available for this profile")
    return actor


def require_iam_capable_manager(
    account: S3ExecutionTarget = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    _ensure_manager_capabilities(account, require_iam=True)
    return actor


def require_usage_capable_manager(
    account: S3ExecutionTarget = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    return _require_supervision_access(
        account,
        actor,
        disabled_detail="Storage metrics are disabled for this endpoint",
        required_feature="metrics",
    )


def require_sns_capable_manager(
    account: S3ExecutionTarget = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    _ensure_manager_capabilities(account)
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint:
        flags = resolve_feature_flags(endpoint)
        if not flags.sns_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SNS topics are disabled for this endpoint")
    return actor


def require_metrics_capable_manager(
    account: S3ExecutionTarget = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_actor),
) -> ManagerActor:
    return _require_supervision_access(
        account,
        actor,
        disabled_detail="Usage logs are disabled for this endpoint",
        required_feature="usage",
    )


def _manager_tool_global_state(tool: ManagerToolKey) -> tuple[bool, str]:
    app_settings = app_settings_service.load_app_settings()
    global_state = _MANAGER_TOOL_GLOBAL_FIELDS.get(tool)
    if global_state is None:
        return True, ""
    global_field, disabled_detail = global_state
    return bool(getattr(app_settings.general, global_field)), disabled_detail


def user_has_manager_tool_access(user: User, tool: ManagerToolKey, db: Session | None = None) -> bool:
    if db is not None:
        access = effective_access_service.EffectiveAccessService(db).resolve_user(user).manager_tool_access
        return bool(getattr(access, tool, False))
    return bool(getattr(user, _MANAGER_TOOL_ACCESS_FIELDS[tool], False))


def ensure_manager_tool_allowed(user: User, tool: ManagerToolKey, db: Session | None = None) -> None:
    enabled, disabled_detail = _manager_tool_global_state(tool)
    if not enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=disabled_detail)
    if user.role not in _MANAGER_TOOL_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    if user_has_manager_tool_access(user, tool, db=db):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


def _ensure_bucket_migration_allowed(user: User, db: Session | None = None) -> None:
    ensure_manager_tool_allowed(user, "bucket_migration", db=db)


def _manager_link_allows_bucket_migration(
    link: UserS3Account | EffectiveAccountLink,
) -> bool:
    return EffectiveAccessService.manager_account_allowed(link.role)


def _build_bucket_migration_allowed_context_ids(db: Session, user: User) -> set[str]:
    allowed_context_ids: set[str] = set()

    service = effective_access_service.EffectiveAccessService(db)
    effective = service.resolve_user(user)
    for link in effective.account_links:
        if _manager_link_allows_bucket_migration(link):
            allowed_context_ids.add(str(link.account_id))

    for s3_user_id in effective.s3_user_ids:
        allowed_context_ids.add(f"s3u-{s3_user_id}")

    connections = service.list_workspace_connections(user, workspace="manager", resolved=effective)
    for connection in connections:
        allowed_context_ids.add(f"conn-{connection.id}")

    return allowed_context_ids


def _build_bucket_migration_admin_account_context_ids(db: Session, user: User) -> set[str]:
    admin_account_context_ids: set[str] = set()
    account_links = effective_access_service.EffectiveAccessService(db).resolve_user(user).account_links
    for link in account_links:
        if _manager_link_allows_bucket_migration(link):
            admin_account_context_ids.add(str(link.account_id))
    return admin_account_context_ids


def get_current_bucket_migration_scope(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BucketMigrationAccessScope:
    _ensure_bucket_migration_allowed(user, db=db)
    allowed_context_ids = _build_bucket_migration_allowed_context_ids(db, user)
    admin_account_context_ids = _build_bucket_migration_admin_account_context_ids(db, user)
    return BucketMigrationAccessScope(
        user=user,
        allowed_context_ids=allowed_context_ids,
        admin_account_context_ids=admin_account_context_ids,
    )


def require_bucket_compare_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_compare", db=db)
    return user


def require_bucket_integrity_check_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_integrity_check", db=db)
    return user


def require_bucket_purge_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "bucket_purge", db=db)
    return user


def require_bucket_purge_global_enabled() -> None:
    app_settings = app_settings_service.load_app_settings()
    if not bool(app_settings.general.bucket_purge_enabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket purge feature is disabled")


def require_bucket_usage_stats_enabled(user: User = Depends(get_current_user)) -> User:
    app_settings = app_settings_service.load_app_settings()
    if not bool(app_settings.general.bucket_usage_stats_enabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket usage stats feature is disabled")
    if user.role not in _MANAGER_TOOL_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def require_manager_feature_rules_enabled(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    ensure_manager_tool_allowed(user, "feature_rules", db=db)
    return user


def _is_ceph_endpoint_admin_available(account: S3ExecutionTarget) -> bool:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        return False
    try:
        if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
            return False
    except (AttributeError, TypeError, ValueError):
        return False

    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        return False
    if not resolve_admin_endpoint(endpoint):
        return False

    access_key = (getattr(endpoint, "admin_access_key", None) or "").strip()
    secret_key = (getattr(endpoint, "admin_secret_key", None) or "").strip()
    return bool(access_key and secret_key)


def is_manager_bucket_quota_available(
    account: S3ExecutionTarget,
    user: Optional[User] = None,
    db: Session | None = None,
) -> bool:
    if user is not None and not user_has_manager_tool_access(user, "bucket_quota", db=db):
        return False
    if not _is_ceph_endpoint_admin_available(account):
        return False
    return _target_allows_manager_bucket_quota(account, db=db)


def _s3_user_flag_enabled(
    account: S3ExecutionTarget,
    flag_name: str,
    *,
    db: Session | None = None,
) -> bool:
    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is None:
        return False
    if db is not None:
        row = db.query(S3User).filter(S3User.id == s3_user_id).first()
        if row is not None:
            return bool(getattr(row, flag_name, False))
    return bool(getattr(account, flag_name, False))


def _target_allows_manager_bucket_quota(account: S3ExecutionTarget, *, db: Session | None = None) -> bool:
    if getattr(account, "s3_connection_id", None) is not None:
        return False
    if getattr(account, "s3_user_id", None) is not None:
        return _s3_user_flag_enabled(account, "allow_manager_bucket_quota", db=db)
    account_id = getattr(account, "id", None)
    if db is not None and isinstance(account_id, int) and account_id > 0:
        row = db.query(S3Account).filter(S3Account.id == account_id).first()
        if row is not None:
            return bool(getattr(row, "allow_manager_bucket_quota", False))
    return bool(getattr(account, "allow_manager_bucket_quota", False))


def require_manager_bucket_quota(
    user: User = Depends(get_current_user),
    account: S3ExecutionTarget = Depends(get_account_context),
    db: Session = Depends(get_db),
) -> S3ExecutionTarget:
    ensure_manager_tool_allowed(user, "bucket_quota", db=db)
    if not is_manager_bucket_quota_available(account, user, db=db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket quota management is not available for this context",
        )
    return account


def require_storage_ops_bucket_quota(
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> User:
    ensure_manager_tool_allowed(user, "bucket_quota", db=db)
    return user


def is_manager_ceph_s3_user_keys_available(
    account: S3ExecutionTarget,
    user: Optional[User] = None,
    db: Session | None = None,
) -> bool:
    enabled, _ = _manager_tool_global_state("ceph_s3_user_keys")
    if not enabled:
        return False
    if user is not None and not user_has_manager_tool_access(user, "ceph_s3_user_keys", db=db):
        return False

    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is None:
        return False
    if not _s3_user_flag_enabled(account, "allow_manager_ceph_s3_user_keys", db=db):
        return False

    return _is_ceph_endpoint_admin_available(account)


def require_manager_ceph_s3_user_keys(
    user: User = Depends(get_current_user),
    account: S3ExecutionTarget = Depends(get_account_context),
    db: Session = Depends(get_db),
) -> S3ExecutionTarget:
    ensure_manager_tool_allowed(user, "ceph_s3_user_keys", db=db)
    if not is_manager_ceph_s3_user_keys_available(account, user, db=db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ceph key management is not available for this context",
        )
    return account


def require_manager_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.manager_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager feature is disabled")


def require_ceph_admin_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph admin feature is disabled")


def require_storage_ops_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.storage_ops_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Ops feature is disabled")


def require_browser_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser feature is disabled")


def require_portal_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")


def require_manager_context_enabled() -> None:
    settings = app_settings_service.load_app_settings()
    if not settings.general.manager_enabled and not settings.general.browser_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access is disabled")
