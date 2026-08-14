# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import create_api_access_token, decode_typed_token, get_password_hash
from app.db import User, UserRole
from app.main import app
from app.routers import dependencies
from tests.auth_test_utils import authenticate_ui_client, clear_ui_client, trusted_origin_headers


@pytest.fixture
def auth_client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[dependencies.get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
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


def test_api_token_lifecycle_and_auth_usage(auth_client, db_session):
    admin = _create_user(
        db_session,
        email="api-admin@example.com",
        password="supersecret",
        role=UserRole.UI_ADMIN.value,
    )
    credentials = authenticate_ui_client(auth_client, db_session, admin)

    create_response = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "ansible", "expires_in_days": 30, "scopes": ["admin:read"]},
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert create_response.status_code == 201
    create_payload = create_response.json()
    api_token = create_payload["access_token"]
    token_id = create_payload["api_token"]["id"]
    assert create_payload["api_token"]["name"] == "ansible"
    assert api_token

    list_response = auth_client.get("/api/auth/api-tokens")
    assert list_response.status_code == 200
    listed_ids = {entry["id"] for entry in list_response.json()}
    assert token_id in listed_ids

    clear_ui_client(auth_client)
    auth_response = auth_client.get(
        "/api/admin/users/minimal",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert auth_response.status_code == 200

    credentials = authenticate_ui_client(auth_client, db_session, admin)
    revoke_response = auth_client.delete(
        f"/api/auth/api-tokens/{token_id}",
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert revoke_response.status_code == 204

    clear_ui_client(auth_client)
    after_revoke = auth_client.get(
        "/api/admin/users/minimal",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    assert after_revoke.status_code == 401


def test_api_token_auth_rejects_same_jti_with_different_token_hash(auth_client, db_session):
    admin = _create_user(
        db_session,
        email="api-admin-exact-token@example.com",
        password="supersecret",
        role=UserRole.UI_ADMIN.value,
    )
    credentials = authenticate_ui_client(auth_client, db_session, admin)

    create_response = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "exact-token", "expires_in_days": 30, "scopes": ["admin:read"]},
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert create_response.status_code == 201
    api_token = create_response.json()["access_token"]
    claims = decode_typed_token(api_token, expected_type="api_access")
    assert claims is not None

    forged_same_jti = create_api_access_token(
        user_id=admin.id,
        token_id=claims["sid"],
        auth_version=admin.auth_version,
        role=admin.role,
        scopes=claims["scopes"],
        expires_delta=timedelta(days=1),
        jti=claims["jti"],
    )

    clear_ui_client(auth_client)
    response = auth_client.get(
        "/api/admin/users/minimal",
        headers={"Authorization": f"Bearer {forged_same_jti}"},
    )
    assert response.status_code == 401


def test_non_admin_cannot_create_api_token(auth_client, db_session):
    user = _create_user(
        db_session,
        email="ui-user@example.com",
        password="supersecret",
        role=UserRole.UI_USER.value,
    )
    credentials = authenticate_ui_client(auth_client, db_session, user, mfa_verified=False)

    response = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "ansible-user", "expires_in_days": 30, "scopes": ["profile:read"]},
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
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
    credentials = authenticate_ui_client(auth_client, db_session, admin)

    response = auth_client.post(
        "/api/auth/api-tokens",
        json={
            "name": "too-long",
            "expires_in_days": settings.api_token_max_expire_days + 1,
            "scopes": ["admin:read"],
        },
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert response.status_code == 400


def test_api_token_scope_is_enforced_and_unmapped_routes_are_denied_by_default(auth_client, db_session):
    admin = _create_user(
        db_session,
        email="api-admin-scopes@example.com",
        password="supersecret",
        role=UserRole.UI_ADMIN.value,
    )
    credentials = authenticate_ui_client(auth_client, db_session, admin)
    created = auth_client.post(
        "/api/auth/api-tokens",
        json={"name": "profile-only", "expires_in_days": 30, "scopes": ["profile:read"]},
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert created.status_code == 201
    token = created.json()["access_token"]
    clear_ui_client(auth_client)

    allowed = auth_client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert allowed.status_code == 200
    insufficient = auth_client.get("/api/admin/users/minimal", headers={"Authorization": f"Bearer {token}"})
    assert insufficient.status_code == 403
    assert insufficient.json()["detail"] == "API token scope is insufficient"
    unmapped = auth_client.get("/api/auth/session", headers={"Authorization": f"Bearer {token}"})
    assert unmapped.status_code == 403
    assert unmapped.json()["detail"] == "API tokens are not allowed for this route"
