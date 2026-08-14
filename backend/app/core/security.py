# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import binascii
import hashlib
import secrets
from datetime import timedelta
from functools import lru_cache
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy.types import String, TypeDecorator

from app.utils.time import utcnow

from .config import get_settings

password_hash = PasswordHash((Argon2Hasher(), BcryptHasher()))
dummy_password_hash = PasswordHash((Argon2Hasher(),)).hash("not-a-real-password-value")

_credential_keys_override: Optional[list[str]] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def verify_and_update_password(plain_password: str, hashed_password: str) -> tuple[bool, Optional[str]]:
    return password_hash.verify_and_update(plain_password, hashed_password)


def consume_dummy_password_hash(plain_password: str) -> None:
    password_hash.verify(plain_password or "", dummy_password_hash)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


def _kid_for_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _create_typed_token(
    data: Dict[str, Any],
    *,
    token_type: str,
    audience: str,
    key_ring: "JwtKeyRing",
    expires_delta: timedelta,
) -> str:
    settings = get_settings()
    now = utcnow()
    key = key_ring.current_key()
    claims = data.copy()
    claims.update(
        {
            "typ": token_type,
            "iss": settings.jwt_issuer,
            "aud": audience,
            "iat": now,
            "nbf": now,
            "exp": now + expires_delta,
            "jti": claims.get("jti") or secrets.token_hex(16),
        }
    )
    required = {"sub", "sid", "auth_version"}
    missing = sorted(field for field in required if claims.get(field) is None)
    if missing:
        raise ValueError(f"Missing typed JWT claim(s): {', '.join(missing)}")
    return jwt.encode(
        claims,
        key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": _kid_for_key(key), "typ": token_type},
    )


def create_ui_access_token(*, user_id: int, session_id: str, auth_version: int, role: str) -> str:
    settings = get_settings()
    return _create_typed_token(
        {"sub": f"user:{user_id}", "uid": user_id, "sid": session_id, "auth_version": auth_version, "role": role},
        token_type="ui_access",
        audience=settings.ui_jwt_audience,
        key_ring=_get_ui_jwt_key_ring(),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_s3_access_token(*, s3_session_id: str, auth_session_id: str) -> str:
    settings = get_settings()
    return _create_typed_token(
        {"sub": f"s3:{s3_session_id}", "sid": auth_session_id, "s3_sid": s3_session_id, "auth_version": 1},
        token_type="s3_access",
        audience=settings.ui_jwt_audience,
        key_ring=_get_ui_jwt_key_ring(),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_api_access_token(
    *,
    user_id: int,
    token_id: str,
    auth_version: int,
    role: str,
    scopes: list[str],
    expires_delta: timedelta,
    jti: str,
) -> str:
    settings = get_settings()
    return _create_typed_token(
        {
            "sub": f"user:{user_id}",
            "uid": user_id,
            "sid": token_id,
            "auth_version": auth_version,
            "role": role,
            "scopes": scopes,
            "jti": jti,
        },
        token_type="api_access",
        audience=settings.api_jwt_audience,
        key_ring=_get_api_jwt_key_ring(),
        expires_delta=expires_delta,
    )


def create_pre_auth_token(*, user_id: int, session_id: str, auth_version: int, purpose: str) -> str:
    settings = get_settings()
    return _create_typed_token(
        {"sub": f"user:{user_id}", "uid": user_id, "sid": session_id, "auth_version": auth_version, "purpose": purpose},
        token_type="pre_auth",
        audience=settings.pre_auth_jwt_audience,
        key_ring=_get_ui_jwt_key_ring(),
        expires_delta=timedelta(minutes=settings.pre_auth_expire_minutes),
    )


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equal(value: Optional[str], expected: Optional[str]) -> bool:
    if value is None or expected is None:
        return False
    return secrets.compare_digest(value, expected)


def decode_typed_token(token: str, *, expected_type: str) -> Optional[Dict[str, Any]]:
    settings = get_settings()
    if expected_type == "api_access":
        key_ring = _get_api_jwt_key_ring()
        audience = settings.api_jwt_audience
    elif expected_type == "pre_auth":
        key_ring = _get_ui_jwt_key_ring()
        audience = settings.pre_auth_jwt_audience
    else:
        key_ring = _get_ui_jwt_key_ring()
        audience = settings.ui_jwt_audience
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        return None
    if header.get("typ") != expected_type or header.get("alg") != settings.jwt_algorithm:
        return None
    kid = header.get("kid")
    keys = [key for key in key_ring.all_keys() if _kid_for_key(key) == kid]
    if len(keys) != 1:
        return None
    for key in keys:
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[settings.jwt_algorithm],
                audience=audience,
                issuer=settings.jwt_issuer,
                options={"require_sub": True, "require_iat": True, "require_nbf": True, "require_exp": True, "require_jti": True},
            )
            if claims.get("typ") != expected_type or not claims.get("sid") or claims.get("auth_version") is None:
                return None
            return claims
        except JWTError:
            continue
    return None


def _looks_like_fernet_key(value: str) -> bool:
    if len(value) != 44:
        return False
    try:
        decoded = base64.urlsafe_b64decode(value.encode())
    except (ValueError, binascii.Error):
        return False
    return len(decoded) == 32


def _normalize_fernet_key(value: str) -> bytes:
    key = value.strip()
    if _looks_like_fernet_key(key):
        return key.encode()
    return base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest())


class JwtKeyRing:
    def __init__(self, keys: list[str]) -> None:
        self._keys = [key for key in keys if key]
        if not self._keys:
            raise ValueError("JWT key ring is empty")

    def current_key(self) -> str:
        return self._keys[0]

    def all_keys(self) -> list[str]:
        return list(self._keys)


@lru_cache(maxsize=1)
def _get_ui_jwt_key_ring() -> JwtKeyRing:
    settings = get_settings()
    return JwtKeyRing(settings.effective_ui_jwt_keys())


@lru_cache(maxsize=1)
def _get_api_jwt_key_ring() -> JwtKeyRing:
    settings = get_settings()
    return JwtKeyRing(settings.effective_api_jwt_keys())


def clear_jwt_key_ring_cache() -> None:
    _get_ui_jwt_key_ring.cache_clear()
    _get_api_jwt_key_ring.cache_clear()


def _get_credential_keys() -> list[str]:
    if _credential_keys_override is not None:
        return list(_credential_keys_override)
    return list(get_settings().credential_keys)


def set_credential_keys_override(keys: list[str]) -> None:
    global _credential_keys_override
    _credential_keys_override = list(keys)
    _get_credential_fernets.cache_clear()


def clear_credential_keys_override() -> None:
    global _credential_keys_override
    _credential_keys_override = None
    _get_credential_fernets.cache_clear()


@lru_cache(maxsize=1)
def _get_credential_fernets() -> tuple[Fernet, ...]:
    keys = _get_credential_keys()
    if not keys:
        raise ValueError("Credential key ring is empty")
    return tuple(Fernet(_normalize_fernet_key(key)) for key in keys)


def encrypt_secret(value: str) -> str:
    return _get_credential_fernets()[0].encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str:
    for fernet in _get_credential_fernets():
        try:
            return fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            continue
    raise ValueError("Unable to decrypt secret")


class EncryptedString(TypeDecorator):
    impl = String
    cache_ok = True

    def process_bind_param(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        return encrypt_secret(value)

    def process_result_value(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        return decrypt_secret(value)
