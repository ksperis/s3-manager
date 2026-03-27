# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import StorageEndpoint, StorageProvider, User, UserRole
from app.main import app
from app.routers import dependencies
from fastapi.testclient import TestClient


def _admin_user() -> User:
    return User(
        id=2001,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _superadmin_user() -> User:
    return User(
        id=2002,
        email="superadmin@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def test_admin_has_read_only_access_to_storage_endpoints(client: TestClient):
    app.dependency_overrides[dependencies.get_current_super_admin] = _admin_user
    app.dependency_overrides[dependencies.get_current_user] = _admin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    list_resp = client.get("/api/admin/storage-endpoints")
    assert list_resp.status_code == 200, list_resp.text

    create_resp = client.post(
        "/api/admin/storage-endpoints",
        json={
            "name": "Endpoint A",
            "endpoint_url": "https://s3.example.test",
            "provider": "ceph",
            "features_config": "features:\n  admin:\n    enabled: false\n",
        },
    )
    assert create_resp.status_code == 403, create_resp.text


def test_admin_cannot_access_admin_settings(client: TestClient):
    app.dependency_overrides[dependencies.get_current_user] = _admin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    resp = client.get("/api/admin/settings")
    assert resp.status_code == 403, resp.text


def test_superadmin_can_access_admin_settings(client: TestClient):
    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)
    resp = client.get("/api/admin/settings")
    assert resp.status_code == 200, resp.text


def test_admin_cannot_update_storage_endpoint_tags(client: TestClient, db_session):
    endpoint = StorageEndpoint(
        name="endpoint-tags-admin-denied",
        endpoint_url="https://endpoint-tags-admin-denied.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    app.dependency_overrides[dependencies.get_current_user] = _admin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    resp = client.put(f"/api/admin/storage-endpoints/{endpoint.id}/tags", json={"tags": ["prod"]})

    assert resp.status_code == 403, resp.text


def test_superadmin_can_update_storage_endpoint_tags(client: TestClient, db_session):
    endpoint = StorageEndpoint(
        name="endpoint-tags-superadmin",
        endpoint_url="https://endpoint-tags-superadmin.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    app.dependency_overrides[dependencies.get_current_user] = _superadmin_user
    app.dependency_overrides.pop(dependencies.get_current_ui_superadmin, None)

    resp = client.put(f"/api/admin/storage-endpoints/{endpoint.id}/tags", json={"tags": ["prod", "rgw-a"]})

    assert resp.status_code == 200, resp.text
    assert [tag["label"] for tag in resp.json()["tags"]] == ["prod", "rgw-a"]
    assert [tag["color_key"] for tag in resp.json()["tags"]] == ["neutral", "neutral"]
