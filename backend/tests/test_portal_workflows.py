# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db_models import (
    AuditLog,
    PortalMembership,
    PortalPermission,
    PortalRole,
    PortalRoleKey,
    PortalRolePermission,
    S3Account,
    S3AccountKind,
    StorageEndpoint,
    User,
    UserRole,
)
from app.main import app
from app.models.browser import BrowserStsCredentials
from app.models.iam import AccessKey, IAMUser
from app.routers import dependencies
from app.services import portal_bucket_provisioning_service, portal_browser_service, portal_external_access_service


def _seed_portal_rbac(db_session) -> None:
    permissions = [
        "portal.dashboard.view",
        "portal.buckets.view",
        "portal.browser.view",
        "portal.objects.list",
        "portal.objects.get",
        "portal.objects.put",
        "portal.objects.delete",
        "portal.external.self.manage",
        "portal.external.team.manage",
        "portal.members.view",
        "portal.members.manage",
        "portal.audit.view",
        "portal.admin.view",
        "portal.bucket.create",
    ]
    role_perms: dict[str, list[str]] = {
        PortalRoleKey.VIEWER.value: [
            "portal.dashboard.view",
            "portal.buckets.view",
            "portal.browser.view",
            "portal.objects.list",
            "portal.objects.get",
        ],
        PortalRoleKey.ACCESS_ADMIN.value: [
            "portal.dashboard.view",
            "portal.buckets.view",
            "portal.browser.view",
            "portal.objects.list",
            "portal.objects.get",
            "portal.objects.put",
            "portal.objects.delete",
            "portal.external.self.manage",
            "portal.external.team.manage",
            "portal.members.view",
            "portal.audit.view",
        ],
        PortalRoleKey.ACCOUNT_ADMIN.value: [
            "portal.dashboard.view",
            "portal.buckets.view",
            "portal.browser.view",
            "portal.objects.list",
            "portal.objects.get",
            "portal.objects.put",
            "portal.objects.delete",
            "portal.external.self.manage",
            "portal.external.team.manage",
            "portal.members.view",
            "portal.audit.view",
            "portal.members.manage",
            "portal.admin.view",
            "portal.bucket.create",
        ],
    }

    existing_perm_keys = {p.key for p in db_session.query(PortalPermission).all()}
    for key in permissions:
        if key in existing_perm_keys:
            continue
        db_session.add(PortalPermission(key=key, description=key))

    existing_role_keys = {r.key for r in db_session.query(PortalRole).all()}
    for role_key in role_perms.keys():
        if role_key in existing_role_keys:
            continue
        db_session.add(PortalRole(key=role_key, description=role_key))

    db_session.commit()

    roles_by_key = {r.key: r for r in db_session.query(PortalRole).all()}
    perms_by_key = {p.key: p for p in db_session.query(PortalPermission).all()}

    for role_key, perm_keys in role_perms.items():
        role = roles_by_key[role_key]
        existing_links = {
            link.permission_id
            for link in db_session.query(PortalRolePermission).filter(PortalRolePermission.role_id == role.id).all()
        }
        for perm_key in perm_keys:
            perm = perms_by_key[perm_key]
            if perm.id in existing_links:
                continue
            db_session.add(PortalRolePermission(role_id=role.id, permission_id=perm.id))
    db_session.commit()


