# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import User, UserRole
from app.services.users_service import UsersService


def test_get_or_create_oidc_user_creates_new_user(db_session):
    service = UsersService(db_session)

    user, created = service.get_or_create_oidc_user(
        provider="Google",
        subject="sub-123",
        email="oidc@example.com",
        full_name="OIDC User",
        picture_url="http://example.com/pic.png",
    )

    assert created is True
    assert user.email == "oidc@example.com"
    assert user.auth_provider == "google"
    assert user.auth_provider_subject == "sub-123"
    assert user.display_name == "OIDC User"
    assert user.hashed_password is None


def test_get_or_create_oidc_user_links_existing_user(db_session):
    existing = User(
        email="existing@example.com",
        full_name="Existing",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(existing)
    db_session.commit()

    service = UsersService(db_session)
    user, created = service.get_or_create_oidc_user(
        provider="google",
        subject="sub-456",
        email="existing@example.com",
        full_name="Existing Linked",
        picture_url=None,
    )

    assert created is False
    assert user.id == existing.id
    assert user.auth_provider == "google"
    assert user.auth_provider_subject == "sub-456"
    assert user.display_name == "Existing Linked"


def test_get_or_create_oidc_user_reuses_existing_mapping(db_session):
    mapped = User(
        email="mapped@example.com",
        full_name="Mapped",
        display_name="Mapped",
        hashed_password=None,
        is_active=True,
        role=UserRole.UI_USER.value,
        auth_provider="google",
        auth_provider_subject="sub-999",
    )
    db_session.add(mapped)
    db_session.commit()

    service = UsersService(db_session)
    user, created = service.get_or_create_oidc_user(
        provider="google",
        subject="sub-999",
        email="mapped@example.com",
        full_name="Updated Name",
        picture_url=None,
    )

    assert created is False
    assert user.id == mapped.id
