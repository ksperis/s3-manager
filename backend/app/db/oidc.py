# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

from sqlalchemy import Boolean, Column, Integer, String, Text

from app.core.security import EncryptedString
from .base import Base


class OidcLoginState(Base):
    __tablename__ = "oidc_login_states"

    state = Column(String, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    code_verifier = Column(String, nullable=False)
    nonce = Column(String, nullable=True)
    redirect_path = Column(String, nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False, index=True)


class OidcAuthorizationCode(Base):
    """Short-lived hash ledger preventing authorization-code replay."""

    __tablename__ = "oidc_authorization_codes"

    id = Column(String, primary_key=True)
    provider = Column(String, nullable=False, index=True)
    code_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)


class OidcProvider(Base):
    __tablename__ = "oidc_providers"

    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    discovery_url = Column(String, nullable=False)
    client_id = Column(String, nullable=False)
    client_secret = Column(EncryptedString, nullable=True)
    redirect_uri = Column(String, nullable=False)
    scopes_json = Column(
        Text,
        nullable=False,
        default='["openid","email","profile"]',
        server_default='["openid","email","profile"]',
    )
    prompt = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    icon_url = Column(String, nullable=True)
    use_pkce = Column(Boolean, nullable=False, default=True)
    use_nonce = Column(Boolean, nullable=False, default=True)
    linking_policy = Column(String, nullable=False, default="manual", server_default="manual")
    trusted_email_domains_json = Column(Text, nullable=False, default="[]", server_default="[]")
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)
