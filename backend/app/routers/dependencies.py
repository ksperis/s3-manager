# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.database import get_db
from app.routers.dependencies_internal.account_context import (
    _build_s3_connection_account,
    _build_s3_user_account,
    _connection_iam_capable,
    _manager_membership_capabilities,
    _membership_capabilities,
    _parse_account_selector,
    _resolve_account_by_id,
    _resolve_connection_context,
    _resolve_default_account_id,
    _resolve_requested_session_endpoint,
    _resolve_s3_user_context,
    _resolve_session_account,
    _resolve_user_account_link,
    _resolve_workspace_surface,
    get_account_access,
    get_account_context,
)
from app.routers.dependencies_internal.audit import get_audit_logger
from app.routers.dependencies_internal.auth_session import (
    _resolve_actor,
    get_current_account_admin,
    get_current_account_user,
    get_current_actor,
    get_current_ceph_admin,
    get_current_storage_ops_admin,
    get_current_super_admin,
    get_current_ui_superadmin,
    get_current_user,
    oauth2_scheme,
    require_internal_cron_token,
    settings,
)
from app.routers.dependencies_internal.ceph_admin_context import (
    _build_ceph_admin_browser_account,
    _resolve_admin_rgw_context,
    _resolve_ceph_admin_browser_context,
    _resolve_default_endpoint,
    get_super_admin_rgw_client,
)
from app.routers.dependencies_internal.feature_gates import (
    ManagerToolKey,
    _build_bucket_migration_admin_account_context_ids,
    _build_bucket_migration_allowed_context_ids,
    _ensure_bucket_migration_allowed,
    _ensure_manager_capabilities,
    _is_ceph_endpoint_admin_available,
    _manager_link_allows_bucket_migration,
    _manager_tool_global_state,
    _require_supervision_access,
    _s3_user_flag_enabled,
    _target_allows_manager_bucket_quota,
    ensure_manager_tool_allowed,
    get_current_bucket_migration_scope,
    get_current_bucket_migration_user,
    is_manager_bucket_quota_available,
    is_manager_ceph_s3_user_keys_available,
    require_browser_enabled,
    require_bucket_compare_enabled,
    require_bucket_integrity_check_enabled,
    require_bucket_purge_enabled,
    require_bucket_purge_global_enabled,
    require_bucket_usage_stats_enabled,
    require_ceph_admin_enabled,
    require_iam_capable_manager,
    require_manager_bucket_quota,
    require_manager_ceph_s3_user_keys,
    require_manager_context_enabled,
    require_manager_enabled,
    require_manager_feature_rules_enabled,
    require_metrics_capable_manager,
    require_portal_enabled,
    require_sns_capable_manager,
    require_storage_ops_bucket_quota,
    require_storage_ops_enabled,
    require_usage_capable_manager,
    user_has_manager_tool_access,
)
from app.routers.dependencies_internal.portal_access import (
    _is_portal_browser_basic_route_allowed,
    _is_portal_browser_request,
    _portal_browser_relative_segments,
    _portal_browser_target_bucket,
    _portal_membership_capabilities,
    _resolve_portal_browser_context,
    _validate_portal_account_surface,
    get_portal_account_access,
    require_portal_browser_basic_route,
    require_portal_buckets,
    require_portal_manager,
)
from app.routers.dependencies_internal.settings_loader import load_app_settings
from app.routers.dependencies_internal.service_loaders import EffectiveAccessService
from app.routers.dependencies_internal.sse_c import get_optional_sse_customer_context
from app.routers.dependencies_internal.types import (
    AccountAccess,
    AccountCapabilities,
    BucketMigrationAccessScope,
    ManagerActor,
)
