# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import StorageEndpoint, StorageProvider
from app.models.storage_endpoint import StorageEndpointUpdate
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


def _create_ceph_endpoint_with_full_credentials(db_session, name: str = "ceph-full-creds") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        supervision_access_key="AKIA-SUPERVISION",
        supervision_secret_key="SECRET-SUPERVISION",
        ceph_admin_access_key="AKIA-CEPH-ADMIN",
        ceph_admin_secret_key="SECRET-CEPH-ADMIN",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  usage:\n"
            "    enabled: true\n"
            "  metrics:\n"
            "    enabled: true\n"
        ),
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_list_endpoints_skips_admin_ops_permissions_by_default(db_session, monkeypatch):
    _create_ceph_endpoint(db_session)
    calls = {"count": 0}

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            calls["count"] += 1
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
    assert calls["count"] == 0
    perms = target.admin_ops_permissions
    assert perms.users_read is False
    assert perms.users_write is False
    assert perms.accounts_read is False
    assert perms.accounts_write is False


def test_get_endpoint_exposes_admin_ops_permissions_from_caps(db_session, monkeypatch):
    endpoint = _create_ceph_endpoint(db_session, name="ceph-main-detail")

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
    target = service.get_endpoint(endpoint.id)
    perms = target.admin_ops_permissions
    assert perms.users_read is True
    assert perms.users_write is True
    assert perms.accounts_read is True
    assert perms.accounts_write is True


def test_get_endpoint_falls_back_to_no_admin_ops_permissions_on_rgw_error(db_session, monkeypatch):
    _create_ceph_endpoint(db_session, name="ceph-failsafe")

    class FailingRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            raise RGWAdminError("boom")

    monkeypatch.setattr(
        "app.services.storage_endpoints_service.get_rgw_admin_client",
        lambda **kwargs: FailingRGWClient(),
    )

    service = StorageEndpointsService(db_session)
    endpoints = service.list_endpoints(include_admin_ops_permissions=True)
    target = next((endpoint for endpoint in endpoints if endpoint.name == "ceph-failsafe"), None)
    assert target is not None
    perms = target.admin_ops_permissions
    assert perms.users_read is False
    assert perms.users_write is False
    assert perms.accounts_read is False
    assert perms.accounts_write is False


def test_sync_env_endpoints_skips_admin_ops_permissions_resolution(db_session, monkeypatch):
    calls = {"count": 0}
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        json.dumps(
            [
                {
                    "name": "ceph-env",
                    "endpoint_url": "https://ceph-env.example.test",
                    "provider": "ceph",
                    "admin_access_key": "AKIA-ADMIN",
                    "admin_secret_key": "SECRET-ADMIN",
                    "features_config": "features:\n  admin:\n    enabled: true\n",
                    "is_default": True,
                }
            ]
        ),
        raising=False,
    )

    class FakeRGWClient:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            calls["count"] += 1
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
    synced = service.sync_env_endpoints()
    assert len(synced) == 1
    assert calls["count"] == 0


def test_update_endpoint_clearing_access_keys_also_clears_secrets(db_session):
    endpoint = _create_ceph_endpoint_with_full_credentials(db_session)
    service = StorageEndpointsService(db_session)

    updated = service.update_endpoint(
        endpoint.id,
        StorageEndpointUpdate(
            admin_access_key=None,
            supervision_access_key=None,
            ceph_admin_access_key=None,
            features_config=(
                "features:\n"
                "  admin:\n"
                "    enabled: false\n"
                "  usage:\n"
                "    enabled: false\n"
                "  metrics:\n"
                "    enabled: false\n"
            ),
        ),
    )

    assert updated.admin_access_key is None
    assert updated.supervision_access_key is None
    assert updated.ceph_admin_access_key is None

    persisted = db_session.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint.id).first()
    assert persisted is not None
    assert persisted.admin_access_key is None
    assert persisted.admin_secret_key is None
    assert persisted.supervision_access_key is None
    assert persisted.supervision_secret_key is None
    assert persisted.ceph_admin_access_key is None
    assert persisted.ceph_admin_secret_key is None
