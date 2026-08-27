# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.session import SessionDescriptor
from app.models.user import UserOut


class AuthenticationResponse(ApiModel):
    status: Literal[
        "authenticated",
        "mfa_required",
        "mfa_enrollment_required",
        "link_approval_required",
    ]
    user: Optional[UserOut] = None
    session: Optional[SessionDescriptor] = None
    redirect_path: Optional[str] = None
    link_request_id: Optional[str] = None
    recovery_codes: Optional[list[str]] = None


class RefreshResponse(ApiModel):
    status: Literal["authenticated"] = "authenticated"


class SessionInfo(ApiModel):
    id: str
    principal_type: str
    auth_type: str
    created_at: datetime
    last_activity_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    mfa_verified_at: Optional[datetime] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    revoked_at: Optional[datetime] = None
    revoke_reason: Optional[str] = None
    current: bool = False
    user_id: Optional[int] = None
    s3_session_id: Optional[str] = None


class CurrentSessionResponse(ApiModel):
    authenticated: Literal[True] = True
    user: Optional[UserOut] = None
    session: Optional[SessionDescriptor] = None
    auth_session: SessionInfo


class WebAuthnCredentialRequest(ApiModel):
    credential: dict[str, Any]
    name: str = Field(default="Passkey", min_length=1, max_length=128)


class WebAuthnAuthenticationRequest(ApiModel):
    credential: dict[str, Any]


class RecentWebAuthnVerificationResponse(ApiModel):
    mfa_verified_at: datetime


class RecoveryCodeRequest(ApiModel):
    code: str = Field(min_length=8, max_length=128)


class LinkDecisionRequest(ApiModel):
    approve: bool
    reason: Optional[str] = Field(default=None, max_length=500)


class WebAuthnCredentialInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None


class ExternalIdentityInfo(ApiModel):
    id: str
    provider_type: str
    provider_id: str
    email: Optional[str] = None
    email_verified: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None
