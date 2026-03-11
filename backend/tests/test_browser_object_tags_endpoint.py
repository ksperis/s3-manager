# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account
from app.main import app
from app.models.browser import ObjectTag, ObjectTags
from app.routers import browser as browser_router
from app.routers import dependencies


def _account() -> S3Account:
    account = S3Account(name="tags-test")
    account.id = 77
    return account


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        return None


def test_browser_put_object_tags_passes_key_tags_and_version_id(client):
    captured: dict[str, object] = {}

    class FakeService:
        def put_object_tags(self, bucket_name, account, key, tags, version_id=None):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["account_id"] = account.id
            captured["key"] = key
            captured["tags"] = tags
            captured["version_id"] = version_id
            return ObjectTags(key=key, tags=tags, version_id=version_id)

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()
    app.dependency_overrides[browser_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.put(
        "/api/browser/buckets/my-bucket/object-tags?account_id=s3u-1",
        json={
            "key": "folder/demo.txt",
            "version_id": "v1",
            "tags": [{"key": "env", "value": "dev"}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "key": "folder/demo.txt",
        "version_id": "v1",
        "tags": [{"key": "env", "value": "dev"}],
    }
    assert captured["bucket_name"] == "my-bucket"
    assert captured["account_id"] == 77
    assert captured["key"] == "folder/demo.txt"
    assert captured["version_id"] == "v1"
    assert [tag.model_dump() for tag in captured["tags"]] == [ObjectTag(key="env", value="dev").model_dump()]


def test_browser_put_object_tags_rejects_missing_key(client):
    class FakeService:
        def put_object_tags(self, bucket_name, account, key, tags, version_id=None):  # noqa: ANN001
            raise AssertionError("put_object_tags should not be called when key is empty")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()
    app.dependency_overrides[browser_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.put(
        "/api/browser/buckets/my-bucket/object-tags?account_id=s3u-1",
        json={"key": "", "tags": [{"key": "env", "value": "dev"}]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing key"


def test_browser_put_object_tags_maps_runtime_error_to_bad_gateway(client):
    class FakeService:
        def put_object_tags(self, bucket_name, account, key, tags, version_id=None):  # noqa: ANN001
            raise RuntimeError("S3 put_object_tagging failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()
    app.dependency_overrides[browser_router.get_audit_logger] = lambda: _FakeAuditService()

    response = client.put(
        "/api/browser/buckets/my-bucket/object-tags?account_id=s3u-1",
        json={"key": "folder/demo.txt", "tags": [{"key": "env", "value": "dev"}]},
    )

    assert response.status_code == 502
    assert "S3 put_object_tagging failed" in response.json()["detail"]
