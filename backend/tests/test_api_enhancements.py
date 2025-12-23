# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

import pytest
from fastapi.testclient import TestClient

from app.db_models import S3Account, UserS3Account
from app.services import s3_accounts_service, s3_client


class FakeRGWAdmin:
    def __init__(self):
        self.created_accounts = []
        self.created_root_users = []
        self.quota_calls = []
        self.cap_calls = []

    def create_account(self, account_id: str, account_name: str):
        self.created_accounts.append((account_id, account_name))
        return {"id": account_id, "name": account_name}

    def create_user_with_account_id(self, uid: str, account_id: str, display_name: str, account_root: bool = True):
        self.created_root_users.append((uid, account_id, account_root))
        return {"account_id": account_id, "keys": [{"access_key": "AKIA", "secret_key": "SECRET"}]}

    def _extract_keys(self, data):
        return data.get("keys", [])

    def set_account_quota(self, account_id: str, max_size_gb=None, max_objects=None, quota_scope="account", enabled=True):
        self.quota_calls.append(
            {"account_id": account_id, "max_size_gb": max_size_gb, "max_objects": max_objects, "quota_scope": quota_scope, "enabled": enabled}
        )
        return {"ok": True}

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        self.cap_calls.append({"uid": uid, "cap": cap, "tenant": tenant})
        return {"ok": True}


def test_admin_create_account_with_quota(monkeypatch, client: TestClient, db_session):
    fake_rgw = FakeRGWAdmin()

    def fake_get_s3_accounts_service(db, **kwargs):
        svc = s3_accounts_service.S3AccountsService(db, kwargs.get("rgw_admin_client"))
        svc.rgw_admin = fake_rgw
        return svc

    monkeypatch.setattr("app.routers.admin.s3_accounts.get_s3_accounts_service", fake_get_s3_accounts_service)

    payload = {
        "name": "quota-acc",
        "email": "quota@example.com",
        "quota_max_size_gb": 500,
        "quota_max_objects": 1000000,
    }
    resp = client.post("/api/admin/accounts", json=payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["quota_max_size_gb"] == 500
    assert data["quota_max_objects"] == 1000000
    assert data["root_user_email"].endswith("-admin")

    db_acc = db_session.query(S3Account).filter(S3Account.name == "quota-acc").first()
    assert db_acc is not None
    assert db_acc.quota_max_size_gb == 500
    assert db_acc.quota_max_objects == 1000000
    assert fake_rgw.quota_calls, "Quota should be set via RGW admin"


def test_admin_unlink_account_endpoint(monkeypatch, client: TestClient):
    called = {}

    class FakeService:
        def __init__(self, db):
            self.db = db

        def unlink_account(self, account_id: int):
            called["id"] = account_id

    def fake_get_s3_accounts_service(db, **kwargs):
        return FakeService(db)

    monkeypatch.setattr("app.routers.admin.s3_accounts.get_s3_accounts_service", fake_get_s3_accounts_service)

    resp = client.post("/api/admin/accounts/42/unlink")
    assert resp.status_code == 204
    assert called["id"] == 42


def test_manager_create_bucket_with_versioning(monkeypatch, client: TestClient, db_session):
    # Seed account linked to the account_admin override user id=1000
    acc = S3Account(name="acc-vers", rgw_account_id="RGW00000000000000003", rgw_access_key="AK", rgw_secret_key="SK")
    db_session.add(acc)
    db_session.flush()
    db_session.add(UserS3Account(user_id=1000, account_id=acc.id, is_root=True))
    db_session.commit()

    calls = {"create": [], "versioning": [], "public_block": []}

    def fake_create_bucket(name, access_key=None, secret_key=None):
        calls["create"].append({"name": name, "ak": access_key, "sk": secret_key})

    def fake_set_bucket_versioning(name, enabled=True, access_key=None, secret_key=None):
        calls["versioning"].append({"name": name, "enabled": enabled})

    def fake_set_public_access_block(name, block=True, access_key=None, secret_key=None):
        calls["public_block"].append({"name": name, "block": block})

    monkeypatch.setattr(s3_client, "create_bucket", fake_create_bucket)
    monkeypatch.setattr(s3_client, "set_bucket_versioning", fake_set_bucket_versioning)
    monkeypatch.setattr(s3_client, "set_bucket_public_access_block", fake_set_public_access_block)

    resp = client.post(f"/api/manager/buckets?account_id={acc.id}", json={"name": "my-bucket", "versioning": True})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["versioning"] is True
    assert calls["create"] and calls["versioning"]
    assert calls["public_block"] == []
    assert calls["versioning"][0]["enabled"] is True
    assert calls["public_block"][0]["block"] is True


def test_admin_create_user_requires_email_format(client: TestClient):
    resp = client.post("/api/admin/users", json={"email": "not-an-email", "password": "x"})
    assert resp.status_code == 422
