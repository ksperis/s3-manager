# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import User
from app.services.auth_session_service import AuthSessionService, SessionCredentials


def trusted_origin_headers(*, csrf_token: str | None = None) -> dict[str, str]:
    headers = {"Origin": get_settings().public_origin}
    if csrf_token:
        headers["X-CSRF-Token"] = csrf_token
    return headers


def authenticate_ui_client(
    client: TestClient,
    db: Session,
    user: User,
    *,
    mfa_verified: bool = True,
) -> SessionCredentials:
    settings = get_settings()
    credentials = AuthSessionService(db).create_for_user(
        user,
        auth_type="webauthn" if mfa_verified else "test",
        ip_address="testclient",
        user_agent="pytest",
        mfa_verified=mfa_verified,
    )
    client.cookies.set(
        settings.access_token_cookie_name,
        credentials.access_token,
        path="/api",
    )
    client.cookies.set(
        settings.refresh_token_cookie_name,
        credentials.refresh_token,
        path=settings.refresh_token_cookie_path,
    )
    if credentials.csrf_token:
        client.cookies.set(
            settings.csrf_cookie_name,
            credentials.csrf_token,
            path="/",
        )
    return credentials


def clear_ui_client(client: TestClient) -> None:
    settings = get_settings()
    for name, path in (
        (settings.access_token_cookie_name, "/api"),
        (settings.refresh_token_cookie_name, settings.refresh_token_cookie_path),
        (settings.csrf_cookie_name, "/"),
        (settings.pre_auth_cookie_name, "/api/auth"),
    ):
        client.cookies.delete(name, path=path)
