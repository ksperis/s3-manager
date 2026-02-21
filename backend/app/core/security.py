# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.types import String, TypeDecorator

from .config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)

_credential_keys_override: Optional[list[str]] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    settings = get_settings()
    expire = utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, _get_jwt_key_ring().current_key(), algorithm="HS256")
    return encoded_jwt


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    for key in _get_jwt_key_ring().all_keys():
        try:
            return jwt.decode(token, key, algorithms=["HS256"])
        except JWTError:
            continue
    return None


def _looks_like_fernet_key(value: str) -> bool:
    if len(value) != 44:
        return False
    try:
        decoded = base64.urlsafe_b64decode(value.encode())
    except Exception:
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
def _get_jwt_key_ring() -> JwtKeyRing:
    settings = get_settings()
    return JwtKeyRing(list(settings.jwt_keys))


def reset_jwt_key_ring() -> None:
    _get_jwt_key_ring.cache_clear()


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


def is_encrypted_secret(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        for fernet in _get_credential_fernets():
            try:
                fernet.decrypt(value.encode())
                return True
            except InvalidToken:
                continue
        return False
    except Exception:
        return False


class EncryptedString(TypeDecorator):
    impl = String
    cache_ok = True

    def process_bind_param(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        if is_encrypted_secret(value):
            return value
        return encrypt_secret(value)

    def process_result_value(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        try:
            return decrypt_secret(value)
        except ValueError:
            logger.warning("Encountered unencrypted secret in database; returning raw value")
            return value
