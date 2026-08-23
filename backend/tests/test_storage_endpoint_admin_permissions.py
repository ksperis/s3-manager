# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.db import StorageEndpoint, StorageProvider
from app.services.rgw_admin import RGWAdminError
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)


def _endpoint(**overrides) -> StorageEndpoint:
    values = {
        "id": 7,
        "name": "ceph-main",
        "endpoint_url": "https://ceph-main.example.test",
        "provider": StorageProvider.CEPH.value,
        "admin_access_key": "AKIA-ADMIN",
        "admin_secret_key": "SECRET-ADMIN",
        "region": "us-east-1",
        "verify_tls": False,
        "features_config": "features:\n  admin:\n    enabled: true\n",
    }
    values.update(overrides)
    return StorageEndpoint(**values)


@pytest.mark.parametrize(
    ("raw_caps", "expected"),
    [
        (
            [
                {"type": "users", "perm": "read,write"},
                {"type": "accounts", "perm": "write"},
            ],
            (True, True, True, True),
        ),
        (
            "users=read;accounts=read,write",
            (True, False, True, True),
        ),
        (
            {"users": "write", "accounts": "read"},
            (True, True, True, False),
        ),
    ],
)
def test_resolves_supported_rgw_caps_payloads(raw_caps, expected):
    calls: list[dict[str, object]] = []

    class FakeRGWClient:
        def get_user_by_access_key(
            self,
            access_key: str,
            allow_not_found: bool = False,
        ):
            assert access_key == "AKIA-ADMIN"
            assert allow_not_found is True
            return {"caps": raw_caps}

    def client_factory(**kwargs):
        calls.append(kwargs)
        return FakeRGWClient()

    permissions = resolve_storage_endpoint_admin_ops_permissions(
        _endpoint(),
        provider=StorageProvider.CEPH,
        capabilities={"admin": True},
        client_factory=client_factory,
    )

    assert (
        permissions.users_read,
        permissions.users_write,
        permissions.accounts_read,
        permissions.accounts_write,
    ) == expected
    assert calls == [
        {
            "access_key": "AKIA-ADMIN",
            "secret_key": "SECRET-ADMIN",
            "endpoint": "https://ceph-main.example.test",
            "region": "us-east-1",
            "verify_tls": False,
        }
    ]


@pytest.mark.parametrize(
    ("endpoint", "provider", "capabilities"),
    [
        (_endpoint(), StorageProvider.AWS, {"admin": True}),
        (_endpoint(), StorageProvider.CEPH, {"admin": False}),
        (
            _endpoint(admin_access_key=None),
            StorageProvider.CEPH,
            {"admin": True},
        ),
    ],
)
def test_skips_resolution_without_ceph_admin_execution(
    endpoint: StorageEndpoint,
    provider: StorageProvider,
    capabilities: dict[str, bool],
):
    def unexpected_client_factory(**_kwargs):
        raise AssertionError("RGW client must not be created")

    permissions = resolve_storage_endpoint_admin_ops_permissions(
        endpoint,
        provider=provider,
        capabilities=capabilities,
        client_factory=unexpected_client_factory,
    )

    assert permissions.users_read is False
    assert permissions.users_write is False
    assert permissions.accounts_read is False
    assert permissions.accounts_write is False


def test_returns_empty_permissions_when_rgw_lookup_fails():
    def failing_client_factory(**_kwargs):
        class FailingRGWClient:
            def get_user_by_access_key(
                self,
                _access_key: str,
                allow_not_found: bool = False,
            ):
                assert allow_not_found is True
                raise RGWAdminError("boom")

        return FailingRGWClient()

    permissions = resolve_storage_endpoint_admin_ops_permissions(
        _endpoint(),
        provider=StorageProvider.CEPH,
        capabilities={"admin": True},
        client_factory=failing_client_factory,
    )

    assert permissions.users_read is False
    assert permissions.users_write is False
    assert permissions.accounts_read is False
    assert permissions.accounts_write is False
