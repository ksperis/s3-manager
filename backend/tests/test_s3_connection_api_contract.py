# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.db import (
    AccountRole,
    ManagedPrivateAccess,
    S3Account,
    S3Connection,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
)
from app.main import app
from app.routers import dependencies
from app.services.tags_service import TagsService


@pytest.fixture
def contract_client(db_session):
    user = User(
        email="contract-superadmin@example.com",
        full_name="Contract Superadmin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
        can_create_manual_private_connections=True,
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
    monkeypatch.setattr(
        "app.services.s3_connection_endpoint_planner.validate_user_supplied_s3_endpoint",
        lambda value, field_name="Endpoint URL": value.rstrip("/"),
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


def test_private_connection_create_rejects_unknown_managed_endpoint(
    contract_client,
):
    client, _, _ = contract_client

    response = client.post(
        "/api/connections",
        json={
            "name": "contract-private-missing-endpoint",
            "storage_endpoint_id": 999_999,
            "access_key_id": "AKIAPRIVATEMISSINGENDPOINT",
            "secret_access_key": "SECRETPRIVATEMISSINGENDPOINT",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Storage endpoint not found"


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
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert "iam_capable" not in payload
    assert payload["is_active"] is True
    assert payload["capabilities"]["can_manage_iam"] is True
    assert payload["execution_status"] == "ready"
    assert "is_shared" not in payload
    assert "access_manager" not in payload
    assert "access_browser" not in payload


@pytest.mark.parametrize("path", ["/api/connections", "/api/admin/s3-connections"])
def test_connections_api_rejects_noncanonical_credential_owner_types(
    contract_client,
    path,
):
    client, _, _ = contract_client

    response = client.post(
        path,
        json={
            "name": "invalid-owner-type",
            "endpoint_url": "https://invalid-owner-type.example.test",
            "access_key_id": "AKIAINVALIDOWNERTYPE",
            "secret_access_key": "SECRETINVALIDOWNERTYPE",
            "credential_owner_type": "rgw_user",
            "credential_owner_identifier": "rgw-user",
        },
    )

    assert response.status_code == 422


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


def test_admin_connections_api_requires_explicit_managed_endpoint_detachment(
    monkeypatch,
    contract_client,
):
    client, db_session, _ = contract_client
    monkeypatch.setattr(
        "app.services.s3_connection_capabilities_service.probe_connection_can_manage_iam",
        lambda _connection: True,
    )
    endpoint = StorageEndpoint(
        name="Contract managed endpoint",
        endpoint_url="https://contract-managed.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    create_response = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-managed-connection",
            "storage_endpoint_id": endpoint.id,
            "access_key_id": "AKIAADMINMANAGEDCONTRACT",
            "secret_access_key": "SECRETADMINMANAGEDCONTRACT",
        },
    )
    assert create_response.status_code == 201
    connection_id = create_response.json()["id"]

    ignored_custom_update = client.put(
        f"/api/admin/s3-connections/{connection_id}",
        json={"endpoint_url": "https://must-not-be-ignored.example.test"},
    )
    assert ignored_custom_update.status_code == 400
    assert ignored_custom_update.json()["detail"] == (
        "Custom endpoint fields cannot be combined with a managed storage endpoint"
    )

    detach_response = client.put(
        f"/api/admin/s3-connections/{connection_id}",
        json={
            "storage_endpoint_id": None,
            "endpoint_url": "https://contract-detached.example.test/",
            "region": "detached-region",
        },
    )
    assert detach_response.status_code == 200
    assert detach_response.json()["storage_endpoint_id"] is None
    assert (
        detach_response.json()["endpoint_url"]
        == "https://contract-detached.example.test"
    )
    assert detach_response.json()["region"] == "detached-region"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("visibility", "shared"),
        ("is_shared", True),
        ("access_manager", True),
        ("access_browser", True),
    ],
)
def test_admin_connections_api_rejects_visibility_and_access_fields(contract_client, field, value):
    client, _, _ = contract_client

    create_with_visibility = client.post(
        "/api/admin/s3-connections",
        json={
            "name": "contract-admin-connection-invalid-create",
            "endpoint_url": "https://contract-admin-invalid-create.example.test",
            "access_key_id": "AKIAADMININVALIDCREATE",
            "secret_access_key": "SECRETADMININVALIDCREATE",
            field: value,
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
        },
    )
    assert create_response.status_code == 201
    connection_id = create_response.json()["id"]

    update_with_visibility = client.put(
        f"/api/admin/s3-connections/{connection_id}",
        json={field: value},
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


def test_admin_connection_user_links_keep_crud_contract(contract_client):
    client, db_session, user = contract_client
    target = User(
        email="contract-linked-user@example.com",
        full_name="Contract Linked User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    shared_connection = S3Connection(
        created_by_user_id=user.id,
        name="contract-shared-user-links",
        is_shared=True,
        access_manager=True,
        access_browser=False,
        access_key_id="AKIASHAREDUSERLINKS",
        secret_access_key="SECRETSHAREDUSERLINKS",
    )
    db_session.add_all([target, shared_connection])
    db_session.commit()
    db_session.refresh(target)
    db_session.refresh(shared_connection)
    path = f"/api/admin/s3-connections/{shared_connection.id}/users"

    created = client.post(path, json={"user_id": target.id})
    upserted = client.post(path, json={"user_id": target.id})
    touched = client.put(
        f"{path}/{target.id}",
        json={"user_id": target.id},
    )
    listed = client.get(path)

    assert created.status_code == 201
    assert upserted.status_code == 201
    assert touched.status_code == 200
    assert listed.status_code == 200
    assert listed.json() == [
        {
            "user_id": target.id,
            "email": target.email,
            "full_name": target.full_name,
            "created_at": created.json()["created_at"],
            "updated_at": touched.json()["updated_at"],
        }
    ]

    removed = client.delete(f"{path}/{target.id}")
    missing_touch = client.put(
        f"{path}/{target.id}",
        json={"user_id": target.id},
    )
    missing_delete = client.delete(f"{path}/{target.id}")
    missing_user = client.post(path, json={"user_id": 999_999})

    assert removed.status_code == 204
    assert client.get(path).json() == []
    assert missing_touch.status_code == 404
    assert missing_touch.json()["detail"] == "Link not found"
    assert missing_delete.status_code == 404
    assert missing_delete.json()["detail"] == "Link not found"
    assert missing_user.status_code == 404
    assert missing_user.json()["detail"] == "User not found"


def test_admin_cannot_mutate_or_delete_a_connection_used_as_managed_access_source(contract_client):
    client, db_session, user = contract_client
    source = S3Connection(
        created_by_user_id=user.id,
        name="managed-access-source",
        is_shared=True,
        is_active=True,
        access_manager=True,
        access_browser=False,
        access_key_id="SOURCE-AK",
        secret_access_key="SOURCE-SK",
        custom_endpoint_config='{"endpoint_url":"https://source.example.test","force_path_style":false,"provider":null,"region":null,"verify_tls":true}',
    )
    db_session.add(source)
    db_session.flush()
    db_session.add(
        ManagedPrivateAccess(
            owner_user_id=user.id,
            source_context_type="connection",
            source_context_id=source.id,
            remote_principal_type="iam_user",
            remote_principal_identifier="bkr-private-source",
            iam_username="bkr-private-source",
            state="active",
        )
    )
    db_session.commit()

    endpoint_update = client.put(
        f"/api/admin/s3-connections/{source.id}",
        json={"endpoint_url": "https://replacement.example.test"},
    )
    status_update = client.put(
        f"/api/admin/s3-connections/{source.id}",
        json={"is_active": False},
    )
    credential_update = client.put(
        f"/api/admin/s3-connections/{source.id}/credentials",
        json={"access_key_id": "OTHER-AK", "secret_access_key": "OTHER-SK"},
    )
    deletion = client.delete(f"/api/admin/s3-connections/{source.id}")

    assert endpoint_update.status_code == 409
    assert status_update.status_code == 409
    assert credential_update.status_code == 409
    assert deletion.status_code == 409


def test_execution_contexts_api_exposes_can_manage_iam_key(contract_client):
    client, db_session, user = contract_client
    endpoint = StorageEndpoint(
        name="contract-endpoint",
        endpoint_url="https://contract-endpoint.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    account = S3Account(
        name="contract-account",
        rgw_account_id="RGWCONTRACT0001",
        rgw_user_uid="rgwcontract0001-admin",
        rgw_access_key="AK-CONTRACT-ACCOUNT",
        rgw_secret_key="SK-CONTRACT-ACCOUNT",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
            is_root=False,
        )
    )
    connection = S3Connection(
        created_by_user_id=user.id,
        name="contract-execution-context-connection",
        storage_endpoint_id=endpoint.id,
        access_manager=False,
        access_browser=True,
        access_key_id="AK-CONN-CTX",
        secret_access_key="SK-CONN-CTX",
        capabilities_json=json.dumps({"can_manage_iam": False}),
    )
    db_session.add(connection)
    db_session.flush()
    tags = TagsService(db_session)
    tags.replace_storage_endpoint_tags(endpoint, ["endpoint-prod", "ceph-a"])
    tags.replace_account_tags(account, ["account-finance"])
    tags.replace_connection_tags(connection, ["connection-shared"])
    db_session.commit()

    response = client.get("/api/me/execution-contexts?workspace=browser")

    assert response.status_code == 200
    payload = response.json()
    assert payload
    for item in payload:
        capabilities = item.get("capabilities", {})
        assert "can_manage_iam" in capabilities
        assert "iam_capable" not in capabilities
        if item["kind"] == "account":
            assert [tag["label"] for tag in item["tags"]] == ["account-finance"]
            assert [tag["color_key"] for tag in item["tags"]] == ["neutral"]
            assert [tag["scope"] for tag in item["tags"]] == ["standard"]
            assert [tag["label"] for tag in item["endpoint_tags"]] == ["endpoint-prod", "ceph-a"]
            assert [tag["color_key"] for tag in item["endpoint_tags"]] == ["neutral", "neutral"]
            assert [tag["scope"] for tag in item["endpoint_tags"]] == ["standard", "standard"]
        if item["kind"] == "connection":
            assert [tag["label"] for tag in item["tags"]] == ["connection-shared"]
            assert [tag["color_key"] for tag in item["tags"]] == ["neutral"]
            assert [tag["label"] for tag in item["endpoint_tags"]] == ["endpoint-prod", "ceph-a"]
            assert [tag["color_key"] for tag in item["endpoint_tags"]] == ["neutral", "neutral"]
