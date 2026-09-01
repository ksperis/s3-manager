# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    s3_session_id = Column(String, ForeignKey("s3_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    principal_type = Column(String, nullable=False)
    auth_type = Column(String, nullable=False)
    auth_version = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_activity_at = Column(UTCDateTime(), default=utcnow, nullable=False, index=True)
    idle_expires_at = Column(UTCDateTime(), nullable=False, index=True)
    absolute_expires_at = Column(UTCDateTime(), nullable=False, index=True)
    mfa_verified_at = Column(UTCDateTime(), nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    csrf_token_hash = Column(String, nullable=False)
    revoked_at = Column(UTCDateTime(), nullable=True, index=True)
    revoke_reason = Column(String, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    s3_session = relationship("S3Session", foreign_keys=[s3_session_id])


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(String, primary_key=True)
    family_id = Column(String, nullable=False, index=True)
    auth_session_id = Column(
        String,
        ForeignKey("auth_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_id = Column(String, ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)
    used_at = Column(UTCDateTime(), nullable=True)
    replaced_by_id = Column(String, ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True)
    revoked_at = Column(UTCDateTime(), nullable=True, index=True)
    revoke_reason = Column(String, nullable=True)

    auth_session = relationship("AuthSession", foreign_keys=[auth_session_id])


class ExternalIdentity(Base):
    __tablename__ = "external_identities"
    __table_args__ = (
        UniqueConstraint("provider_type", "provider_id", "subject", name="uq_external_identity_subject"),
    )

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_type = Column(String, nullable=False)
    provider_id = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    email = Column(String, nullable=True, index=True)
    email_verified = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_login_at = Column(UTCDateTime(), nullable=True)
    revoked_at = Column(UTCDateTime(), nullable=True, index=True)
    link_source = Column(String, nullable=False, default="jit", server_default="jit")

    user = relationship("User", foreign_keys=[user_id])


class ExternalIdentityLinkRequest(Base):
    __tablename__ = "external_identity_link_requests"
    __table_args__ = (
        UniqueConstraint("provider_type", "provider_id", "subject", name="uq_external_link_request_subject"),
    )

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_type = Column(String, nullable=False)
    provider_id = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    email = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    picture_url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending", server_default="pending", index=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False)
    decided_at = Column(UTCDateTime(), nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decision_reason = Column(String, nullable=True)
    decision_source = Column(String, nullable=True)


class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    credential_id = Column(String, nullable=False, unique=True, index=True)
    public_key = Column(Text, nullable=False)
    sign_count = Column(Integer, nullable=False, default=0, server_default="0")
    transports_json = Column(Text, nullable=False, default="[]", server_default="[]")
    name = Column(String, nullable=False)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    last_used_at = Column(UTCDateTime(), nullable=True)
    revoked_at = Column(UTCDateTime(), nullable=True, index=True)


class AuthChallenge(Base):
    __tablename__ = "auth_challenges"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Opaque identifier binding the challenge to either a short-lived pre-auth
    # JWT or an active UI session. It must not be a foreign key because
    # pre-authentication deliberately creates no authenticated session.
    binding_sid = Column(String, nullable=True, index=True)
    purpose = Column(String, nullable=False, index=True)
    challenge_hash = Column(String, nullable=False, unique=True)
    payload_json = Column(Text, nullable=False, default="{}", server_default="{}")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)
    consumed_at = Column(UTCDateTime(), nullable=True)


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String, nullable=False, unique=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    consumed_at = Column(UTCDateTime(), nullable=True, index=True)


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"
    __table_args__ = (
        UniqueConstraint("bucket_key", "window_started_at", name="uq_auth_rate_limit_window"),
    )

    id = Column(String, primary_key=True)
    bucket_key = Column(String, nullable=False, index=True)
    window_started_at = Column(UTCDateTime(), nullable=False)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(UTCDateTime(), default=utcnow, nullable=False)
