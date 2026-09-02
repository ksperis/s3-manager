# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import PortalAccountRole, S3Account, User, UserRole
from app.main import app
from app.models.portal_access_logs import PortalServerAccessLogPage
from app.routers import dependencies
from app.routers import portal as portal_router
from app.routers.portal_common import get_portal_service_dependency
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from tests.s3_account_factory import make_s3_account
from tests.router_test_utils import effective_routes


def _portal_access(account: S3Account, user: User, role: str) -> AccountAccess:
    is_manager = role == PortalAccountRole.PORTAL_MANAGER.value
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        portal_role=role,
        capabilities=AccountCapabilities(
            can_manage_buckets=is_manager,
            can_manage_portal_users=is_manager,
        ),
    )


@pytest.mark.parametrize(
    "url",
    [
        "/api/portal/access-logs?date=2026-07-08",
        "/api/portal/access-logs/page?date=2026-07-08",
        "/api/portal/access-logs/raw?date_from=2026-07-08&date_to=2026-07-08",
    ],
)
def test_portal_server_access_log_routes_require_manager(
    url: str,
    client: TestClient,
    db_session,
):
    account = make_s3_account(db_session, name="portal-log-routes", rgw_account_id="rgw-log-routes")
    user = User(
        email="portal-log-routes@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, user])
    db_session.commit()

    class _Service:
        def list_portal_server_access_logs(self, *_args, **_kwargs):
            return []

        def list_portal_server_access_log_page(self, *_args, **kwargs):
            return PortalServerAccessLogPage(
                entries=[],
                total=0,
                limit=kwargs["limit"],
                offset=kwargs["offset"],
            )

        def get_portal_server_access_logs_raw(self, *_args, **_kwargs):
            return ""

    app.dependency_overrides[get_portal_service_dependency] = _Service
    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: _portal_access(
        account,
        user,
        PortalAccountRole.PORTAL_USER.value,
    )

    denied = client.get(url)

    assert denied.status_code == 403
    assert denied.json()["detail"] == "Manager rights required for this account"

    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: _portal_access(
        account,
        user,
        PortalAccountRole.PORTAL_MANAGER.value,
    )

    allowed = client.get(url)

    assert allowed.status_code == 200


def test_portal_server_access_log_routes_are_owned_by_dedicated_router() -> None:
    expected_paths = {
        "/portal/access-logs",
        "/portal/access-logs/page",
        "/portal/access-logs/raw",
    }
    route_modules = {
        route.path: route.endpoint.__module__
        for route in effective_routes(portal_router.router)
        if route.path in expected_paths
    }

    assert set(route_modules) == expected_paths
    assert set(route_modules.values()) == {"app.routers.portal_access_logs"}


@pytest.mark.parametrize(
    "url",
    [
        "/api/portal/transfers",
        "/api/portal/transfers/server-access-logs?date=2026-07-08",
        "/api/portal/transfers/server-access-logs/page?date=2026-07-08",
        "/api/portal/transfers/server-access-logs/raw?date_from=2026-07-08&date_to=2026-07-08",
    ],
)
def test_removed_portal_transfer_routes_return_not_found(url: str, client: TestClient) -> None:
    response = client.get(url)

    assert response.status_code == 404
