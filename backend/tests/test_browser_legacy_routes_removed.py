# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest


def test_manager_browser_router_removed(client):
    response = client.get("/api/manager/browser/settings")
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "expected_status"),
    [
        ("post", "/api/browser/buckets/demo/objects/delete", 404),
        ("post", "/api/browser/buckets/demo/objects/copy", 404),
        ("post", "/api/browser/buckets/demo/folder", 404),
        ("post", "/api/browser/buckets/demo/upload/proxy", 404),
        ("get", "/api/browser/buckets/demo/proxy-download?key=test.txt", 404),
        # The following legacy paths now collide with canonical dynamic routes and return 405.
        ("post", "/api/browser/buckets/demo/multipart/init", 405),
        ("get", "/api/browser/buckets/demo/multipart/uploads", 405),
        ("get", "/api/browser/buckets/demo/multipart/parts?key=test.txt&upload_id=up-1", 405),
        ("post", "/api/browser/buckets/demo/multipart/presign", 405),
        ("post", "/api/browser/buckets/demo/multipart/complete", 405),
        ("post", "/api/browser/buckets/demo/cleanup", 404),
    ],
)
def test_browser_legacy_alias_routes_removed(client, method, path, expected_status):
    caller = getattr(client, method)
    kwargs = {"json": {}} if method == "post" else {}
    response = caller(path, **kwargs)
    assert response.status_code == expected_status
