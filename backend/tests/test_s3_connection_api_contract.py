# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.db import S3Account, S3Connection, User, UserRole, UserS3Account
from app.main import app
from app.routers import dependencies


@pytest.fixture
def contract_client(db_session):
    user = User(
        email="contract-superadmin@example.com",
        full_name="Contract Superadmin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_account_user] = lambda: user
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: user
    app.dependency_overrides[dependencies.get_current_account_admin] = lambda: user
    with TestClient(app) as test_client:
        yield test_client, db_session, user
    app.dependency_overrides = {}


def test_private_connections_api_does_not_expose_iam_capable(monkeypatch, contract_client):
    client, _, _ = contract_client
    monkeypatch.setattr(
        "app.services.s3_connection_capabilities_service.probe_connection_can_manage_iam",
        lambda connection: True,
    )

    response = client.post(
        "/api/connections",
        json={
            "name": "contract-private-connection",
            "endpoint_url": "https://contract-private.example.test",
            "access_key_id": "AKIAPRIVATECONTRACT",
            "secret_access_key": "SECRETPRIVATECONTRACT",
            "access_manager": False,
            "access_browser": True,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert "iam_capable" not in payload
    assert payload["is_active"] is True
    assert payload["capabilities"]["can_manage_iam"] is True


def test_admin_connections_api_does_not_expose_iam_capable(monkeypatch, contract_client):
    client, _, _ = contract_client
    monkeypatch.setattr(
        "app.services.s3_connection_capabilities_service.probe_connection_can_manage_iam",
        lambda connection: True,
    )

    response = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-admin-connection",
            "endpoint_url": "https://contract-admin.example.test",
            "access_key_id": "AKIAADMINCONTRACT",
            "secret_access_key": "SECRETADMINCONTRACT",
            "access_manager": True,
            "access_browser": True,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert "iam_capable" not in payload
    assert payload["is_active"] is True
    assert payload["capabilities"]["can_manage_iam"] is True
    assert payload["is_shared"] is True


def test_admin_connections_api_supports_is_active_update(monkeypatch, contract_client):
    client, _, _ = contract_client
    monkeypatch.setattr(
        "app.services.s3_connection_capabilities_service.probe_connection_can_manage_iam",
        lambda connection: True,
    )

    create_response = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-admin-connection-active-update",
            "endpoint_url": "https://contract-admin-active.example.test",
            "access_key_id": "AKIAADMINACTIVECONTRACT",
            "secret_access_key": "SECRETADMINACTIVECONTRACT",
            "access_manager": True,
            "access_browser": True,
        },
    )
    assert create_response.status_code == 201
    connection_id = create_response.json()["id"]

    update_response = client.put(
        f"/api/admin/s3-connections/{connection_id}",
        json={"is_active": False},
    )
    assert update_response.status_code == 200
    assert update_response.json()["is_active"] is False


def test_admin_connections_api_rejects_visibility_fields(contract_client):
    client, _, _ = contract_client

    create_with_visibility = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-admin-connection-invalid-create",
            "endpoint_url": "https://contract-admin-invalid-create.example.test",
            "access_key_id": "AKIAADMININVALIDCREATE",
            "secret_access_key": "SECRETADMININVALIDCREATE",
            "access_manager": True,
            "access_browser": True,
            "visibility": "shared",
        },
    )
    assert create_with_visibility.status_code == 422

    create_response = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-admin-connection-valid",
            "endpoint_url": "https://contract-admin-valid.example.test",
            "access_key_id": "AKIAADMINVALID",
            "secret_access_key": "SECRETADMINVALID",
            "access_manager": True,
            "access_browser": True,
        },
    )
    assert create_response.status_code == 201
    connection_id = create_response.json()["id"]

    update_with_visibility = client.put(
        f"/api/admin/s3-connections/{connection_id}",
        json={"visibility": "private"},
    )
    assert update_with_visibility.status_code == 422


def test_admin_connections_api_returns_404_for_non_shared_targets(contract_client):
    client, db_session, user = contract_client
    private_conn = S3Connection(
        created_by_user_id=user.id,
        name="contract-admin-private-hidden",
        is_shared=False,
        access_manager=True,
        access_browser=True,
        access_key_id="AKIAADMINPRIVATEHIDDEN",
        secret_access_key="SECRETADMINPRIVATEHIDDEN",
    )
    another_private_conn = S3Connection(
        created_by_user_id=user.id,
        name="contract-admin-another-private-hidden",
        is_shared=False,
        access_manager=True,
        access_browser=True,
        access_key_id="AKIAADMINANOTHERPRIVATEHIDDEN",
        secret_access_key="SECRETADMINANOTHERPRIVATEHIDDEN",
    )
    db_session.add(private_conn)
    db_session.add(another_private_conn)
    db_session.commit()
    db_session.refresh(private_conn)
    db_session.refresh(another_private_conn)

    private_update = client.put(
        f"/api/admin/s3-connections/{private_conn.id}",
        json={"is_active": False},
    )
    public_delete = client.delete(f"/api/admin/s3-connections/{another_private_conn.id}")
    private_users = client.get(f"/api/admin/s3-connections/{private_conn.id}/users")

    assert private_update.status_code == 404
    assert public_delete.status_code == 404
    assert private_users.status_code == 404


def test_execution_contexts_api_exposes_can_manage_iam_key(contract_client):
    client, db_session, user = contract_client
    account = S3Account(
        name="contract-account",
        rgw_account_id="RGWCONTRACT0001",
        rgw_access_key="AK-CONTRACT-ACCOUNT",
        rgw_secret_key="SK-CONTRACT-ACCOUNT",
    )
    db_session.add(account)
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            account_admin=True,
            is_root=False,
        )
    )
    db_session.add(
        S3Connection(
            created_by_user_id=user.id,
            name="contract-execution-context-connection",
            access_manager=False,
            access_browser=True,
            access_key_id="AK-CONN-CTX",
            secret_access_key="SK-CONN-CTX",
            capabilities_json=json.dumps({"can_manage_iam": False}),
        )
    )
    db_session.commit()

    response = client.get("/api/me/execution-contexts?workspace=browser")

    assert response.status_code == 200
    payload = response.json()
    assert payload
    for item in payload:
        capabilities = item.get("capabilities", {})
        assert "can_manage_iam" in capabilities
        assert "iam_capable" not in capabilities
