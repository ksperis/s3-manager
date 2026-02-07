# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.db import User, UserRole
from app.main import app
from app.routers import dependencies


@pytest.fixture
def auth_client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[dependencies.get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides = {}


def _create_user(db_session, *, email: str, password: str, role: str) -> User:
    user = User(
        email=email,
        full_name=email.split("@", 1)[0],
        hashed_password=get_password_hash(password),
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client: TestClient, *, email: str, password: str) -> str:
    response = client.post(
        "/api/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_api_token_lifecycle_and_auth_usage(auth_client, db_session):
    admin = _create_user(
        db_session,
        email="api-admin@example.com",
        password="supersecret",
        role=UserRole.UI_ADMIN.value,
    )
    login_token = _login(auth_client, email=admin.email, password="supersecret")

    create_response = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "ansible", "expires_in_days": 30},
        headers={"Authorization": f"Bearer {login_token}"},
    )
    assert create_response.status_code == 201
    create_payload = create_response.json()
    api_token = create_payload["access_token"]
    token_id = create_payload["api_token"]["id"]
    assert create_payload["api_token"]["name"] == "ansible"
    assert api_token

    list_response = auth_client.get(
        "/api/auth/api-tokens",
        headers={"Authorization": f"Bearer {login_token}"},
    )
    assert list_response.status_code == 200
    listed_ids = {entry["id"] for entry in list_response.json()}
    assert token_id in listed_ids

    auth_response = auth_client.get(
        "/api/admin/users/minimal",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert auth_response.status_code == 200

    revoke_response = auth_client.delete(
        f"/api/auth/api-tokens/{token_id}",
        headers={"Authorization": f"Bearer {login_token}"},
    )
    assert revoke_response.status_code == 204

    after_revoke = auth_client.get(
        "/api/admin/users/minimal",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert after_revoke.status_code == 401


def test_non_admin_cannot_create_api_token(auth_client, db_session):
    user = _create_user(
        db_session,
        email="ui-user@example.com",
        password="supersecret",
        role=UserRole.UI_USER.value,
    )
    token = _login(auth_client, email=user.email, password="supersecret")

    response = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "ansible-user", "expires_in_days": 30},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403


def test_api_token_expiry_limit_is_enforced(auth_client, db_session):
    settings = get_settings()
    admin = _create_user(
        db_session,
        email="api-admin-limit@example.com",
        password="supersecret",
        role=UserRole.UI_ADMIN.value,
    )
    token = _login(auth_client, email=admin.email, password="supersecret")

    response = auth_client.post(
        "/api/auth/api-tokens",
        json={
            "name": "too-long",
            "expires_in_days": settings.api_token_max_expire_days + 1,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
