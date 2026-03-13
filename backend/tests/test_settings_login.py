# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import StorageEndpoint, StorageProvider


def test_login_settings_endpoints_are_sorted_by_name_case_insensitive(client, db_session, monkeypatch):
    db_session.add_all(
        [
            StorageEndpoint(
                name="Zulu",
                endpoint_url="https://zulu.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=True,
                is_editable=True,
            ),
            StorageEndpoint(
                name="alpha",
                endpoint_url="https://alpha.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=False,
                is_editable=True,
            ),
            StorageEndpoint(
                name="Beta",
                endpoint_url="https://beta.example.test",
                provider=StorageProvider.CEPH.value,
                is_default=False,
                is_editable=True,
            ),
        ]
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.routers.settings.load_app_settings",
        lambda: SimpleNamespace(
            general=SimpleNamespace(
                allow_login_access_keys=False,
                allow_login_endpoint_list=True,
                allow_login_custom_endpoint=False,
            ),
            branding=SimpleNamespace(login_logo_url=None),
        ),
    )

    response = client.get("/api/settings/login")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [endpoint["name"] for endpoint in payload["endpoints"]] == ["alpha", "Beta", "Zulu"]
    assert payload["endpoints"][0]["is_default"] is False
