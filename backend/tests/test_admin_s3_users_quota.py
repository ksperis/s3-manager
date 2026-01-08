# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi.testclient import TestClient

from app.db_models import StorageEndpoint
from app.main import app
from app.routers import dependencies


class FakeRGWAdmin:
    def __init__(self):
        self.created_users: list[str] = []
        self.quota_calls: list[dict] = []
        self.quota_by_uid: dict[str, tuple[Optional[int], Optional[int]]] = {}

    def create_user(
        self,
        uid: str,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        tenant: Optional[str] = None,
        caps: Optional[str] = None,
    ):
        self.created_users.append(uid)
        return {"keys": [{"access_key": "AKIA", "secret_key": "SECRET"}]}

    def create_access_key(
        self,
        uid: str,
        tenant: Optional[str] = None,
        key_name: Optional[str] = None,
        account_id: Optional[str] = None,
    ):
        return {"keys": [{"access_key": "AKIA", "secret_key": "SECRET"}]}

    def _extract_keys(self, data):
        return data.get("keys", [])

    def set_user_quota(
        self,
        uid: str,
        tenant: Optional[str] = None,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "user",
        enabled: bool = True,
    ):
        max_size_value = None
        max_objects_value = None
        if enabled:
            if max_size_bytes is not None:
                max_size_value = int(max_size_bytes)
            elif max_size_gb is not None:
                max_size_value = int(max_size_gb * 1024 ** 3)
            if max_objects is not None:
                max_objects_value = int(max_objects)
        self.quota_by_uid[uid] = (max_size_value, max_objects_value)
        self.quota_calls.append(
            {
                "uid": uid,
                "max_size_bytes": max_size_value,
                "max_size_gb": max_size_gb,
                "max_objects": max_objects,
                "quota_type": quota_type,
                "enabled": enabled,
            }
        )
        return {"ok": True}

    def get_user_quota(self, uid: str, tenant: Optional[str] = None):
        return self.quota_by_uid.get(uid, (None, None))


def _seed_ceph_endpoint(db_session) -> StorageEndpoint:
    existing = db_session.query(StorageEndpoint).filter(StorageEndpoint.name == "ceph-test").first()
    if existing:
        return existing
    endpoint = StorageEndpoint(
        name="ceph-test",
        endpoint_url="http://ceph-test.invalid",
        provider="ceph",
        admin_access_key="AK",
        admin_secret_key="SK",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_admin_create_s3_user_with_quota_unit(monkeypatch, client: TestClient, db_session):
    endpoint = _seed_ceph_endpoint(db_session)
    fake_rgw = FakeRGWAdmin()
    monkeypatch.setattr("app.services.s3_users_service.get_rgw_admin_client", lambda **_: fake_rgw)
    previous = app.dependency_overrides.get(dependencies.get_super_admin_rgw_client)
    app.dependency_overrides[dependencies.get_super_admin_rgw_client] = lambda: fake_rgw
    try:
        payload = {
            "name": "quota-user",
            "email": "quota-user@example.com",
            "storage_endpoint_id": endpoint.id,
            "quota_max_size_gb": 1,
            "quota_max_size_unit": "TiB",
            "quota_max_objects": 1000,
        }
        resp = client.post("/api/admin/s3-users", json=payload)
    finally:
        if previous is not None:
            app.dependency_overrides[dependencies.get_super_admin_rgw_client] = previous
        else:
            app.dependency_overrides.pop(dependencies.get_super_admin_rgw_client, None)

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["quota_max_size_gb"] == 1024
    assert data["quota_max_objects"] == 1000
    assert fake_rgw.quota_calls == [
        {
            "uid": data["rgw_user_uid"],
            "max_size_bytes": 1024 ** 4,
            "max_size_gb": None,
            "max_objects": 1000,
            "quota_type": "user",
            "enabled": True,
        }
    ]


def test_admin_update_s3_user_quota(monkeypatch, client: TestClient, db_session):
    endpoint = _seed_ceph_endpoint(db_session)
    fake_rgw = FakeRGWAdmin()
    monkeypatch.setattr("app.services.s3_users_service.get_rgw_admin_client", lambda **_: fake_rgw)
    previous = app.dependency_overrides.get(dependencies.get_super_admin_rgw_client)
    app.dependency_overrides[dependencies.get_super_admin_rgw_client] = lambda: fake_rgw
    try:
        create = client.post(
            "/api/admin/s3-users",
            json={"name": "quota-update", "storage_endpoint_id": endpoint.id},
        )
        assert create.status_code == 201, create.text
        created = create.json()

        resp = client.put(
            f"/api/admin/s3-users/{created['id']}",
            json={"quota_max_size_gb": 50, "quota_max_size_unit": "GiB", "quota_max_objects": 500},
        )
    finally:
        if previous is not None:
            app.dependency_overrides[dependencies.get_super_admin_rgw_client] = previous
        else:
            app.dependency_overrides.pop(dependencies.get_super_admin_rgw_client, None)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["quota_max_size_gb"] == 50
    assert data["quota_max_objects"] == 500
