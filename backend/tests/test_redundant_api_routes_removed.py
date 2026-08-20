# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/stats/overview"),
        ("post", "/api/admin/users/1/assign-account"),
        ("get", "/api/connections/1/capabilities"),
        ("get", "/api/portal/eligibility"),
    ],
)
def test_redundant_api_routes_return_not_found(client, method: str, path: str) -> None:
    response = getattr(client, method)(path)

    assert response.status_code == 404
