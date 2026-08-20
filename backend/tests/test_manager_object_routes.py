# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.routers.manager import objects as manager_objects
from tests.router_test_utils import effective_routes


def test_manager_object_router_only_exposes_listing() -> None:
    routes = {(route.path, route.methods) for route in effective_routes(manager_objects.router)}

    assert routes == {
        (
            "/manager/buckets/{bucket_name}/objects",
            frozenset({"GET"}),
        )
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/manager/buckets/demo/objects/upload"),
        ("post", "/api/manager/buckets/demo/objects/folders"),
        ("post", "/api/manager/buckets/demo/objects/delete"),
        ("get", "/api/manager/buckets/demo/objects/download?key=test.txt"),
    ],
)
def test_removed_manager_object_data_plane_routes_return_not_found(client, method: str, path: str) -> None:
    response = getattr(client, method)(path)

    assert response.status_code == 404
