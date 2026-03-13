# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.db import StorageEndpoint, User, UserRole
from app.main import app
from app.routers import dependencies


def _settings(allowed: bool):
    return SimpleNamespace(general=SimpleNamespace(allow_user_private_connections=allowed))


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "ListBuckets")


class _FakeS3Client:
    def __init__(self, error: Exception | None = None):
        self._error = error

    def list_buckets(self):
        if self._error is not None:
            raise self._error
        return {"Buckets": []}


@contextmanager
def _build_client(db_session):
    superadmin = User(
        email="superadmin-validate@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    ui_user = User(
        email="ui-user-validate@example.com",
        full_name="UI User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(superadmin)
    db_session.add(ui_user)
    db_session.commit()
    db_session.refresh(superadmin)
    db_session.refresh(ui_user)

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_super_admin] = lambda: superadmin
    app.dependency_overrides[dependencies.get_current_account_user] = lambda: ui_user
    with TestClient(app) as test_client:
        try:
            yield test_client, ui_user
        finally:
            app.dependency_overrides = {}


def test_validate_credentials_success_admin_custom_endpoint(db_session, monkeypatch):
    with _build_client(db_session) as (client, _):
        monkeypatch.setattr(
            "app.services.s3_connection_validation_service.s3_client.get_s3_client",
            lambda **kwargs: _FakeS3Client(),
        )

        response = client.post(
            "/api/admin/s3-connections/validate-credentials",
            json={
                "endpoint_url": "https://s3.example.test",
                "region": "us-east-1",
                "access_key_id": "AKIA-SUCCESS",
                "secret_access_key": "SECRET-SUCCESS",
                "force_path_style": True,
                "verify_tls": False,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["severity"] == "success"
    assert payload["code"] is None
    assert payload["message"] == "Credentials validated."


def test_validate_credentials_access_denied_is_warning_user_route(db_session, monkeypatch):
    with _build_client(db_session) as (client, _):
        monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(True))
        endpoint = StorageEndpoint(
            name="endpoint-a",
            endpoint_url="https://s3-endpoint-a.example.test",
            region="eu-west-1",
            provider="other",
            verify_tls=True,
            is_default=False,
            is_editable=True,
        )
        db_session.add(endpoint)
        db_session.commit()
        db_session.refresh(endpoint)
        monkeypatch.setattr(
            "app.services.s3_connection_validation_service.s3_client.get_s3_client",
            lambda **kwargs: _FakeS3Client(error=_client_error("AccessDenied")),
        )

        response = client.post(
            "/api/connections/validate-credentials",
            json={
                "storage_endpoint_id": endpoint.id,
                "access_key_id": "AKIA-WARN",
                "secret_access_key": "SECRET-WARN",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["severity"] == "warning"
    assert payload["code"] == "AccessDenied"


def test_validate_credentials_invalid_credentials_error(db_session, monkeypatch):
    with _build_client(db_session) as (client, _):
        monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(True))
        monkeypatch.setattr(
            "app.services.s3_connection_validation_service.s3_client.get_s3_client",
            lambda **kwargs: _FakeS3Client(error=_client_error("InvalidAccessKeyId")),
        )

        response = client.post(
            "/api/connections/validate-credentials",
            json={
                "endpoint_url": "https://s3-invalid-credentials.example.test",
                "access_key_id": "AKIA-INVALID",
                "secret_access_key": "SECRET-INVALID",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["severity"] == "error"
    assert payload["code"] == "InvalidAccessKeyId"
    assert payload["message"] == "Invalid S3 credentials."


def test_validate_credentials_storage_endpoint_not_found(db_session, monkeypatch):
    with _build_client(db_session) as (client, _):
        monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(True))

        response = client.post(
            "/api/connections/validate-credentials",
            json={
                "storage_endpoint_id": 999999,
                "access_key_id": "AKIA-MISSING-ENDPOINT",
                "secret_access_key": "SECRET-MISSING-ENDPOINT",
            },
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "Storage endpoint not found"


def test_validate_credentials_forbidden_when_private_connections_disabled(db_session, monkeypatch):
    with _build_client(db_session) as (client, _):
        monkeypatch.setattr("app.routers.connections.load_app_settings", lambda: _settings(False))

        response = client.post(
            "/api/connections/validate-credentials",
            json={
                "endpoint_url": "https://s3-forbidden.example.test",
                "access_key_id": "AKIA-FORBIDDEN",
                "secret_access_key": "SECRET-FORBIDDEN",
            },
        )

    assert response.status_code == 403
