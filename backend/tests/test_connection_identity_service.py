# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.db import S3Connection, StorageEndpoint
from app.services.connection_identity_service import (
    ConnectionIdentityService,
    reset_connection_identity_cache,
)


def _ceph_endpoint(
    *,
    name: str = "ceph-endpoint",
    metrics_enabled: bool = True,
    usage_enabled: bool = True,
) -> StorageEndpoint:
    return StorageEndpoint(
        id=1,
        name=name,
        endpoint_url=f"https://{name}.example.test",
        admin_endpoint=f"https://{name}.example.test/admin",
        provider="ceph",
        region="eu-west-1",
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            f"  metrics:\n    enabled: {'true' if metrics_enabled else 'false'}\n"
            f"  usage:\n    enabled: {'true' if usage_enabled else 'false'}\n"
        ),
    )


def _connection(
    endpoint: StorageEndpoint,
    *,
    owner_type: str | None = None,
    owner_identifier: str | None = None,
) -> S3Connection:
    return S3Connection(
        id=42,
        name="conn",
        storage_endpoint_id=endpoint.id,
        storage_endpoint=endpoint,
        access_key_id="AKIA-CONN-TEST",
        secret_access_key="SECRET-CONN-TEST",
        credential_owner_type=owner_type,
        credential_owner_identifier=owner_identifier,
        capabilities_json=json.dumps({"can_manage_iam": False}),
    )


def test_resolve_metrics_identity_uses_owner_metadata_first():
    reset_connection_identity_cache()
    endpoint = _ceph_endpoint()
    connection = _connection(
        endpoint,
        owner_type="s3_user",
        owner_identifier="rgw-account$portal-user",
    )

    resolved = ConnectionIdentityService().resolve_metrics_identity(connection)

    assert resolved.eligible is True
    assert resolved.iam_identity == "rgw-account$portal-user"
    assert resolved.rgw_account_id is None
    assert resolved.reason is None


def test_resolve_metrics_identity_uses_admin_lookup_and_caches(monkeypatch):
    reset_connection_identity_cache()
    endpoint = _ceph_endpoint(name="ceph-cache")
    connection = _connection(endpoint, owner_type=None, owner_identifier=None)
    calls = {"count": 0}

    class _FakeAdmin:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert access_key == "AKIA-CONN-TEST"
            assert allow_not_found is True
            calls["count"] += 1
            return {"uid": "RGW12345678901234567$analytics", "account_id": "RGW12345678901234567"}

    monkeypatch.setattr(
        "app.services.connection_identity_service.get_rgw_admin_client",
        lambda **kwargs: _FakeAdmin(),
    )

    service = ConnectionIdentityService(ttl_seconds=300)
    first = service.resolve_metrics_identity(connection)
    second = service.resolve_metrics_identity(connection)

    assert first.eligible is True
    assert first.iam_identity == "RGW12345678901234567$analytics"
    assert second.iam_identity == "RGW12345678901234567$analytics"
    assert calls["count"] == 1


def test_resolve_metrics_identity_returns_reason_when_identity_missing(monkeypatch):
    reset_connection_identity_cache()
    endpoint = _ceph_endpoint(name="ceph-missing-id")
    connection = _connection(endpoint, owner_type="account_user", owner_identifier="RGW00000000000000099")

    class _FakeAdmin:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            return None

    monkeypatch.setattr(
        "app.services.connection_identity_service.get_rgw_admin_client",
        lambda **kwargs: _FakeAdmin(),
    )

    resolved = ConnectionIdentityService().resolve_metrics_identity(connection)

    assert resolved.eligible is False
    assert resolved.iam_identity is None
    assert resolved.reason is not None
    assert "unable to resolve rgw identity" in resolved.reason.lower()
