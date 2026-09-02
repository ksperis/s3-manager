# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from app.core.sensitive_data import sanitized_error_log_detail
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.sts_service import get_session_token
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

from ._shared import _normalize_expiration

STS_SESSION_DURATION_SECONDS = 900
STS_CACHE_TTL_BUFFER = timedelta(minutes=2)


@dataclass(frozen=True)
class CachedStsCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime


_STS_CACHE: dict[str, CachedStsCredentials] = {}
_STS_CACHE_LOCK = Lock()


class BrowserStsRequestError(RuntimeError):
    """STS provider failure after the Browser STS context was validated."""


@dataclass(frozen=True)
class BrowserStsSession:
    credentials: CachedStsCredentials
    region: Optional[str]


def _sts_cache_key(access_key: str, endpoint: str, cache_partition: Optional[str]) -> str:
    partition = (cache_partition or "shared-runtime").strip() or "shared-runtime"
    return f"{endpoint}::{access_key}::{partition}"


def _get_cached_sts_credentials(cache_key: str) -> Optional[CachedStsCredentials]:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        credentials = _STS_CACHE.get(cache_key)
        if not credentials:
            return None
        expiration = _normalize_expiration(credentials.expiration)
        if expiration - STS_CACHE_TTL_BUFFER > now:
            return credentials
        del _STS_CACHE[cache_key]
    return None


def _store_sts_credentials(cache_key: str, credentials: CachedStsCredentials) -> None:
    with _STS_CACHE_LOCK:
        _STS_CACHE[cache_key] = credentials


def browser_sts_enabled(account: S3ExecutionTarget) -> bool:
    if getattr(account, "s3_user_id", None) is not None:
        return False
    if getattr(account, "s3_connection_id", None) is not None:
        return False
    endpoint = getattr(account, "storage_endpoint", None)
    if not endpoint:
        return False
    return resolve_feature_flags(endpoint).sts_enabled


def request_browser_sts_session(
    account: S3ExecutionTarget,
    *,
    cache_partition: Optional[str] = None,
) -> BrowserStsSession:
    if not browser_sts_enabled(account):
        raise RuntimeError("STS is disabled for this endpoint")

    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise RuntimeError("S3 credentials missing for this account")

    endpoint = resolve_sts_endpoint(account.storage_endpoint) if account.storage_endpoint else None
    if not endpoint:
        raise RuntimeError("STS endpoint is not configured for this account")

    _, region, _, verify_tls = resolve_s3_client_options(account)
    cache_key = _sts_cache_key(access_key, endpoint, cache_partition)
    cached = _get_cached_sts_credentials(cache_key)
    if cached:
        return BrowserStsSession(credentials=cached, region=region)

    try:
        access, secret, token, expiration = get_session_token(
            f"browser-{account.id or access_key[:8]}",
            STS_SESSION_DURATION_SECONDS,
            access_key,
            secret_key,
            endpoint=endpoint,
            session_token=account.session_token(),
            region=region,
            verify_tls=verify_tls,
        )
    except RuntimeError as exc:
        raise BrowserStsRequestError(sanitized_error_log_detail(exc)) from exc

    credentials = CachedStsCredentials(
        access_key_id=access,
        secret_access_key=secret,
        session_token=token,
        expiration=_normalize_expiration(expiration),
    )
    _store_sts_credentials(cache_key, credentials)
    return BrowserStsSession(credentials=credentials, region=region)
