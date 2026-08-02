# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies_internal.account_context import (
    _manager_membership_capabilities,
    get_account_context,
)
from app.routers.dependencies_internal.auth_session import (
    get_current_account_admin,
    get_current_account_user,
    get_current_actor,
    get_current_ceph_admin,
    get_current_storage_ops_admin,
    get_current_super_admin,
    get_current_ui_superadmin,
    get_current_user,
    require_internal_cron_token,
    settings,
)
from app.routers.dependencies_internal.feature_gates import (
    _build_bucket_migration_admin_account_context_ids,
    _build_bucket_migration_allowed_context_ids,
    _ensure_bucket_migration_allowed,
    ensure_manager_tool_allowed,
    get_current_bucket_migration_scope,
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
)
from app.routers.dependencies_internal.portal_access import (
    get_portal_account_access,
    require_portal_browser_basic_route,
    require_portal_manager,
)
from app.routers.dependencies_internal.sse_c import get_optional_sse_customer_context
from app.services.audit_service import AuditService


def get_audit_service(
    db: Session = Depends(get_db),
) -> AuditService:
    return AuditService(db)
