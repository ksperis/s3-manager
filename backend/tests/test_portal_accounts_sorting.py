# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import AccountRole, S3Account, StorageEndpoint, StorageProvider, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="portal-sort-endpoint",
        endpoint_url="https://portal-sort.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  iam:\n"
            "    enabled: true\n"
        ),
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _seed_account(db_session, *, name: str, rgw_account_id: str, endpoint_id: int) -> S3Account:
    row = S3Account(
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_access_key=f"AK-{name}",
        rgw_secret_key="SECRET",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_portal_accounts_are_sorted_case_insensitive(client, db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    actor = User(email="portal-sort-user@example.test", hashed_password="x", role=UserRole.UI_USER.value, is_active=True)
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)

    accounts = [
        _seed_account(db_session, name="Zulu", rgw_account_id="RGW-PORTAL-01", endpoint_id=endpoint.id),
        _seed_account(db_session, name="alpha", rgw_account_id="RGW-PORTAL-02", endpoint_id=endpoint.id),
        _seed_account(db_session, name="Beta", rgw_account_id="RGW-PORTAL-03", endpoint_id=endpoint.id),
    ]
    for account in accounts:
        db_session.add(
            UserS3Account(
                user_id=actor.id,
                account_id=account.id,
                account_role=AccountRole.PORTAL_USER.value,
                account_admin=False,
                is_root=False,
            )
        )
    db_session.commit()

    class _FakeQuotaService:
        def get_account_quota(self, account):  # noqa: ANN001
            return None, None

    monkeypatch.setattr(
        "app.routers.portal.get_s3_accounts_service",
        lambda db, allow_missing_admin=True: _FakeQuotaService(),
    )

    previous_override = app.dependency_overrides.get(dependencies.get_current_account_user)
    app.dependency_overrides[dependencies.get_current_account_user] = lambda: actor
    try:
        response = client.get("/api/portal/accounts")
    finally:
        if previous_override is not None:
            app.dependency_overrides[dependencies.get_current_account_user] = previous_override
        else:
            app.dependency_overrides.pop(dependencies.get_current_account_user, None)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["name"] for item in payload] == ["alpha", "Beta", "Zulu"]
