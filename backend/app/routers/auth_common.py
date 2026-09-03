# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared UI authentication completion helpers."""

from __future__ import annotations

from typing import Optional

from fastapi import Request, Response

from app.core.config import get_settings
from app.db import User
from app.models.auth import AuthenticationResponse
from app.routers.auth_cookies import set_auth_cookies, set_pre_auth_cookie
from app.routers.auth_request_context import request_context
from app.services.auth_session_service import AuthSessionService
from app.services.identity_security_policy import passkey_required_for_role
from app.services.users_service import UsersService
from app.services.webauthn_service import WebAuthnService

settings = get_settings()


def _finish_user_primary_auth(
    *,
    request: Request,
    response: Response,
    user: User,
    users_service: UsersService,
    auth_type: str,
    redirect_path: Optional[str] = None,
) -> AuthenticationResponse:
    has_passkey = WebAuthnService(users_service.db).has_credentials(user.id)
    if has_passkey or passkey_required_for_role(users_service.db, user.role):
        result_status = "mfa_required" if has_passkey else "mfa_enrollment_required"
        set_pre_auth_cookie(
            response,
            user,
            "mfa_authentication" if has_passkey else "mfa_enrollment",
        )
        return AuthenticationResponse(
            status=result_status,
            user=users_service.user_to_out(user),
            redirect_path=redirect_path,
        )
    ip_address, user_agent, _ = request_context(request, settings=settings)
    credentials = AuthSessionService(users_service.db).create_for_user(
        user,
        auth_type=auth_type,
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=False,
    )
    set_auth_cookies(response, credentials)
    return AuthenticationResponse(
        status="authenticated",
        user=users_service.user_to_out(user),
        redirect_path=redirect_path,
    )
