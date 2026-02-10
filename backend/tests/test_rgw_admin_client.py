# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.services.rgw_admin import RGWAdminClient, RGWAdminError


def test_set_access_key_status_accepts_list_response(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: [])

    client.set_access_key_status("user-1", "AK-123", enabled=False, tenant=None)


def test_set_access_key_status_raises_when_not_implemented(monkeypatch):
    client = RGWAdminClient(
        access_key="AKIA-TEST",
        secret_key="SECRET-TEST",
        endpoint="https://rgw-admin.example.test",
        region="us-east-1",
    )

    monkeypatch.setattr(client, "_request", lambda *args, **kwargs: {"not_implemented": True})

    with pytest.raises(RGWAdminError, match="does not support updating access key status"):
        client.set_access_key_status("user-1", "AK-123", enabled=False, tenant=None)
