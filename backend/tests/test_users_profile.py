# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.core.security import get_password_hash, verify_password
from app.db import User, UserRole
from app.main import app
from app.routers import dependencies
from uuid import uuid4


def _seed_user(db_session, *, hashed_password: str | None) -> User:
    email = f"profile-user-{uuid4().hex[:8]}@example.com"
    user = User(
        email=email,
        full_name="Profile User",
        display_name="Profile User",
        hashed_password=hashed_password,
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_update_users_me_updates_full_name(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"full_name": "Nouveau Nom"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["full_name"] == "Nouveau Nom"
    assert payload["display_name"] == "Nouveau Nom"

    db_session.refresh(user)
    assert user.full_name == "Nouveau Nom"
    assert user.display_name == "Nouveau Nom"


def test_update_users_me_updates_ui_language(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"ui_language": "de"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ui_language"] == "de"

    db_session.refresh(user)
    assert user.ui_language == "de"


def test_update_users_me_clears_ui_language(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    user.ui_language = "fr"
    db_session.add(user)
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put("/api/users/me", json={"ui_language": None})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ui_language"] is None

    db_session.refresh(user)
    assert user.ui_language is None


def test_update_users_me_changes_password_with_current_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "old-password",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 200, response.text

    db_session.refresh(user)
    assert verify_password("new-password", user.hashed_password)


def test_update_users_me_rejects_wrong_current_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "bad-password",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect"


def test_update_users_me_rejects_password_change_without_local_password(client, db_session):
    user = _seed_user(db_session, hashed_password=None)
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "irrelevant",
            "new_password": "new-password",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password change is unavailable for this account"


def test_update_users_me_rejects_short_new_password(client, db_session):
    user = _seed_user(db_session, hashed_password=get_password_hash("old-password"))
    app.dependency_overrides[dependencies.get_current_user] = lambda: user

    response = client.put(
        "/api/users/me",
        json={
            "current_password": "old-password",
            "new_password": "short123",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Password must be at least 12 characters long"