def _make_endpoint(db_session, **kwargs) -> StorageEndpoint:
    name = kwargs.get("name") or f"ep-{uuid.uuid4().hex[:8]}"
    endpoint_url = kwargs.get("endpoint_url") or f"http://rgw.{uuid.uuid4().hex[:8]}.example.com"
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=endpoint_url,
        provider=kwargs.get("provider") or "ceph",
        features_config=kwargs.get("features_config"),
        allow_external_access=bool(kwargs.get("allow_external_access", False)),
        allowed_packages=kwargs.get("allowed_packages"),
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _make_account(db_session, endpoint: StorageEndpoint, *, kind: str = S3AccountKind.IAM_ACCOUNT.value) -> S3Account:
    rgw_account_id = f"RGW{int(uuid.uuid4().int % 10**17):017d}"
    account = S3Account(
        name=f"acct-{uuid.uuid4().hex[:8]}",
        kind=kind,
        rgw_account_id=rgw_account_id,
        rgw_access_key="root-access",
        rgw_secret_key="root-secret",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


@contextmanager
def _override_dependency(dep, value):
    previous = app.dependency_overrides.get(dep)
    app.dependency_overrides[dep] = lambda: value
    try:
        yield
    finally:
        if previous is not None:
            app.dependency_overrides[dep] = previous
        else:
            app.dependency_overrides.pop(dep, None)


def test_portal_context_enforces_account_membership(client: TestClient, db_session):
    _seed_portal_rbac(db_session)
    endpoint = _make_endpoint(db_session)
    account1 = _make_account(db_session, endpoint)
    account2 = _make_account(db_session, endpoint)

    user = User(email=f"u-{uuid.uuid4().hex[:6]}@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    db_session.add(PortalMembership(user_id=user.id, account_id=account1.id, role_key=PortalRoleKey.VIEWER.value))
    db_session.commit()

    with _override_dependency(dependencies.get_current_account_user, user):
        resp = client.get("/api/portal/context", params={"account_id": account2.id})
    assert resp.status_code == 403, resp.text


def test_access_admin_guardrails_reject_disallowed_package(client: TestClient, db_session):
    _seed_portal_rbac(db_session)
    endpoint = _make_endpoint(db_session, allow_external_access=True, allowed_packages=["BucketReadOnly"])
    account = _make_account(db_session, endpoint)

    actor = User(email=f"aa-{uuid.uuid4().hex[:6]}@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    db_session.add(PortalMembership(user_id=actor.id, account_id=account.id, role_key=PortalRoleKey.ACCESS_ADMIN.value))
    db_session.commit()

    payload = {"user_id": 123, "package_key": "BucketAdmin", "bucket": "example-bucket"}
    with _override_dependency(dependencies.get_current_account_user, actor):
        resp = client.post("/api/portal/access/grants", params={"account_id": account.id}, json=payload)
    assert resp.status_code == 400, resp.text
    assert "not allowed" in resp.json().get("detail", "").lower()


def test_viewer_cannot_enable_external_access(client: TestClient, db_session):
    _seed_portal_rbac(db_session)
    endpoint = _make_endpoint(db_session, allow_external_access=True)
    account = _make_account(db_session, endpoint)

    actor = User(email=f"vw-{uuid.uuid4().hex[:6]}@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    db_session.add(PortalMembership(user_id=actor.id, account_id=account.id, role_key=PortalRoleKey.VIEWER.value))
    db_session.commit()

    with _override_dependency(dependencies.get_current_account_user, actor):
        resp = client.post("/api/portal/access/me/enable", params={"account_id": account.id})
    assert resp.status_code == 403, resp.text


def test_external_access_enable_rotate_revoke_no_secret_storage(client: TestClient, db_session, monkeypatch):
    _seed_portal_rbac(db_session)
    endpoint = _make_endpoint(db_session, allow_external_access=True)
    account = _make_account(db_session, endpoint)

    actor = User(email=f"ext-{uuid.uuid4().hex[:6]}@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    db_session.add(PortalMembership(user_id=actor.id, account_id=account.id, role_key=PortalRoleKey.ACCESS_ADMIN.value))
    db_session.commit()

    class FakeIAM:
        def __init__(self):
            self.keys: dict[str, list[AccessKey]] = {}

        def create_user(self, name: str, create_key: bool = False, allow_existing: bool = False):
            return IAMUser(name=name, user_id=f"id-{name}", arn=f"arn:aws:iam::rgw:user/{name}"), None

        def list_access_keys(self, user_name: str):
            return list(self.keys.get(user_name, []))

        def create_access_key(self, user_name: str):
            idx = len(self.keys.get(user_name, [])) + 1
            key = AccessKey(
                access_key_id=f"AKIA-{idx}",
                status="Active",
                created_at=datetime.now(tz=timezone.utc).isoformat(),
                secret_access_key=f"TESTSECRET-{idx}",
            )
            self.keys.setdefault(user_name, []).append(key)
            return key

        def delete_access_key(self, user_name: str, access_key_id: str):
            self.keys[user_name] = [k for k in self.keys.get(user_name, []) if k.access_key_id != access_key_id]

    fake_iam = FakeIAM()
    monkeypatch.setattr(
        portal_external_access_service.PortalExternalAccessService,
        "_iam",
        lambda self, account: fake_iam,
    )

    with _override_dependency(dependencies.get_current_account_user, actor):
        enable = client.post("/api/portal/access/me/enable", params={"account_id": account.id})
        assert enable.status_code == 201, enable.text
        created = enable.json()
        assert created["secret_access_key"].startswith("TESTSECRET-")

        rotate = client.post("/api/portal/access/me/rotate", params={"account_id": account.id})
        assert rotate.status_code == 200, rotate.text
        rotated = rotate.json()
        assert rotated["access_key_id"] != created["access_key_id"]
        assert rotated["secret_access_key"].startswith("TESTSECRET-")

        revoke = client.post("/api/portal/access/me/revoke", params={"account_id": account.id})
        assert revoke.status_code == 204, revoke.text

    audit_rows = db_session.query(AuditLog).filter(AuditLog.scope == "portal").order_by(AuditLog.id.asc()).all()
    assert any(row.workflow == "external_access.enable" for row in audit_rows)
    assert all("TESTSECRET" not in (row.delta_json or "") for row in audit_rows)


def test_portal_browser_service_prefers_sts_credentials(monkeypatch, db_session):
    portal_browser_service._STS_CACHE.clear()
    service = portal_browser_service.PortalBrowserService(db_session)

    account = S3Account(id=1, rgw_access_key="root", rgw_secret_key="secret")
    account._session_endpoint = "http://example.com"
    ctx = type(
        "Ctx",
        (),
        {
            "account": account,
            "actor": User(id=1, email="x@example.com", hashed_password="x", role=UserRole.UI_USER.value),
            "endpoint_capabilities": type("Caps", (), {"sts_enabled": True})(),
        },
    )()

    def fake_get_sts_credentials(*args, **kwargs):
        return BrowserStsCredentials(
            access_key_id="sts-access",
            secret_access_key="sts-secret",
            session_token="sts-token",
            expiration=datetime.now(tz=timezone.utc) + timedelta(hours=1),
            endpoint="http://example.com",
            region="us-east-1",
        )

    monkeypatch.setattr(service, "get_sts_credentials", fake_get_sts_credentials)

    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        return object()

    monkeypatch.setattr(portal_browser_service, "get_s3_client", fake_get_s3_client)
    service._client(ctx)

    assert captured["access_key"] == "sts-access"
    assert captured["secret_key"] == "sts-secret"
    assert captured["session_token"] == "sts-token"


def test_portal_browser_service_falls_back_on_sts_error(monkeypatch, db_session):
    portal_browser_service._STS_CACHE.clear()
    service = portal_browser_service.PortalBrowserService(db_session)

    account = S3Account(id=1, rgw_access_key="root-access", rgw_secret_key="root-secret")
    account._session_endpoint = "http://example.com"
    ctx = type(
        "Ctx",
        (),
        {
            "account": account,
            "actor": User(id=1, email="x@example.com", hashed_password="x", role=UserRole.UI_USER.value),
            "endpoint_capabilities": type("Caps", (), {"sts_enabled": True})(),
        },
    )()

    def fake_get_sts_credentials(*args, **kwargs):
        raise RuntimeError("STS unavailable")

    monkeypatch.setattr(service, "get_sts_credentials", fake_get_sts_credentials)

    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        return object()

    monkeypatch.setattr(portal_browser_service, "get_s3_client", fake_get_s3_client)
    service._client(ctx)

    assert captured["access_key"] == "root-access"
    assert captured["secret_key"] == "root-secret"
    assert captured["session_token"] is None


def test_portal_browser_service_uses_root_when_sts_disabled(monkeypatch, db_session):
    service = portal_browser_service.PortalBrowserService(db_session)

    account = S3Account(id=1, rgw_access_key="root-access", rgw_secret_key="root-secret")
    account._session_endpoint = "http://example.com"
    ctx = type(
        "Ctx",
        (),
        {
            "account": account,
            "actor": User(id=1, email="x@example.com", hashed_password="x", role=UserRole.UI_USER.value),
            "endpoint_capabilities": type("Caps", (), {"sts_enabled": False})(),
        },
    )()

    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        return object()

    monkeypatch.setattr(portal_browser_service, "get_s3_client", fake_get_s3_client)
    service._client(ctx)

    assert captured["access_key"] == "root-access"
    assert captured["secret_key"] == "root-secret"
    assert captured["session_token"] is None


def test_portal_bucket_provisioning_creates_bucket_with_tags(client: TestClient, db_session, monkeypatch):
    _seed_portal_rbac(db_session)
    endpoint = _make_endpoint(db_session)
    account = _make_account(db_session, endpoint)
    actor = User(email=f"adm-{uuid.uuid4().hex[:6]}@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    db_session.add(PortalMembership(user_id=actor.id, account_id=account.id, role_key=PortalRoleKey.ACCOUNT_ADMIN.value))
    db_session.commit()

    class FakeIAM:
        def __init__(self):
            self.inline_policies: list[tuple[str, str]] = []
            self.keys: dict[str, list[AccessKey]] = {}

        def create_user(self, name: str, create_key: bool = False, allow_existing: bool = False):
            return IAMUser(name=name, user_id=f"id-{name}", arn=f"arn:aws:iam::rgw:user/{name}"), None

        def put_user_inline_policy(self, user_name: str, policy_name: str, policy_document):
            self.inline_policies.append((user_name, policy_name))

        def list_access_keys(self, user_name: str):
            return list(self.keys.get(user_name, []))

        def create_access_key(self, user_name: str):
            key = AccessKey(
                access_key_id="BP-AK",
                status="Active",
                created_at=datetime.now(tz=timezone.utc).isoformat(),
                secret_access_key="BP-SK",
            )
            self.keys.setdefault(user_name, []).append(key)
            return key

        def delete_access_key(self, user_name: str, access_key_id: str):
            self.keys[user_name] = [k for k in self.keys.get(user_name, []) if k.access_key_id != access_key_id]

    fake_iam = FakeIAM()
    monkeypatch.setattr(
        portal_bucket_provisioning_service.PortalBucketProvisioningService,
        "_iam",
        lambda self, account: fake_iam,
    )

    captured: dict[str, object] = {}

    def fake_create_bucket(bucket_name: str, access_key=None, secret_key=None, session_token=None, endpoint=None):
        captured["create_bucket"] = {"bucket": bucket_name, "access_key": access_key, "secret_key": secret_key}

    def fake_put_bucket_tags(bucket_name: str, tags: list[dict], access_key=None, secret_key=None, endpoint=None):
        captured["put_bucket_tags"] = {"bucket": bucket_name, "tags": tags, "access_key": access_key}

    monkeypatch.setattr(portal_bucket_provisioning_service.s3_client, "create_bucket", fake_create_bucket)
    monkeypatch.setattr(portal_bucket_provisioning_service.s3_client, "put_bucket_tags", fake_put_bucket_tags)
    monkeypatch.setattr(portal_bucket_provisioning_service.s3_client, "set_bucket_versioning", lambda *args, **kwargs: None)

    payload = {"name": f"ptl-e2e-{uuid.uuid4().hex[:8]}", "versioning": True}
    with _override_dependency(dependencies.get_current_account_user, actor):
        resp = client.post("/api/portal/buckets", params={"account_id": account.id}, json=payload)
    assert resp.status_code == 201, resp.text

    create_call = captured.get("create_bucket") or {}
    assert create_call.get("access_key") == "BP-AK"
    tags_call = captured.get("put_bucket_tags") or {}
    tag_list = tags_call.get("tags") or []
    tag_map = {t.get("key"): t.get("value") for t in tag_list if isinstance(t, dict)}
    assert tag_map.get("managed-by") == "portal"
    assert tag_map.get("portal-scope") == "bucket"
    assert tag_map.get("workflow") == "bucket.create"
    assert str(account.id) == tag_map.get("portal-account")

    audit = db_session.query(AuditLog).filter(AuditLog.workflow == "bucket.create").order_by(AuditLog.id.desc()).first()
    assert audit is not None
    assert audit.executor_type == "bucket_provisioner"
    assert audit.executor_principal and "bucket-provisioner" in audit.executor_principal
    delta = json.loads(audit.delta_json or "{}")
    assert delta.get("bucket") == payload["name"]
