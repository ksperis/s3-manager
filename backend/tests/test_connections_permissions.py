# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db import S3Connection, StorageEndpoint, UiGroup, User, UserRole, UserUiGroup
from app.main import app
from app.routers import dependencies
from app.routers.connections import _ensure_manual_private_connection_creation_allowed
from app.routers.dependencies_internal.account_context import _resolve_connection_context
from app.services.effective_access_service import EffectiveAccessService
from app.utils.s3_connection_endpoint import build_custom_endpoint_config


def _user(db_session, role: str = UserRole.UI_USER.value, **permissions) -> User:
    row = User(
        email=f"{role}-{db_session.query(User).count()}@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
        **permissions,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_manual_permission_has_no_admin_role_bypass(db_session):
    admin = _user(db_session, UserRole.UI_ADMIN.value)

    with pytest.raises(HTTPException) as exc:
        _ensure_manual_private_connection_creation_allowed(db_session, admin)

    assert exc.value.status_code == 403


def test_private_connection_permissions_aggregate_direct_and_groups_by_or(db_session):
    user = _user(
        db_session,
        can_create_manual_private_connections=True,
        can_provision_managed_private_connections=False,
    )
    manual_group = UiGroup(name="manual", can_create_manual_private_connections=True)
    managed_group = UiGroup(name="managed", can_provision_managed_private_connections=True)
    db_session.add_all([manual_group, managed_group])
    db_session.flush()
    db_session.add_all(
        [
            UserUiGroup(user_id=user.id, group_id=manual_group.id),
            UserUiGroup(user_id=user.id, group_id=managed_group.id),
        ]
    )
    db_session.commit()

    resolved = EffectiveAccessService(db_session).resolve_user(user)
    assert resolved.can_create_manual_private_connections is True
    assert resolved.can_provision_managed_private_connections is True

    db_session.query(UserUiGroup).filter(UserUiGroup.group_id == managed_group.id).delete()
    db_session.commit()
    resolved = EffectiveAccessService(db_session).resolve_user(user)
    assert resolved.can_create_manual_private_connections is True
    assert resolved.can_provision_managed_private_connections is False

    user.can_create_manual_private_connections = False
    db_session.query(UserUiGroup).delete()
    db_session.commit()
    resolved = EffectiveAccessService(db_session).resolve_user(user)
    assert resolved.can_create_manual_private_connections is False
    assert resolved.can_provision_managed_private_connections is False


def test_ui_none_cannot_inherit_private_connection_permissions(db_session):
    user = _user(db_session, UserRole.UI_NONE.value)
    group = UiGroup(
        name="all-private-connection-rights",
        can_create_manual_private_connections=True,
        can_provision_managed_private_connections=True,
    )
    db_session.add(group)
    db_session.flush()
    db_session.add(UserUiGroup(user_id=user.id, group_id=group.id))
    db_session.commit()

    resolved = EffectiveAccessService(db_session).resolve_user(user)
    assert resolved.can_create_manual_private_connections is False
    assert resolved.can_provision_managed_private_connections is False


@contextmanager
def _client_for(db_session, user: User):
    def override_get_db():
        yield db_session

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_account_user] = lambda: user
    with TestClient(app) as client:
        try:
            yield client
        finally:
            app.dependency_overrides = {}


def test_revocation_keeps_owned_connection_lifecycle_but_rejects_sensitive_forgery(db_session):
    user = _user(db_session)
    endpoint = StorageEndpoint(
        name="registered",
        endpoint_url="https://s3.example.test",
        provider="other",
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    connection = S3Connection(
        created_by_user_id=user.id,
        name="existing",
        is_shared=False,
        is_active=True,
        access_manager=False,
        access_browser=True,
        storage_endpoint_id=endpoint.id,
        access_key_id="EXISTING-AK",
        secret_access_key="EXISTING-SK",
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)

    effective = EffectiveAccessService(db_session).to_user_effective_access(user)
    assert effective.has_owned_private_connections is True

    with _client_for(db_session, user) as client:
        assert client.get("/api/connections").status_code == 200
        safe_update = client.put(
            f"/api/connections/{connection.id}",
            json={
                "name": "renamed",
                "is_active": False,
                "access_manager": True,
                "tags": [{"label": "owned"}],
            },
        )
        assert safe_update.status_code == 200
        assert safe_update.json()["tags"][0]["label"] == "owned"

        forged_requests = [
            client.post(
                "/api/connections",
                json={
                    "name": "forged",
                    "endpoint_url": "https://forged.example.test",
                    "access_key_id": "FORGED-AK",
                    "secret_access_key": "FORGED-SK",
                },
            ),
            client.post(
                "/api/connections/validate-credentials",
                json={
                    "endpoint_url": "https://forged.example.test",
                    "access_key_id": "FORGED-AK",
                    "secret_access_key": "FORGED-SK",
                },
            ),
            *[
                client.put(f"/api/connections/{connection.id}", json=payload)
                for payload in (
                    {"provider_hint": "other"},
                    {"storage_endpoint_id": endpoint.id},
                    {"credential_owner_type": "iam_user"},
                    {"credential_owner_identifier": "forged-owner"},
                    {"endpoint_url": "https://forged.example.test"},
                    {"region": "eu-west-3"},
                    {"access_key_id": "FORGED-AK"},
                    {"secret_access_key": "FORGED-SK"},
                    {"force_path_style": True},
                    {"verify_tls": False},
                )
            ],
            client.put(
                f"/api/connections/{connection.id}/credentials",
                json={"access_key_id": "FORGED-AK", "secret_access_key": "FORGED-SK"},
            ),
            client.get("/api/connections/storage-endpoints"),
        ]
        assert all(response.status_code == 403 for response in forged_requests)

        assert client.put(
            f"/api/connections/{connection.id}", json={"is_active": True}
        ).status_code == 200
        assert client.delete(f"/api/connections/{connection.id}").status_code == 204


def test_registered_endpoint_catalog_accepts_group_inherited_manual_permission(db_session):
    user = _user(db_session)
    group = UiGroup(name="connection-creators", can_create_manual_private_connections=True)
    endpoint = StorageEndpoint(
        name="public catalog endpoint",
        endpoint_url="https://catalog.example.test",
        provider="other",
        is_default=True,
        admin_access_key="MUST-NOT-LEAK",
        admin_secret_key="MUST-NOT-LEAK",
    )
    db_session.add_all([group, endpoint])
    db_session.flush()
    db_session.add(UserUiGroup(user_id=user.id, group_id=group.id))
    db_session.commit()

    with _client_for(db_session, user) as client:
        response = client.get("/api/connections/storage-endpoints")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": endpoint.id,
            "name": endpoint.name,
            "endpoint_url": endpoint.endpoint_url,
            "is_default": True,
        }
    ]
    assert "MUST-NOT-LEAK" not in response.text


