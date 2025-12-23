# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import requests
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import OIDCProviderSettings, Settings, get_settings
from app.db_models import OidcLoginState
from app.services.users_service import UsersService, get_users_service

LOGGER = logging.getLogger(__name__)
REQUEST_TIMEOUT = 10


class OIDCError(Exception):
    """Base class for OIDC exceptions."""


class OIDCProviderNotFoundError(OIDCError):
    """Raised when a provider is missing or disabled."""


class OIDCConfigurationError(OIDCError):
    """Raised when the provider configuration is invalid."""


class OIDCStateError(OIDCError):
    """Raised when the OIDC state/nonce is invalid or expired."""


class OIDCAuthenticationError(OIDCError):
    """Raised when the provider rejects the authentication attempt."""


class OidcService:
    def __init__(
        self,
        db: Session,
        users_service: UsersService,
        settings: Optional[Settings] = None,
    ) -> None:
        self.db = db
        self.users_service = users_service
        self.settings = settings or get_settings()
        self._metadata_cache: dict[str, tuple[dict[str, Any], float]] = {}
        self._jwks_cache: dict[str, tuple[dict[str, Any], float]] = {}

    def list_providers(self) -> list[dict[str, Any]]:
        providers = []
        for key, provider in self._provider_map().items():
            if provider.enabled:
                providers.append(
                    {
                        "id": key,
                        "display_name": provider.display_name,
                        "icon_url": provider.icon_url,
                    }
                )
        return providers

    def start_login(self, provider_id: str, redirect_path: Optional[str]) -> dict[str, str]:
        provider_key, provider = self._get_provider(provider_id)
        metadata = self._get_metadata(provider_key, provider)
        authorization_endpoint = metadata.get("authorization_endpoint")
        if not authorization_endpoint:
            raise OIDCConfigurationError("Provider does not expose an authorization endpoint")
        self._purge_expired_states()
        state_token = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(16) if provider.use_nonce else None
        code_verifier = secrets.token_urlsafe(64)
        params = {
            "response_type": "code",
            "client_id": provider.client_id,
            "redirect_uri": provider.redirect_uri,
            "scope": " ".join(provider.scopes),
            "state": state_token,
        }
        if provider.use_nonce and nonce:
            params["nonce"] = nonce
        if provider.prompt:
            params["prompt"] = provider.prompt
        if provider.use_pkce:
            params["code_challenge_method"] = "S256"
            params["code_challenge"] = self._build_code_challenge(code_verifier)

        record = OidcLoginState(
            state=state_token,
            provider=provider_key,
            code_verifier=code_verifier,
            nonce=nonce,
            redirect_path=redirect_path,
        )
        self.db.add(record)
        self.db.commit()

        url = f"{authorization_endpoint}?{urlencode(params)}"
        return {
            "provider": provider_key,
            "authorization_url": url,
            "state": state_token,
        }

    def complete_login(self, provider_id: str, code: str, state: str):
        provider_key, provider = self._get_provider(provider_id)
        login_state = self.db.query(OidcLoginState).filter(OidcLoginState.state == state).first()
        if not login_state or login_state.provider != provider_key:
            raise OIDCStateError("Invalid OIDC state")
        ttl = timedelta(seconds=self.settings.oidc_state_ttl_seconds)
        if login_state.created_at < datetime.utcnow() - ttl:
            self.db.delete(login_state)
            self.db.commit()
            raise OIDCStateError("OIDC state expired")

        metadata = self._get_metadata(provider_key, provider)
        token_endpoint = metadata.get("token_endpoint")
        if not token_endpoint:
            raise OIDCConfigurationError("Provider does not expose a token endpoint")

        token_request = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": provider.redirect_uri,
            "client_id": provider.client_id,
        }
        if provider.use_pkce:
            token_request["code_verifier"] = login_state.code_verifier
        if provider.client_secret:
            token_request["client_secret"] = provider.client_secret
        try:
            response = requests.post(
                token_endpoint,
                data=token_request,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as exc:
            raise OIDCAuthenticationError("Unable to reach token endpoint") from exc

        if response.status_code >= 400:
            LOGGER.warning("OIDC token endpoint error status=%s body=%s", response.status_code, response.text)
            raise OIDCAuthenticationError("OIDC token exchange failed")
        token_payload = response.json()
        id_token = token_payload.get("id_token")
        if not id_token:
            raise OIDCAuthenticationError("Provider did not return an ID token")

        claims = self._decode_id_token(
            provider_key,
            provider,
            metadata,
            id_token,
            login_state.nonce,
            token_payload.get("access_token"),
        )
        subject = claims.get("sub")
        if not subject:
            raise OIDCAuthenticationError("OIDC token missing subject claim")
        email = claims.get("email")
        email_verified = claims.get("email_verified")
        if email_verified is False:
            raise OIDCAuthenticationError("Email is not verified for this provider")
        full_name = claims.get("name") or claims.get("given_name")
        picture_url = claims.get("picture")

        if not email and token_payload.get("access_token") and metadata.get("userinfo_endpoint"):
            email = self._fetch_userinfo_email(metadata["userinfo_endpoint"], token_payload["access_token"])

        try:
            user, created = self.users_service.get_or_create_oidc_user(
                provider=provider_key,
                subject=subject,
                email=email,
                full_name=full_name,
                picture_url=picture_url,
            )
        finally:
            self.db.delete(login_state)
            self.db.commit()

        user = self.users_service.mark_last_login(user)
        return user, login_state.redirect_path, created

    def _provider_map(self) -> dict[str, OIDCProviderSettings]:
        return {key.lower(): value for key, value in self.settings.oidc_providers.items()}

    def _get_provider(self, provider_id: str) -> tuple[str, OIDCProviderSettings]:
        provider_key = provider_id.lower()
        provider = self._provider_map().get(provider_key)
        if not provider or not provider.enabled:
            raise OIDCProviderNotFoundError("OIDC provider not found")
        return provider_key, provider

    def _get_metadata(self, provider_key: str, provider: OIDCProviderSettings) -> dict[str, Any]:
        cached = self._metadata_cache.get(provider_key)
        now = time.time()
        if cached and cached[1] > now:
            return cached[0]
        try:
            response = requests.get(provider.discovery_url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise OIDCConfigurationError("Failed to fetch OIDC discovery document") from exc
        metadata = response.json()
        self._metadata_cache[provider_key] = (metadata, now + 3600)
        return metadata

    def _get_jwks(self, jwks_uri: str) -> dict[str, Any]:
        cached = self._jwks_cache.get(jwks_uri)
        now = time.time()
        if cached and cached[1] > now:
            return cached[0]
        try:
            response = requests.get(jwks_uri, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise OIDCConfigurationError("Failed to download provider keys") from exc
        jwks_data = response.json()
        self._jwks_cache[jwks_uri] = (jwks_data, now + 3600)
        return jwks_data

    def _decode_id_token(
        self,
        provider_key: str,
        provider: OIDCProviderSettings,
        metadata: dict[str, Any],
        id_token: str,
        expected_nonce: Optional[str],
        access_token: Optional[str],
    ) -> Dict[str, Any]:
        header = jwt.get_unverified_header(id_token)
        jwks_uri = metadata.get("jwks_uri")
        if not jwks_uri:
            raise OIDCConfigurationError("Provider does not expose a JWKS endpoint")
        jwks = self._get_jwks(jwks_uri)
        kid = header.get("kid")
        key = None
        for candidate in jwks.get("keys", []):
            if candidate.get("kid") == kid or kid is None:
                key = candidate
                break
        if not key:
            raise OIDCAuthenticationError("Unable to find a matching signing key")
        try:
            claims = jwt.decode(
                id_token,
                key,
                algorithms=[header.get("alg", "RS256")],
                audience=provider.client_id,
                issuer=metadata.get("issuer"),
                access_token=access_token,
            )
        except JWTError as exc:
            raise OIDCAuthenticationError("Invalid ID token") from exc
        if expected_nonce and claims.get("nonce") != expected_nonce:
            raise OIDCStateError("Nonce mismatch detected")
        return claims

    def _fetch_userinfo_email(self, userinfo_endpoint: str, access_token: str) -> Optional[str]:
        try:
            response = requests.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException:
            return None
        payload = response.json()
        email = payload.get("email")
        if payload.get("email_verified") is False:
            return None
        return email

    def _build_code_challenge(self, code_verifier: str) -> str:
        digest = hashlib.sha256(code_verifier.encode()).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    def _purge_expired_states(self) -> None:
        cutoff = datetime.utcnow() - timedelta(seconds=self.settings.oidc_state_ttl_seconds)
        self.db.query(OidcLoginState).filter(OidcLoginState.created_at < cutoff).delete()
        self.db.commit()


def get_oidc_service(db: Session) -> OidcService:
    users_service = get_users_service(db)
    return OidcService(db, users_service)
