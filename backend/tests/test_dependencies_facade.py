# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.routers import dependencies
from app.routers.dependencies_internal import (
    account_context,
    audit,
    auth_session,
    ceph_admin_context,
    feature_gates,
    portal_access,
    sse_c,
)


def test_dependencies_facade_reexports_internal_groups():
    assert dependencies.get_current_user is auth_session.get_current_user
    assert dependencies.require_internal_cron_token is auth_session.require_internal_cron_token
    assert dependencies.get_optional_sse_customer_context is sse_c.get_optional_sse_customer_context
    assert dependencies.get_account_context is account_context.get_account_context
    assert dependencies.get_portal_account_access is portal_access.get_portal_account_access
    assert dependencies.require_portal_browser_basic_route is portal_access.require_portal_browser_basic_route
    assert dependencies.ensure_manager_tool_allowed is feature_gates.ensure_manager_tool_allowed
    assert dependencies.require_manager_bucket_quota is feature_gates.require_manager_bucket_quota
    assert dependencies.get_super_admin_rgw_client is ceph_admin_context.get_super_admin_rgw_client
    assert dependencies.get_audit_logger is audit.get_audit_logger
    assert callable(dependencies.EffectiveAccessService)


def test_dependencies_facade_load_app_settings_monkeypatch_remains_compatible(monkeypatch):
    monkeypatch.setattr(
        dependencies,
        "load_app_settings",
        lambda: SimpleNamespace(general=SimpleNamespace(bucket_migration_enabled=False)),
    )
    user = User(
        email="manager@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
        can_access_manager_bucket_migration=True,
    )

    with pytest.raises(HTTPException) as exc:
        dependencies._ensure_bucket_migration_allowed(user)

    assert exc.value.status_code == 403
    assert "feature is disabled" in str(exc.value.detail).lower()
