# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import StorageEndpoint, StorageProvider
from app.services.rgw_admin import RGWAdminError
from app.services.storage_endpoints_service import StorageEndpointsService


def _create_ceph_endpoint(db_session, name: str = "ceph-main") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_list_endpoints_exposes_admin_ops_permissions_from_caps(db_session, monkeypatch):
    _create_ceph_endpoint(db_session)

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert access_key == "AKIA-ADMIN"
            return {
                "caps": [
                    {"type": "users", "perm": "read,write"},
                    {"type": "accounts", "perm": "read,write"},
                ]
            }

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FakeRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints()
    target = next((endpoint for endpoint in endpoints if endpoint.name == "ceph-main"), None)
    assert target is not None
    perms = target.admin_ops_permissions
    assert perms.users_read is True
    assert perms.users_write is True
    assert perms.accounts_read is True
    assert perms.accounts_write is True


def test_list_endpoints_falls_back_to_no_admin_ops_permissions_on_rgw_error(db_session, monkeypatch):
    _create_ceph_endpoint(db_session, name="ceph-failsafe")

    class FailingRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            raise RGWAdminError("boom")

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FailingRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints()
    target = next((endpoint for endpoint in endpoints if endpoint.name == "ceph-failsafe"), None)
    assert target is not None
    perms = target.admin_ops_permissions
    assert perms.users_read is False
    assert perms.users_write is False
    assert perms.accounts_read is False
    assert perms.accounts_write is False
