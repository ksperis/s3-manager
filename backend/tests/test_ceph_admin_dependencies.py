# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import StorageProvider
from app.routers.ceph_admin import dependencies as deps
from app.services.rgw_admin import RGWAdminError


def test_validate_ceph_admin_service_identity_handles_rgw_admin_error(monkeypatch):
    endpoint = SimpleNamespace(
        id=1,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        features_config="""
features:
  admin:
    enabled: true
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
        ceph_admin_access_key="AKIA-ADMIN",
        ceph_admin_secret_key="SECRET-ADMIN",
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            raise RGWAdminError("connect timeout")

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    detail = deps.validate_ceph_admin_service_identity(endpoint)

    assert detail is not None
    assert "unable to validate credentials" in detail


def test_validate_ceph_admin_service_identity_allows_admin_user_when_admin_feature_disabled(monkeypatch):
    endpoint = SimpleNamespace(
        id=2,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH,
        features_config="""
features:
  admin:
    enabled: false
""",
        endpoint_url="https://s3.example.test",
        ceph_admin_access_key="AKIA-ADMIN",
        ceph_admin_secret_key="SECRET-ADMIN",
        region="us-east-1",
        verify_tls=True,
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            return {"admin": True}

    monkeypatch.setattr(deps, "get_rgw_admin_client", lambda **kwargs: FakeRGWClient())

    detail = deps.validate_ceph_admin_service_identity(endpoint)

    assert detail is None


class _FakeQuery:
    def __init__(self, endpoint):
        self._endpoint = endpoint

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._endpoint


class _FakeSession:
    def __init__(self, endpoint):
        self._endpoint = endpoint

    def query(self, _model):
        return _FakeQuery(self._endpoint)


def test_resolve_ceph_admin_workspace_endpoint_does_not_require_admin_feature_enabled():
    endpoint = SimpleNamespace(
        id=9,
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
""",
    )

    resolved = deps._resolve_ceph_admin_workspace_endpoint(_FakeSession(endpoint), endpoint_id=9)
    assert resolved is endpoint


def test_get_ceph_admin_context_uses_rgw_admin_endpoint_when_admin_feature_disabled(monkeypatch):
    endpoint = SimpleNamespace(
        id=10,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
        ceph_admin_access_key="AKIA-ADMIN",
        ceph_admin_secret_key="SECRET-ADMIN",
        region="us-east-1",
        verify_tls=True,
    )

    captured: list[str] = []

    class FakeRGWClient:
        def __init__(self, endpoint_url: str):
            self.endpoint = endpoint_url

        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
            return {"admin": True}

    def fake_get_rgw_admin_client(**kwargs):
        captured.append(kwargs["endpoint"])
        return FakeRGWClient(kwargs["endpoint"])

    monkeypatch.setattr(deps, "get_rgw_admin_client", fake_get_rgw_admin_client)

    ctx = deps.get_ceph_admin_context(endpoint_id=10, db=_FakeSession(endpoint), _=SimpleNamespace())

    assert ctx.endpoint is endpoint
    assert ctx.s3_endpoint == "https://s3.example.test"
    assert ctx.rgw_admin.endpoint == "https://rgw-admin.example.test"
    assert captured == ["https://rgw-admin.example.test", "https://rgw-admin.example.test"]


def test_build_ceph_admin_endpoint_payload_exposes_admin_endpoint_when_admin_feature_disabled():
    endpoint = SimpleNamespace(
        id=11,
        name="Ceph endpoint",
        provider=StorageProvider.CEPH.value,
        features_config="""
features:
  admin:
    enabled: false
    endpoint: https://rgw-admin.example.test
""",
        endpoint_url="https://s3.example.test",
        region="us-east-1",
        is_default=False,
    )

    payload = deps.build_ceph_admin_endpoint_payload(endpoint)

    assert payload["admin_endpoint"] == "https://rgw-admin.example.test"
