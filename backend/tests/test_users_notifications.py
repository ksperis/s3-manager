# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
import json

from app.db import (
    AccountRole,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserNotification,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.main import app
from app.routers import dependencies


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
        created_at=datetime(2026, 1, 11, 9, 0, 0),
    )
    db_session.add(notification)
    db_session.commit()
    db_session.refresh(notification)
    return notification


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
            account_role=AccountRole.PORTAL_MANAGER.value,
        )
    )
    db_session.commit()

    response = client.get("/api/users/me/notifications")

    assert response.status_code == 200
    payload = response.json()
    assert payload["unread_count"] == 1
    assert payload["items"][0]["title"] == "Quota near limit"
    assert payload["items"][0]["payload"]["endpoint_name"] == endpoint.name


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
