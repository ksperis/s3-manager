# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.main import app
from app.routers import browser as browser_router
from app.routers import dependencies


def _account() -> S3Account:
    account = S3Account(name="cors-test-account")
    account.id = 7
    return account


class _AuditLogger:
    def record_action(self, **_kwargs):  # noqa: ANN003
        return None


def test_browser_ensure_cors_uses_request_origin_when_payload_origin_missing(client):
    captured: dict[str, object] = {}

    class FakeService:
        def ensure_bucket_cors(self, bucket_name, account, origin):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["account_id"] = account.id
            captured["origin"] = origin
            return {"enabled": True, "rules": []}

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()
    app.dependency_overrides[dependencies.get_audit_logger] = lambda: _AuditLogger()

    response = client.post(
        "/api/browser/buckets/my-bucket/cors/ensure",
        json={},
        headers={"Origin": "https://ui.example.test"},
    )

    assert response.status_code == 200
    assert captured == {
        "bucket_name": "my-bucket",
        "account_id": 7,
        "origin": "https://ui.example.test",
    }


def test_browser_ensure_cors_requires_origin_if_unavailable_in_request(client):
    class FakeService:
        def ensure_bucket_cors(self, bucket_name, account, origin):  # noqa: ANN001
            raise AssertionError("ensure_bucket_cors should not be called without an origin")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()
    app.dependency_overrides[dependencies.get_audit_logger] = lambda: _AuditLogger()

    response = client.post("/api/browser/buckets/my-bucket/cors/ensure", json={})
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing origin"
