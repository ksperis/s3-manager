# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    BrowserObjectSortBy,
    BrowserObjectSortDir,
    BucketCorsRule,
    BucketCorsStatus,
    SseCustomerContext,
)
from app.services.aws_client_config import StorageRequestProfile
from app.services.s3_client import get_s3_client
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.sts_service import get_session_token
from app.utils.s3_endpoint import resolve_s3_client_kwargs, resolve_s3_client_options
from app.utils.aws_errors import aws_error_code
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

from ._shared import (
    STS_SESSION_DURATION_SECONDS,
    CachedStsCredentials,
    _BUCKET_LIST_CACHE,
    _OBJECT_LAZY_HEAD_CACHE,
    _OBJECT_LAZY_TAGS_CACHE,
    _OBJECT_LIST_CACHE,
    _OBJECT_SORT_SNAPSHOT_CACHE,
    _get_cached_sts_credentials,
    _normalize_expiration,
    _record_sts_failure,
    _resolve_endpoint,
    _store_sts_credentials,
    _sts_cache_key,
)

logger = logging.getLogger(__name__)


class BrowserContextMixin:
    def _sts_enabled(self, account: S3ExecutionTarget) -> bool:
        if getattr(account, "s3_user_id", None) is not None:
            return False
        if getattr(account, "s3_connection_id", None) is not None:
            return False
        endpoint = getattr(account, "storage_endpoint", None)
        if not endpoint:
            return False
        flags = resolve_feature_flags(endpoint)
        return flags.sts_enabled

    def _resolve_s3_credentials(self, account: S3ExecutionTarget) -> tuple[str, str, Optional[str]]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 credentials missing for this account")
        session_token = account.session_token()
        if not self._sts_enabled(account):
            return access_key, secret_key, session_token
        sts_credentials = self._get_sts_credentials(account, access_key, secret_key, session_token)
        if sts_credentials:
            return sts_credentials.access_key_id, sts_credentials.secret_access_key, sts_credentials.session_token
        return access_key, secret_key, session_token

    def _s3_client_kwargs(self, account: S3ExecutionTarget) -> dict:
        return resolve_s3_client_kwargs(account)

    def _client(self, account: S3ExecutionTarget, *, request_profile: StorageRequestProfile = "interactive"):
        access_key, secret_key, session_token = self._resolve_s3_credentials(account)
        client_options = self._s3_client_kwargs(account)
        client_options["session_token"] = session_token
        if request_profile != "interactive":
            client_options["request_profile"] = request_profile
        return get_s3_client(
            access_key,
            secret_key,
            **client_options,
        )

    def _sse_customer_params(self, sse_customer: Optional[SseCustomerContext]) -> dict[str, str]:
        if not sse_customer:
            return {}
        return {
            "SSECustomerAlgorithm": sse_customer.algorithm,
            "SSECustomerKey": sse_customer.key,
            "SSECustomerKeyMD5": sse_customer.key_md5,
        }

    def _sse_customer_headers(self, sse_customer: Optional[SseCustomerContext]) -> dict[str, str]:
        if not sse_customer:
            return {}
        return {
            "x-amz-server-side-encryption-customer-algorithm": sse_customer.algorithm,
            "x-amz-server-side-encryption-customer-key": sse_customer.key,
            "x-amz-server-side-encryption-customer-key-MD5": sse_customer.key_md5,
        }

    def _get_sts_credentials(
        self,
        account: S3ExecutionTarget,
        access_key: str,
        secret_key: str,
        session_token: Optional[str],
    ) -> Optional[CachedStsCredentials]:
        if not self._sts_enabled(account):
            return None
        endpoint = resolve_sts_endpoint(account.storage_endpoint) if account.storage_endpoint else None
        if not endpoint:
            return None
        cache_key = _sts_cache_key(access_key, endpoint)
        _, region, _, verify_tls = resolve_s3_client_options(account)
        cached = _get_cached_sts_credentials(cache_key)
        if cached:
            return cached
        try:
            session_name = f"browser-{account.id or access_key[:8]}"
            access, secret, token, expiration = get_session_token(
                session_name,
                STS_SESSION_DURATION_SECONDS,
                access_key,
                secret_key,
                endpoint=endpoint,
                session_token=session_token,
                region=region,
                verify_tls=verify_tls,
            )
        except RuntimeError as exc:
            _record_sts_failure(cache_key)
            logger.info("STS session token unavailable for account %s: %s", account.id or access_key, exc)
            return None
        normalized_expiration = _normalize_expiration(expiration)
        credentials = CachedStsCredentials(
            access_key_id=access,
            secret_access_key=secret,
            session_token=token,
            expiration=normalized_expiration,
        )
        _store_sts_credentials(cache_key, credentials)
        return credentials

    def _clean_etag(self, etag: Optional[str]) -> Optional[str]:
        if not etag:
            return None
        return etag.strip('"')

    def _account_context_kind(self, account: S3ExecutionTarget) -> str:
        context_kind = getattr(account, "context_kind", None)
        if context_kind:
            return str(context_kind)
        if getattr(account, "s3_connection_id", None) is not None:
            return "connection"
        if getattr(account, "s3_user_id", None) is not None:
            return "s3_user"
        return "account"

    def _account_cache_key(self, account: S3ExecutionTarget) -> str:
        access_key, _ = account.effective_rgw_credentials()
        if not access_key:
            raise RuntimeError("S3 credentials missing for this account")
        endpoint = _resolve_endpoint(account)
        context_kind = self._account_context_kind(account)
        return f"{endpoint}::{access_key}::{context_kind}"

    def _object_list_cache_key(
        self,
        *,
        account_cache_key: str,
        bucket_name: str,
        prefix: str,
        continuation_token: Optional[str],
        max_keys: int,
        query: Optional[str],
        query_exact: bool,
        query_case_sensitive: bool,
        item_type: str,
        storage_class: Optional[str],
        recursive: bool,
    ) -> tuple:
        return (
            account_cache_key,
            bucket_name,
            prefix,
            continuation_token or "",
            max_keys,
            (query or "").strip(),
            bool(query_exact),
            bool(query_case_sensitive),
            item_type,
            storage_class or "",
            bool(recursive),
        )

    def _object_sort_snapshot_cache_key(
        self,
        *,
        account_cache_key: str,
        bucket_name: str,
        prefix: str,
        query: Optional[str],
        query_exact: bool,
        query_case_sensitive: bool,
        item_type: str,
        storage_class: Optional[str],
        recursive: bool,
        sort_by: BrowserObjectSortBy,
        sort_dir: BrowserObjectSortDir,
    ) -> tuple:
        return (
            account_cache_key,
            bucket_name,
            prefix,
            (query or "").strip(),
            bool(query_exact),
            bool(query_case_sensitive),
            item_type,
            storage_class or "",
            bool(recursive),
            sort_by,
            sort_dir,
        )

    def _object_lazy_head_cache_key(
        self,
        *,
        account_cache_key: str,
        bucket_name: str,
        key: str,
        sse_customer: Optional[SseCustomerContext],
    ) -> tuple:
        return (
            account_cache_key,
            bucket_name,
            key,
            "head",
            getattr(sse_customer, "key_md5", "") or "",
        )

    def _object_lazy_tags_cache_key(
        self,
        *,
        account_cache_key: str,
        bucket_name: str,
        key: str,
    ) -> tuple:
        return (
            account_cache_key,
            bucket_name,
            key,
            "tags",
        )

    def _normalize_datetime_value(self, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        return _normalize_expiration(value)

    def _normalize_restore_status(self, value: object) -> Optional[str]:
        text = str(value or "").strip()
        if not text:
            return None
        if 'ongoing-request="true"' in text:
            return "In progress"
        match = re.search(r'expiry-date="([^"]+)"', text)
        if not match:
            return None
        try:
            expires_at = datetime.strptime(match.group(1), "%a, %d %b %Y %H:%M:%S %Z")
            expires_at = expires_at.replace(tzinfo=timezone.utc)
            return f"Restored until {expires_at.isoformat()}"
        except ValueError:
            return "Restored"

    def invalidate_bucket_list_cache(self, account_key: str) -> None:
        if not account_key:
            return
        removed = _BUCKET_LIST_CACHE.invalidate_where(lambda key: key == account_key)
        if removed > 0:
            logger.debug("Browser bucket cache invalidated: account=%s entries=%s", account_key, removed)

    def invalidate_object_list_cache(self, account_key: str, bucket_name: str) -> None:
        if not account_key or not bucket_name:
            return
        removed = _OBJECT_LIST_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == account_key and key[1] == bucket_name
        )
        removed += _OBJECT_SORT_SNAPSHOT_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == account_key and key[1] == bucket_name
        )
        removed += _OBJECT_LAZY_HEAD_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == account_key and key[1] == bucket_name
        )
        removed += _OBJECT_LAZY_TAGS_CACHE.invalidate_where(
            lambda key: len(key) >= 2 and key[0] == account_key and key[1] == bucket_name
        )
        if removed > 0:
            logger.debug("Browser object cache invalidated: account=%s bucket=%s entries=%s", account_key, bucket_name, removed)

    def invalidate_bucket_list_cache_for_account(self, account: S3ExecutionTarget) -> None:
        try:
            account_key = self._account_cache_key(account)
        except RuntimeError:
            return
        self.invalidate_bucket_list_cache(account_key)

    def invalidate_object_list_cache_for_account(self, account: S3ExecutionTarget, bucket_name: str) -> None:
        if not bucket_name:
            return
        try:
            account_key = self._account_cache_key(account)
        except RuntimeError:
            return
        self.invalidate_object_list_cache(account_key, bucket_name)

    def get_bucket_cors_status(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        origin: Optional[str] = None,
    ) -> BucketCorsStatus:
        client = self._client(account)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            code = aws_error_code(exc)
            if code in {"NoSuchCORSConfiguration", "NoSuchCORS"}:
                return BucketCorsStatus(enabled=False, rules=[])
            return BucketCorsStatus(enabled=False, rules=[], error=str(exc))
        rules = []
        raw_rules = resp.get("CORSRules", []) or []
        enabled = bool(raw_rules)
        for rule in resp.get("CORSRules", []) or []:
            rules.append(
                BucketCorsRule(
                    allowed_origins=rule.get("AllowedOrigins") or [],
                    allowed_methods=rule.get("AllowedMethods") or [],
                    allowed_headers=rule.get("AllowedHeaders") or [],
                    expose_headers=rule.get("ExposeHeaders") or [],
                    max_age_seconds=rule.get("MaxAgeSeconds"),
                )
            )
        if origin and raw_rules:
            required_methods = {"GET", "PUT", "POST", "HEAD"}

            def matches_header(allowed_headers: list[str], header: str) -> bool:
                header = header.lower()
                for entry in allowed_headers:
                    entry_lower = entry.lower()
                    if entry_lower == "*" or entry_lower == header:
                        return True
                    if entry_lower.endswith("*") and header.startswith(entry_lower[:-1]):
                        return True
                return False

            def rule_allows(rule: dict) -> bool:
                allowed_origins = {o for o in (rule.get("AllowedOrigins") or [])}
                if "*" not in allowed_origins and origin not in allowed_origins:
                    return False
                allowed_methods = {m.upper() for m in (rule.get("AllowedMethods") or [])}
                if not required_methods.issubset(allowed_methods):
                    return False
                allowed_headers = rule.get("AllowedHeaders") or []
                if allowed_headers:
                    return matches_header(allowed_headers, "content-type")
                return False

            enabled = any(rule_allows(rule) for rule in raw_rules)
        return BucketCorsStatus(enabled=enabled, rules=rules)

    def ensure_bucket_cors(self, bucket_name: str, account: S3ExecutionTarget, origin: str) -> BucketCorsStatus:
        if not origin:
            raise RuntimeError("Missing origin")
        client = self._client(account)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
            rules = resp.get("CORSRules", []) or []
        except (ClientError, BotoCoreError) as exc:
            code = aws_error_code(exc)
            if code in {"NoSuchCORSConfiguration", "NoSuchCORS"}:
                rules = []
            else:
                raise RuntimeError(f"Unable to fetch CORS for '{bucket_name}': {exc}") from exc

        desired_methods = {"GET", "PUT", "POST", "DELETE", "HEAD"}
        desired_headers = {"Content-Type", "x-amz-*"}
        desired_expose = {"ETag", "x-amz-request-id", "x-amz-id-2"}

        def normalize(values: list[str]) -> list[str]:
            seen = set()
            ordered = []
            for value in values:
                if value not in seen:
                    seen.add(value)
                    ordered.append(value)
            return ordered

        def update_rule(rule: dict) -> bool:
            changed = False
            allowed_origins = rule.get("AllowedOrigins") or []
            if origin not in allowed_origins and "*" not in allowed_origins:
                allowed_origins.append(origin)
                rule["AllowedOrigins"] = normalize(allowed_origins)
                changed = True
            allowed_methods = {m.upper() for m in (rule.get("AllowedMethods") or [])}
            if not desired_methods.issubset(allowed_methods):
                merged_methods = normalize([*allowed_methods, *desired_methods])
                rule["AllowedMethods"] = merged_methods
                changed = True
            allowed_headers = set(rule.get("AllowedHeaders") or [])
            if not allowed_headers:
                rule["AllowedHeaders"] = sorted(desired_headers)
                changed = True
            elif "*" in allowed_headers:
                rule["AllowedHeaders"] = sorted(desired_headers)
                changed = True
            elif not desired_headers.issubset(allowed_headers):
                merged_headers = normalize([*allowed_headers, *desired_headers])
                rule["AllowedHeaders"] = merged_headers
                changed = True
            expose_headers = set(rule.get("ExposeHeaders") or [])
            if not desired_expose.issubset(expose_headers):
                merged_expose = normalize([*expose_headers, *desired_expose])
                rule["ExposeHeaders"] = merged_expose
                changed = True
            if rule.get("MaxAgeSeconds") is None:
                rule["MaxAgeSeconds"] = 3000
                changed = True
            return changed

        updated = False
        matched = False
        for rule in rules:
            allowed_origins = set(rule.get("AllowedOrigins") or [])
            if "*" in allowed_origins or origin in allowed_origins:
                matched = True
                if update_rule(rule):
                    updated = True
                break

        if not matched:
            new_rule = {
                "AllowedOrigins": [origin],
                "AllowedMethods": sorted(desired_methods),
                "AllowedHeaders": sorted(desired_headers),
                "ExposeHeaders": sorted(desired_expose),
                "MaxAgeSeconds": 3000,
            }
            rules.append(new_rule)
            updated = True

        if updated:
            try:
                client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration={"CORSRules": rules})
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to update CORS for '{bucket_name}': {exc}") from exc

        return self.get_bucket_cors_status(bucket_name, account, origin=origin)
