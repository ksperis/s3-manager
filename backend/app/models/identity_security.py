# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import EmailStr, Field

from app.models.base import ApiModel
from app.models.auth import SessionInfo
from app.models.user import UiRole


class AdminPasskeyInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class AdminSessionInfo(SessionInfo):
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_role: Optional[UiRole] = None


class AdminExternalIdentityInfo(ApiModel):
    id: str
    provider_type: Literal["oidc", "ldap"]
    provider_id: str
    subject: str
    email: Optional[str] = None
    email_verified: bool
    link_source: str
    created_at: datetime
    last_login_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class AdminUserSecurity(ApiModel):
    user_id: int
    email: str
    role: UiRole
    has_local_password: bool
    passkey_required: bool
    passkeys: list[AdminPasskeyInfo] = Field(default_factory=list)
    external_identities: list[AdminExternalIdentityInfo] = Field(default_factory=list)
    sessions: list[SessionInfo] = Field(default_factory=list)


class AdminSetPasswordRequest(ApiModel):
    password: str = Field(min_length=1, max_length=1024)


class AdminExternalIdentityRequest(ApiModel):
    provider_type: Literal["oidc", "ldap"]
    provider_id: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=2048)
    email: Optional[EmailStr] = None
    email_verified: bool = False
    restore: bool = False


class AdminMfaResetResponse(ApiModel):
    user_id: int
    passkey_enrollment_required: bool
    passkeys_removed: int
    recovery_codes_removed: int
    challenges_removed: int


class ExternalIdentityLinkRequestInfo(ApiModel):
    id: str
    user_id: int
    user_email: str
    user_role: UiRole
    provider_type: str
    provider_id: str
    email: str
    status: str
    created_at: datetime
    expires_at: datetime
    decided_at: Optional[datetime] = None
    decision_source: Optional[str] = None