def test_existing_private_manual_connection_is_revalidated_before_use(db_session, monkeypatch):
    user = _user(db_session)
    connection = S3Connection(
        created_by_user_id=user.id,
        name="persisted manual endpoint",
        is_shared=False,
        is_active=True,
        access_manager=True,
        access_browser=True,
        custom_endpoint_config=build_custom_endpoint_config(
            "https://blocked.example.test",
            "eu-west-3",
            False,
            True,
        ),
        access_key_id="PERSISTED-AK",
        secret_access_key="PERSISTED-SK",
    )
    db_session.add(connection)
    db_session.commit()

    monkeypatch.setattr(
        "app.routers.dependencies_internal.account_context.validate_user_supplied_s3_endpoint",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("blocked")),
    )

    with pytest.raises(HTTPException) as exc:
        _resolve_connection_context(db_session, user, connection.id, surface="browser")

    assert exc.value.status_code == 403
    assert exc.value.detail == "Custom S3 endpoint is not allowed by outbound policy"


def test_registered_admin_endpoint_is_exempt_from_user_endpoint_allowlist(db_session, monkeypatch):
    user = _user(db_session)
    endpoint = StorageEndpoint(
        name="operator managed",
        endpoint_url="https://private.operator.example.test",
        provider="other",
    )
    db_session.add(endpoint)
    db_session.flush()
    connection = S3Connection(
        created_by_user_id=user.id,
        name="registered endpoint connection",
        is_shared=False,
        is_active=True,
        access_manager=True,
        access_browser=True,
        storage_endpoint_id=endpoint.id,
        access_key_id="REGISTERED-AK",
        secret_access_key="REGISTERED-SK",
    )
    db_session.add(connection)
    db_session.commit()

    monkeypatch.setattr(
        "app.routers.dependencies_internal.account_context.validate_user_supplied_s3_endpoint",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must stay exempt")),
    )

    context = _resolve_connection_context(db_session, user, connection.id, surface="browser")

    assert context.source_connection.id == connection.id


def test_manual_connection_creation_supports_direct_free_url_and_group_registered_endpoint(
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.s3_connections_service.S3ConnectionsService._refresh_detected_capabilities",
        lambda _service, row: setattr(row, "capabilities_json", '{"can_manage_iam":false}'),
    )
    monkeypatch.setattr(
        "app.services.s3_connection_endpoint_planner.validate_user_supplied_s3_endpoint",
        lambda value, field_name="Endpoint URL": value.rstrip("/"),
    )

    direct_user = _user(db_session, can_create_manual_private_connections=True)
    with _client_for(db_session, direct_user) as client:
        free_url = client.post(
            "/api/connections",
            json={
                "name": "free URL",
                "endpoint_url": "https://free.example.test/",
                "region": "eu-west-3",
                "provider_hint": "other",
                "access_key_id": "FREE-AK",
                "secret_access_key": "FREE-SK",
            },
        )
    assert free_url.status_code == 201, free_url.text
    assert free_url.json()["endpoint_url"] == "https://free.example.test"
    assert "FREE-SK" not in free_url.text

    group_user = _user(db_session)
    group = UiGroup(name="registered creators", can_create_manual_private_connections=True)
    endpoint = StorageEndpoint(
        name="registered create endpoint",
        endpoint_url="https://registered.example.test",
        provider="other",
    )
    db_session.add_all([group, endpoint])
    db_session.flush()
    db_session.add(UserUiGroup(user_id=group_user.id, group_id=group.id))
    db_session.commit()
    with _client_for(db_session, group_user) as client:
        registered = client.post(
            "/api/connections",
            json={
                "name": "registered endpoint",
                "storage_endpoint_id": endpoint.id,
                "access_key_id": "REGISTERED-AK",
                "secret_access_key": "REGISTERED-SK",
            },
        )
    assert registered.status_code == 201, registered.text
    assert registered.json()["storage_endpoint_id"] == endpoint.id
    assert registered.json()["endpoint_url"] == endpoint.endpoint_url
    assert "REGISTERED-SK" not in registered.text
