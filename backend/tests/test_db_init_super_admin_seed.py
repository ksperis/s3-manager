# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.core import db_init
from app.core.security import verify_password
from app.db import User, UserRole


def _set_seed_config(monkeypatch, *, mode: str, email: str = "admin@example.com", password: str = "verystrongpass123") -> None:
    monkeypatch.setattr(db_init.settings, "seed_super_admin_mode", mode)
    monkeypatch.setattr(db_init.settings, "seed_super_admin_email", email)
    monkeypatch.setattr(db_init.settings, "seed_super_admin_password", password)
    monkeypatch.setattr(db_init.settings, "seed_super_admin_full_name", "Admin")


def _create_user(
    db_session,
    *,
    email: str,
    role: str = UserRole.UI_USER.value,
    hashed_password: str = "existing-hash",
) -> User:
    user = User(
        email=email,
        full_name="Existing User",
        hashed_password=hashed_password,
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_seed_super_admin_if_empty_creates_user_when_db_is_empty(db_session, monkeypatch):
    _set_seed_config(monkeypatch, mode="if_empty", password="superstrongpass456")

    seeded = db_init._seed_super_admin_if_needed(db_session)
    assert seeded is True

    created = db_session.query(User).filter(User.email == "admin@example.com").first()
    assert created is not None
    assert created.role == UserRole.UI_SUPERADMIN.value
    assert verify_password("superstrongpass456", created.hashed_password)


def test_seed_super_admin_if_empty_skips_when_any_user_exists(db_session, monkeypatch):
    _set_seed_config(monkeypatch, mode="if_empty")
    _create_user(db_session, email="existing@example.com")

    seeded = db_init._seed_super_admin_if_needed(db_session)
    assert seeded is False
    assert db_session.query(User).filter(User.email == "admin@example.com").first() is None
    assert db_session.query(User).count() == 1


def test_seed_super_admin_if_missing_keeps_legacy_behavior(db_session, monkeypatch):
    _set_seed_config(monkeypatch, mode="if_missing")
    _create_user(db_session, email="existing@example.com")

    seeded = db_init._seed_super_admin_if_needed(db_session)
    assert seeded is True
    assert db_session.query(User).filter(User.email == "admin@example.com").first() is not None
    assert db_session.query(User).count() == 2


def test_seed_super_admin_disabled_never_creates_user(db_session, monkeypatch):
    _set_seed_config(monkeypatch, mode="disabled")

    seeded = db_init._seed_super_admin_if_needed(db_session)
    assert seeded is False
    assert db_session.query(User).count() == 0


def test_seed_super_admin_if_empty_does_not_duplicate_existing_seed_user(db_session, monkeypatch):
    _set_seed_config(monkeypatch, mode="if_empty")
    existing = _create_user(
        db_session,
        email="admin@example.com",
        role=UserRole.UI_SUPERADMIN.value,
        hashed_password="already-hashed",
    )

    seeded = db_init._seed_super_admin_if_needed(db_session)
    assert seeded is False
    assert db_session.query(User).filter(User.email == "admin@example.com").count() == 1

    db_session.refresh(existing)
    assert existing.hashed_password == "already-hashed"
