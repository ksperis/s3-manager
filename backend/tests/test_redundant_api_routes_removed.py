# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.main import app


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/stats/overview"),
        ("post", "/api/admin/users/1/assign-account"),
        ("get", "/api/connections/1/capabilities"),
        ("get", "/api/portal/eligibility"),
        ("get", "/api/auth/admin/sessions"),
        ("get", "/api/auth/external-link-requests"),
    ],
)
def test_redundant_api_routes_return_not_found(client, method: str, path: str) -> None:
    response = getattr(client, method)(path)

    assert response.status_code == 404


def test_identity_security_openapi_exposes_canonical_admin_routes() -> None:
    paths = app.openapi()["paths"]

    assert "/api/admin/identity/link-requests" in paths
    assert "/api/admin/identity/sessions" in paths
    assert "/api/admin/users/{user_id}/security" in paths
    assert "/api/admin/users/{user_id}/mfa/reset" in paths
    assert "/api/admin/users/{user_id}/external-identities" in paths
