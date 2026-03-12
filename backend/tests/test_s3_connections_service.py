# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

import pytest

from app.db import S3Connection, StorageEndpoint, StorageProvider, User, UserRole, UserS3Connection
from app.models.s3_connection import S3ConnectionCreate, S3ConnectionUpdate
from app.services.s3_connections_service import S3ConnectionsService


def _user(db_session, email: str) -> User:
    user = User(email=email, hashed_password="x", role=UserRole.UI_USER.value, is_active=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="conn-endpoint",
        endpoint_url="https://s3-endpoint.example.test",
        region="eu-west-1",
        provider=StorageProvider.OTHER.value,
        verify_tls=False,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _create_row(db_session, **kwargs) -> S3Connection:
    row = S3Connection(
        owner_user_id=kwargs.get("owner_user_id"),
        name=kwargs.get("name", "conn"),
        is_public=kwargs.get("is_public", False),
        is_shared=kwargs.get("is_shared", False),
        is_active=kwargs.get("is_active", True),
        access_manager=kwargs.get("access_manager", False),
        access_browser=kwargs.get("access_browser", True),
        storage_endpoint_id=kwargs.get("storage_endpoint_id"),
        custom_endpoint_config=kwargs.get("custom_endpoint_config"),
        access_key_id=kwargs.get("access_key_id", "AKIA-CONN-001"),
        secret_access_key=kwargs.get("secret_access_key", "SECRET-CONN-001"),
        capabilities_json=kwargs.get("capabilities_json", '{"can_manage_iam": false}'),
        is_temporary=kwargs.get("is_temporary", False),
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_list_for_user_and_list_owned_private_filters_visibility(db_session):
    owner = _user(db_session, "owner@example.test")
    shared_user = _user(db_session, "shared@example.test")
    other = _user(db_session, "other@example.test")

    public_row = _create_row(db_session, owner_user_id=None, name="public", is_public=True)
    owned_private = _create_row(db_session, owner_user_id=owner.id, name="owned-private")
    shared_row = _create_row(db_session, owner_user_id=other.id, name="shared", is_shared=True)
    _create_row(db_session, owner_user_id=other.id, name="hidden-private")
    _create_row(db_session, owner_user_id=owner.id, name="temporary-owned", is_temporary=True)
    db_session.add(UserS3Connection(user_id=shared_user.id, s3_connection_id=shared_row.id))
    db_session.commit()

    service = S3ConnectionsService(db_session)
    owner_visible = [item.name for item in service.list_for_user(owner.id)]
    assert owner_visible == ["owned-private", "public"]

    shared_visible = [item.name for item in service.list_for_user(shared_user.id)]
    assert shared_visible == ["public", "shared"]

    owned_private_list = [item.name for item in service.list_owned_private(owner.id)]
    assert owned_private_list == ["owned-private"]
    assert public_row.name in owner_visible


def test_get_owned_and_get_visible_with_access_control(db_session):
    owner = _user(db_session, "owner2@example.test")
    reader = _user(db_session, "reader@example.test")
    other = _user(db_session, "other2@example.test")
    private_row = _create_row(db_session, owner_user_id=owner.id, name="private")
    shared_row = _create_row(db_session, owner_user_id=owner.id, name="shared", is_shared=True)
    temporary_row = _create_row(db_session, owner_user_id=owner.id, name="tmp", is_temporary=True)
    db_session.add(UserS3Connection(user_id=reader.id, s3_connection_id=shared_row.id))
    db_session.commit()

    service = S3ConnectionsService(db_session)
    assert service.get_owned(owner.id, private_row.id).id == private_row.id
    assert service.get_visible(reader.id, shared_row.id).id == shared_row.id

    with pytest.raises(KeyError):
        service.get_owned(other.id, private_row.id)
    with pytest.raises(KeyError):
        service.get_visible(other.id, private_row.id)
    with pytest.raises(KeyError):
        service.get_visible(owner.id, temporary_row.id)


def test_create_connection_custom_endpoint_and_storage_endpoint_paths(db_session, monkeypatch):
    user = _user(db_session, "creator@example.test")
    endpoint = _endpoint(db_session)
    service = S3ConnectionsService(db_session)

    monkeypatch.setattr(
        service,
        "_refresh_detected_capabilities",
        lambda row: setattr(row, "capabilities_json", '{"can_manage_iam": true}'),
    )

    custom = service.create(
        user.id,
        S3ConnectionCreate(
            name="custom-conn",
            visibility="private",
            endpoint_url="https://custom.example.test/",
            region="us-east-1",
            force_path_style=True,
            verify_tls=False,
            access_key_id="AKIA-CUSTOM-1234",
            secret_access_key="SECRET-CUSTOM",
            access_manager=True,
            access_browser=True,
            provider_hint="other",
        ),
    )
    assert custom.visibility == "private"
    assert custom.endpoint_url == "https://custom.example.test"
    assert custom.force_path_style is True
    assert custom.verify_tls is False
    assert custom.capabilities["can_manage_iam"] is True
    assert custom.access_key_id.startswith("AKIA***")

    public_conn = service.create(
        user.id,
        S3ConnectionCreate(
            name="public-conn",
            visibility="public",
            storage_endpoint_id=endpoint.id,
            access_key_id="AKIA-PUBLIC-9876",
            secret_access_key="SECRET-PUBLIC",
            access_manager=False,
            access_browser=True,
        ),
    )
    assert public_conn.visibility == "public"
    assert public_conn.storage_endpoint_id == endpoint.id
    assert public_conn.endpoint_url == endpoint.endpoint_url
    assert public_conn.force_path_style is False
    assert public_conn.verify_tls is True


def test_update_connection_visibility_transitions_and_link_cleanup(db_session, monkeypatch):
    owner = _user(db_session, "owner3@example.test")
    consumer = _user(db_session, "consumer@example.test")
    row = _create_row(
        db_session,
        owner_user_id=owner.id,
        name="shared-conn",
        is_shared=True,
        custom_endpoint_config='{"endpoint_url":"https://old.example.test","region":"eu-west-3","force_path_style":false,"verify_tls":true}',
        access_manager=False,
        access_browser=True,
    )
    db_session.add(UserS3Connection(user_id=consumer.id, s3_connection_id=row.id))
    db_session.commit()
    service = S3ConnectionsService(db_session)

    refreshed: list[int] = []
    monkeypatch.setattr(service, "_refresh_detected_capabilities", lambda current: refreshed.append(current.id))

    updated = service.update(
        owner.id,
        row.id,
        S3ConnectionUpdate(
            visibility="private",
            endpoint_url="https://new.example.test/",
            region="us-east-2",
            verify_tls=False,
            force_path_style=True,
            access_key_id="AKIA-UPDATED-7777",
            secret_access_key="SECRET-UPDATED",
            access_manager=True,
            access_browser=True,
            credential_owner_type="iam_user",
            credential_owner_identifier="user-42",
        ),
    )
    assert updated.visibility == "private"
    assert updated.endpoint_url == "https://new.example.test"
    assert updated.region == "us-east-2"
    assert updated.verify_tls is False
    assert updated.force_path_style is True
    assert updated.access_manager is True
    assert updated.credential_owner_type == "iam_user"
    assert refreshed == [row.id]

    link_count = (
        db_session.query(UserS3Connection)
        .filter(UserS3Connection.s3_connection_id == row.id)
        .count()
    )
    assert link_count == 0


def test_update_connection_rejects_invalid_access_flags(db_session):
    owner = _user(db_session, "owner4@example.test")
    row = _create_row(db_session, owner_user_id=owner.id, name="invalid-flags")
    service = S3ConnectionsService(db_session)

    with pytest.raises(ValueError, match="At least one access flag"):
        service.update(owner.id, row.id, S3ConnectionUpdate(access_manager=False, access_browser=False))


def test_update_connection_supports_active_flag_and_keeps_inactive_visible_in_management_lists(db_session):
    owner = _user(db_session, "owner-active-flag@example.test")
    row = _create_row(db_session, owner_user_id=owner.id, name="active-flag-conn", is_active=True)
    service = S3ConnectionsService(db_session)

    updated = service.update(owner.id, row.id, S3ConnectionUpdate(is_active=False))
    assert updated.is_active is False

    db_session.refresh(row)
    assert row.is_active is False

    owned_private_names = [item.name for item in service.list_owned_private(owner.id)]
    assert "active-flag-conn" in owned_private_names


def test_touch_last_used_set_get_capabilities_and_delete(db_session):
    owner = _user(db_session, "owner5@example.test")
    row = _create_row(
        db_session,
        owner_user_id=owner.id,
        name="caps-conn",
        capabilities_json='{"can_manage_iam": false, "x": 1}',
    )
    service = S3ConnectionsService(db_session)

    service.touch_last_used(owner.id, row.id)
    db_session.refresh(row)
    assert row.last_used_at is not None

    caps = service.get_capabilities(owner.id, row.id)
    assert caps["x"] == 1
    assert caps["can_manage_iam"] is False

    service.set_capabilities(owner.id, row.id, {"can_manage_iam": True, "flag": "ok"})
    db_session.refresh(row)
    assert json.loads(row.capabilities_json)["flag"] == "ok"

    service.delete(owner.id, row.id)
    assert db_session.query(S3Connection).filter(S3Connection.id == row.id).first() is None

    # Missing row: no-op
    service.touch_last_used(owner.id, 99999)


def test_create_temporary_and_mask_access_key(db_session):
    owner = _user(db_session, "owner6@example.test")
    endpoint = _endpoint(db_session)
    service = S3ConnectionsService(db_session)

    row = service.create_temporary(
        owner_user_id=owner.id,
        name="temp-conn",
        storage_endpoint_id=endpoint.id,
        access_key_id="AKIA-TEMP-KEY-9999",
        secret_access_key="SECRET-TEMP",
        session_token="SESSION-TOKEN",
        expires_at=None,
        temp_user_uid="tenant$uid",
        temp_access_key_id="AKIA-TEMP-CHILD",
    )
    assert row.is_temporary is True
    assert row.access_browser is True
    assert row.access_manager is False
    assert row.session_token == "SESSION-TOKEN"

    model = service._to_model(row)
    assert model.access_key_id.startswith("AKIA***")
    assert service._mask_access_key_id("  SHORT7 ") == "***T7"
    assert service._mask_access_key_id("") == ""
