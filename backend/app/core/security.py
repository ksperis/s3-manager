# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
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
settings = get_settings()
logger = logging.getLogger(__name__)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.fernet_key, algorithm="HS256")
    return encoded_jwt


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, settings.fernet_key, algorithms=["HS256"])
    except JWTError:
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


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    secret = settings.credential_key
    return Fernet(_normalize_fernet_key(secret))


def encrypt_secret(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt secret") from exc


def is_encrypted_secret(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        _get_fernet().decrypt(value.encode())
        return True
    except InvalidToken:
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
