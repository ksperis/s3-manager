# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime
import json

import pytest

from app.db import (
    ManagerAccountRole,
    PortalAccountRole,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
    UiGroup,
    UiGroupS3Account,
    User,
    UserNotification,
    UserRole,
    UserS3Account,
    UserS3User,
    UserUiGroup,
)
from app.main import app
from app.routers import dependencies
from app.services.user_notifications_service import _parse_notification_payload


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="notifications-endpoint",
        endpoint_url="http://notifications-rgw.local",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _seed_user(db_session, *, email: str, role: str = UserRole.UI_USER.value) -> User:
    user = User(
        email=email,
        hashed_password="x",
        role=role,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _seed_account(db_session, endpoint: StorageEndpoint) -> S3Account:
    account = S3Account(
        name="Notifications account",
        rgw_account_id="RGW-NOTIFICATIONS",
        rgw_user_uid="notifications-owner",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_s3_user(db_session, endpoint: StorageEndpoint) -> S3User:
    s3_user = S3User(
        name="Notifications S3 user",
        rgw_user_uid="notifications-s3-user",
        rgw_access_key="AK-NOTIFICATIONS",
        rgw_secret_key="SK-NOTIFICATIONS",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.refresh(s3_user)
    return s3_user


def _seed_notification(
    db_session,
    *,
    user: User,
    endpoint: StorageEndpoint,
    account: S3Account | None = None,
    s3_user: S3User | None = None,
    event_key: str = "quota:test",
) -> UserNotification:
    subject_type = "account" if account is not None else "s3_user" if s3_user is not None else None
    notification = UserNotification(
        user_id=user.id,
        notification_type="quota_alert",
        severity="warning",
        title="Quota near limit",
        message="A quota is near its limit.",
        subject_type=subject_type,
        storage_endpoint_id=endpoint.id,
        s3_account_id=account.id if account is not None else None,
        s3_user_id=s3_user.id if s3_user is not None else None,
        event_key=event_key,
        payload_json=json.dumps(
            {
                "alert_level": "threshold",
                "subject_name": account.name if account is not None else s3_user.name if s3_user is not None else "n/a",
                "endpoint_name": endpoint.name,
                "usage_ratio_pct": 90,
                "checked_at": "2026-01-11T09:00:00",
            },
            sort_keys=True,
        ),
        created_at=datetime(2026, 1, 11, 9, 0, 0, tzinfo=UTC),
    )
    db_session.add(notification)
    db_session.commit()
    db_session.refresh(notification)
    return notification


def test_notification_payload_requires_a_json_object():
    assert _parse_notification_payload('{"ratio":90}') == {"ratio": 90}
    with pytest.raises(ValueError):
        _parse_notification_payload("[]")
    with pytest.raises(json.JSONDecodeError):
        _parse_notification_payload("{")


def test_list_notifications_filters_by_current_account_access(client, db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    user = _seed_user(db_session, email="portal-manager@example.test")
    _seed_notification(db_session, user=user, endpoint=endpoint, account=account)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    assert response.json() == {"items": [], "unread_count": 0}

    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        )
    )
    db_session.commit()

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    payload = response.json()
    assert payload["unread_count"] == 1
    assert payload["items"][0]["title"] == "Quota near limit"
    assert payload["items"][0]["payload"]["endpoint_name"] == endpoint.name


def test_account_administrator_notifications_follow_effective_access(
    client,
    db_session,
):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    user = _seed_user(db_session, email="account-administrator@example.test")
    _seed_notification(db_session, user=user, endpoint=endpoint, account=account)
    link = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
    )
    db_session.add(link)
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    assert response.json()["unread_count"] == 1

    db_session.delete(link)
    db_session.commit()

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    assert response.json() == {"items": [], "unread_count": 0}


def test_group_account_notifications_follow_effective_access(client, db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    user = _seed_user(db_session, email="group-account-manager@example.test")
    group = UiGroup(name="notification-account-managers")
    db_session.add(group)
    db_session.flush()
    membership = UserUiGroup(user_id=user.id, group_id=group.id)
    db_session.add_all(
        [
            membership,
            UiGroupS3Account(
                group_id=group.id,
                account_id=account.id,
                manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
                portal_role=None,
            ),
        ]
    )
    db_session.commit()
    _seed_notification(db_session, user=user, endpoint=endpoint, account=account)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    assert response.json()["unread_count"] == 1

    db_session.delete(membership)
    db_session.commit()

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    assert response.json() == {"items": [], "unread_count": 0}


def test_mark_notifications_read_only_updates_visible_rows(client, db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    s3_user = _seed_s3_user(db_session, endpoint)
    user = _seed_user(db_session, email="s3-user-member@example.test")
    hidden = _seed_notification(db_session, user=user, endpoint=endpoint, account=account, event_key="quota:hidden")
    visible = _seed_notification(db_session, user=user, endpoint=endpoint, s3_user=s3_user, event_key="quota:visible")
    db_session.add(UserS3User(user_id=user.id, s3_user_id=s3_user.id))
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.post("/api/users/me/notifications/read", json={"all": True})

    assert response.status_code == 200
    assert response.json()["updated_count"] == 1
    db_session.refresh(visible)
    db_session.refresh(hidden)
    assert visible.read_at is not None
    assert hidden.read_at is None


def test_delete_notifications_is_scoped_and_clear_read_keeps_unread(
    client,
    db_session,
):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    user = _seed_user(db_session, email="delete-notifications@example.test")
    other = _seed_user(db_session, email="other-notifications@example.test")
    unread = _seed_notification(
        db_session,
        user=user,
        endpoint=endpoint,
        event_key="notification:unread",
    )
    read = _seed_notification(
        db_session,
        user=user,
        endpoint=endpoint,
        event_key="notification:read",
    )
    read.read_at = datetime(2026, 1, 11, 10, 0, 0, tzinfo=UTC)
    hidden_read = _seed_notification(
        db_session,
        user=user,
        endpoint=endpoint,
        account=account,
        event_key="notification:hidden-read",
    )
    hidden_read.read_at = datetime(2026, 1, 11, 10, 0, 0, tzinfo=UTC)
    other_row = _seed_notification(
        db_session,
        user=other,
        endpoint=endpoint,
        event_key="notification:other",
    )
    db_session.add_all([read, hidden_read])
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.delete(f"/api/users/me/notifications/{other_row.id}")

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 0, "unread_count": 1}

    response = client.delete("/api/users/me/notifications", params={"read_only": True})

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 1, "unread_count": 1}
    assert db_session.query(UserNotification).filter_by(id=unread.id).one_or_none() is not None
    assert db_session.query(UserNotification).filter_by(id=hidden_read.id).one_or_none() is not None
    assert db_session.query(UserNotification).filter_by(id=other_row.id).one_or_none() is not None

    response = client.delete(f"/api/users/me/notifications/{unread.id}")

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 1, "unread_count": 0}


def test_clear_read_notifications_requires_true_flag(client, db_session):
    user = _seed_user(db_session, email="delete-flag@example.test")
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.delete("/api/users/me/notifications", params={"read_only": False})

    assert response.status_code == 400
