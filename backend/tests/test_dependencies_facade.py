# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.routers import dependencies
from app.routers.dependencies_internal import (
    account_context,
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


def test_audit_service_dependency_uses_database_session(db_session):
    service = dependencies.get_audit_service(db_session)

    assert service.db is db_session
