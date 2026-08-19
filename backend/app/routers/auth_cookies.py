# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

from fastapi import Response

from app.core.config import get_settings
from app.core.security import create_pre_auth_token
from app.db import User
from app.services.auth_session_service import SessionCredentials


_settings = get_settings()


def set_auth_cookies(response: Response, credentials: SessionCredentials) -> None:
    common = {
        "secure": _settings.refresh_token_cookie_secure,
        "samesite": _settings.refresh_token_cookie_samesite,
        "domain": None,
    }
    response.set_cookie(
        _settings.access_token_cookie_name,
        credentials.access_token,
        max_age=_settings.access_token_expire_minutes * 60,
        httponly=True,
        path="/api",
        **common,
    )
    response.set_cookie(
        _settings.refresh_token_cookie_name,
        credentials.refresh_token,
        max_age=_settings.refresh_token_expire_minutes * 60,
        httponly=True,
        path=_settings.refresh_token_cookie_path,
        **common,
    )
    if credentials.csrf_token:
        response.set_cookie(
            _settings.csrf_cookie_name,
            credentials.csrf_token,
            max_age=_settings.refresh_token_expire_minutes * 60,
            httponly=False,
            path="/",
            **common,
        )


def set_pre_auth_cookie(response: Response, user: User, purpose: str) -> None:
    token = create_pre_auth_token(
        user_id=user.id,
        session_id=str(uuid.uuid4()),
        auth_version=user.auth_version,
        purpose=purpose,
    )
    response.set_cookie(
        _settings.pre_auth_cookie_name,
        token,
        max_age=_settings.pre_auth_expire_minutes * 60,
        httponly=True,
        secure=_settings.refresh_token_cookie_secure,
        samesite=_settings.refresh_token_cookie_samesite,
        path="/api/auth",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(_settings.access_token_cookie_name, path="/api")
    response.delete_cookie(_settings.refresh_token_cookie_name, path=_settings.refresh_token_cookie_path)
    response.delete_cookie(_settings.csrf_cookie_name, path="/")
    response.delete_cookie(_settings.pre_auth_cookie_name, path="/api/auth")
