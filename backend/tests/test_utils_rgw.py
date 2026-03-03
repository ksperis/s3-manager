# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import StorageEndpoint, StorageProvider
from app.utils.rgw import get_supervision_rgw_client, is_rgw_account_id, resolve_account_scope


def test_resolve_account_scope_with_account_id():
    account_id = "RGW12345678901234567"
    resolved_account_id, tenant = resolve_account_scope(account_id)
    assert resolved_account_id == account_id
    assert tenant is None
    assert is_rgw_account_id(account_id)


def test_resolve_account_scope_with_tenant_name():
    identifier = "env-admin"
    resolved_account_id, tenant = resolve_account_scope(identifier)
    assert resolved_account_id is None
    assert tenant == identifier
    assert not is_rgw_account_id(identifier)


def test_get_supervision_rgw_client_uses_endpoint_url_when_admin_feature_disabled(monkeypatch):
    captured: dict[str, object] = {}

    def fake_get_rgw_admin_client(access_key=None, secret_key=None, endpoint=None, region=None, verify_tls=True):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["endpoint"] = endpoint
        captured["region"] = region
        captured["verify_tls"] = verify_tls
        return "client"

    monkeypatch.setattr("app.utils.rgw.get_rgw_admin_client", fake_get_rgw_admin_client)
    endpoint = StorageEndpoint(
        name="ceph",
        endpoint_url="https://rgw.example.test/",
        provider=StorageProvider.CEPH.value,
        verify_tls=False,
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config="features:\n  admin:\n    enabled: false\n",
    )

    client = get_supervision_rgw_client(endpoint)
    assert client == "client"
    assert captured["access_key"] == "SUP-AK"
    assert captured["secret_key"] == "SUP-SK"
    assert captured["endpoint"] == "https://rgw.example.test"
    assert captured["verify_tls"] is False
