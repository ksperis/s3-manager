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
