# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.core.security import get_password_hash
from app.db import S3Connection, User, UserRole
from app.routers.admin import onboarding


def _admin(db_session) -> User:
    user = User(
        email="onboarding-admin@example.com",
        hashed_password=get_password_hash("correct horse battery staple"),
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_onboarding_tracks_endpoint_and_active_storage_access_independently(db_session, monkeypatch):
    state = SimpleNamespace(endpoints=[])
    settings = SimpleNamespace(onboarding=SimpleNamespace(dismissed=False))
    monkeypatch.setattr(onboarding, "load_app_settings", lambda: settings)
    monkeypatch.setattr(
        onboarding,
        "get_storage_endpoints_service",
        lambda _db: SimpleNamespace(list_endpoints=lambda: state.endpoints),
    )

    initial = onboarding._build_status(db_session)
    assert initial.model_dump() == {
        "dismissed": False,
        "complete": False,
        "endpoint_configured": False,
        "storage_access_configured": False,
    }

    state.endpoints = [SimpleNamespace(id=1)]
    endpoint_only = onboarding._build_status(db_session)
    assert endpoint_only.endpoint_configured is True
    assert endpoint_only.storage_access_configured is False
    assert endpoint_only.complete is False

    user = _admin(db_session)
    connection = S3Connection(
        created_by_user_id=user.id,
        name="Onboarding connection",
        custom_endpoint_config='{"endpoint_url":"https://s3.example.test"}',
        access_key_id="access-key",
        secret_access_key="secret-key",
        is_active=True,
    )
    db_session.add(connection)
    db_session.commit()

    complete = onboarding._build_status(db_session)
    assert complete.storage_access_configured is True
    assert complete.complete is True

    connection.is_active = False
    db_session.commit()
    inactive = onboarding._build_status(db_session)
    assert inactive.storage_access_configured is False
    assert inactive.complete is False


def test_onboarding_can_be_dismissed_before_storage_setup(db_session, monkeypatch):
    user = _admin(db_session)
    settings = SimpleNamespace(onboarding=SimpleNamespace(dismissed=False))
    saved = []
    audit_calls = []
    monkeypatch.setattr(onboarding, "load_app_settings", lambda: settings)
    monkeypatch.setattr(onboarding, "save_app_settings", lambda value: saved.append(value))
    monkeypatch.setattr(
        onboarding,
        "get_storage_endpoints_service",
        lambda _db: SimpleNamespace(list_endpoints=lambda: []),
    )
    audit = SimpleNamespace(record_action=lambda **kwargs: audit_calls.append(kwargs))

    status = onboarding.dismiss_onboarding(db_session, user, audit)

    assert status.dismissed is True
    assert status.complete is False
    assert saved == [settings]
    assert audit_calls[0]["metadata"] == {
        "endpoint_configured": False,
        "storage_access_configured": False,
        "complete": False,
    }
