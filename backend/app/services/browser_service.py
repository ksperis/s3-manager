# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.db import S3Account
from app.models.browser import (
    BrowserBucket,
    BrowserObject,
    BrowserObjectVersion,
    BucketCorsRule,
    BucketCorsStatus,
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartPart,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    MultipartUploadItem,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectTag,
    ObjectAcl,
    ObjectLegalHold,
    ObjectRetention,
    ObjectRestoreRequest,
    ObjectTags,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    StsStatus,
    BrowserStsCredentials,
)
from app.services.s3_client import _delete_objects, get_s3_client
from app.services.sts_service import get_session_token
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint

logger = logging.getLogger(__name__)
settings = get_settings()

STS_SESSION_DURATION_SECONDS = 3600
STS_CACHE_TTL_BUFFER = timedelta(minutes=5)
STS_FAILURE_TTL = timedelta(seconds=60)


@dataclass(frozen=True)
class CachedStsCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime


@dataclass
class StsCacheEntry:
    credentials: Optional[CachedStsCredentials] = None
    failed_until: Optional[datetime] = None


_STS_CACHE: dict[str, StsCacheEntry] = {}
_STS_CACHE_LOCK = Lock()


def _resolve_endpoint(account: S3Account) -> str:
    endpoint = resolve_s3_endpoint(account)
    if not endpoint:
        raise RuntimeError("S3 endpoint is not configured for this account")
    return endpoint


def _sts_cache_key(access_key: str, endpoint: str) -> str:
    return f"{endpoint}::{access_key}"


def _normalize_expiration(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _get_cached_sts_credentials(cache_key: str) -> Optional[CachedStsCredentials]:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        entry = _STS_CACHE.get(cache_key)
        if not entry:
            return None
        if entry.credentials:
            expiration = _normalize_expiration(entry.credentials.expiration)
            if expiration - STS_CACHE_TTL_BUFFER > now:
                return entry.credentials
            entry.credentials = None
        if entry.failed_until and entry.failed_until > now:
            return None
        if entry.failed_until and entry.failed_until <= now:
            entry.failed_until = None
    return None


def _store_sts_credentials(cache_key: str, credentials: CachedStsCredentials) -> None:
    with _STS_CACHE_LOCK:
        _STS_CACHE[cache_key] = StsCacheEntry(credentials=credentials, failed_until=None)


def _record_sts_failure(cache_key: str) -> None:
    now = datetime.now(tz=timezone.utc)
    with _STS_CACHE_LOCK:
        entry = _STS_CACHE.get(cache_key) or StsCacheEntry()
        entry.credentials = None
        entry.failed_until = now + STS_FAILURE_TTL
        _STS_CACHE[cache_key] = entry


class BrowserService:
    def _sts_enabled(self, account: S3Account) -> bool:
        if getattr(account, "s3_user_id", None) is not None:
            return False
        if getattr(account, "s3_connection_id", None) is not None:
            return False
        endpoint = getattr(account, "storage_endpoint", None)
        if not endpoint:
            return False
        flags = resolve_feature_flags(endpoint)
        return flags.sts_enabled

    def _resolve_s3_credentials(self, account: S3Account) -> tuple[str, str, Optional[str]]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 credentials missing for this account")
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        if not self._sts_enabled(account):
            return access_key, secret_key, session_token
        sts_credentials = self._get_sts_credentials(account, access_key, secret_key, session_token)
        if sts_credentials:
            return sts_credentials.access_key_id, sts_credentials.secret_access_key, sts_credentials.session_token
        return access_key, secret_key, session_token

    def _client(self, account: S3Account):
        access_key, secret_key, session_token = self._resolve_s3_credentials(account)
        return get_s3_client(
            access_key,
            secret_key,
            endpoint=_resolve_endpoint(account),
            session_token=session_token,
        )

    def _get_sts_credentials(
        self,
        account: S3Account,
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

    def get_bucket_cors_status(
        self,
        bucket_name: str,
        account: S3Account,
        origin: Optional[str] = None,
    ) -> BucketCorsStatus:
        client = self._client(account)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            code = None
            if isinstance(exc, ClientError):
                code = exc.response.get("Error", {}).get("Code")
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

    def ensure_bucket_cors(self, bucket_name: str, account: S3Account, origin: str) -> BucketCorsStatus:
        if not origin:
            raise RuntimeError("Missing origin")
        client = self._client(account)
        try:
            resp = client.get_bucket_cors(Bucket=bucket_name)
            rules = resp.get("CORSRules", []) or []
        except (ClientError, BotoCoreError) as exc:
            code = None
            if isinstance(exc, ClientError):
                code = exc.response.get("Error", {}).get("Code")
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

    def check_sts(self, account: S3Account) -> StsStatus:
        if not self._sts_enabled(account):
            return StsStatus(available=False, error="STS is disabled for this endpoint")
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            return StsStatus(available=False, error="S3 credentials missing for this account")
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        endpoint = resolve_sts_endpoint(account.storage_endpoint) if account.storage_endpoint else None
        if not endpoint:
            return StsStatus(available=False, error="STS endpoint is not configured for this account")
        cache_key = _sts_cache_key(access_key, endpoint)
        cached = _get_cached_sts_credentials(cache_key)
        if cached:
            return StsStatus(available=True)
        try:
            session_name = f"browser-{account.id or access_key[:8]}"
            access, secret, token, expiration = get_session_token(
                session_name,
                STS_SESSION_DURATION_SECONDS,
                access_key,
                secret_key,
                endpoint=endpoint,
                session_token=session_token,
            )
        except RuntimeError as exc:
            _record_sts_failure(cache_key)
            return StsStatus(available=False, error=str(exc))
        normalized_expiration = _normalize_expiration(expiration)
        credentials = CachedStsCredentials(
            access_key_id=access,
            secret_access_key=secret,
            session_token=token,
            expiration=normalized_expiration,
        )
        _store_sts_credentials(cache_key, credentials)
        return StsStatus(available=True)

    def get_sts_credentials(self, account: S3Account) -> BrowserStsCredentials:
        if not self._sts_enabled(account):
            raise RuntimeError("STS is disabled for this endpoint")
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 credentials missing for this account")
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        endpoint = resolve_sts_endpoint(account.storage_endpoint) if account.storage_endpoint else None
        if not endpoint:
            raise RuntimeError("STS endpoint is not configured for this account")
        cache_key = _sts_cache_key(access_key, endpoint)
        cached = _get_cached_sts_credentials(cache_key)
        if cached:
            return BrowserStsCredentials(
                access_key_id=cached.access_key_id,
                secret_access_key=cached.secret_access_key,
                session_token=cached.session_token,
                expiration=_normalize_expiration(cached.expiration),
                endpoint=_resolve_endpoint(account),
                region=settings.seed_s3_region,
            )
        try:
            session_name = f"browser-{account.id or access_key[:8]}"
            access, secret, token, expiration = get_session_token(
                session_name,
                STS_SESSION_DURATION_SECONDS,
                access_key,
                secret_key,
                endpoint=endpoint,
                session_token=session_token,
            )
        except RuntimeError as exc:
            _record_sts_failure(cache_key)
            raise RuntimeError(f"Unable to request STS credentials: {exc}") from exc
        normalized_expiration = _normalize_expiration(expiration)
        credentials = CachedStsCredentials(
            access_key_id=access,
            secret_access_key=secret,
            session_token=token,
            expiration=normalized_expiration,
        )
        _store_sts_credentials(cache_key, credentials)
        return BrowserStsCredentials(
            access_key_id=access,
            secret_access_key=secret,
            session_token=token,
            expiration=normalized_expiration,
            endpoint=_resolve_endpoint(account),
            region=settings.seed_s3_region,
        )

    def proxy_upload(self, bucket_name: str, account: S3Account, key: str, file_obj, content_type: Optional[str]) -> None:
        client = self._client(account)
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        try:
            file_obj.seek(0)
            if extra_args:
                client.upload_fileobj(file_obj, bucket_name, key, ExtraArgs=extra_args)
            else:
                client.upload_fileobj(file_obj, bucket_name, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to upload '{key}': {exc}") from exc

    def proxy_download(self, bucket_name: str, account: S3Account, key: str):
        client = self._client(account)
        try:
            return client.get_object(Bucket=bucket_name, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to download '{key}': {exc}") from exc

    def list_buckets(self, account: S3Account) -> list[BrowserBucket]:
        client = self._client(account)
        try:
            resp = client.list_buckets()
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list buckets: {exc}") from exc
        buckets: list[BrowserBucket] = []
        for bucket in resp.get("Buckets", []):
            name = bucket.get("Name")
            if not name:
                continue
            buckets.append(BrowserBucket(name=name, creation_date=bucket.get("CreationDate")))
        return buckets

    def list_objects(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
        query: Optional[str] = None,
        item_type: Optional[str] = None,
        storage_class: Optional[str] = None,
        recursive: bool = False,
    ) -> ListBrowserObjectsResponse:
        client = self._client(account)
        normalized_prefix = prefix or ""
        query_value = (query or "").strip().lower()
        type_filter = (item_type or "all").lower()
        if type_filter not in {"all", "file", "folder"}:
            type_filter = "all"
        storage_filter = (storage_class or "").strip() or None

        def matches_query(value: str) -> bool:
            if not query_value:
                return True
            relative = value
            if normalized_prefix and relative.startswith(normalized_prefix):
                relative = relative[len(normalized_prefix):]
            if relative.endswith("/"):
                relative = relative[:-1]
            return query_value in relative.lower()

        kwargs = {
            "Bucket": bucket_name,
            "Prefix": normalized_prefix,
            "MaxKeys": max_keys,
        }
        if not recursive:
            kwargs["Delimiter"] = "/"
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        try:
            resp = client.list_objects_v2(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc
        objects: list[BrowserObject] = []
        for obj in resp.get("Contents", []):
            if type_filter == "folder":
                continue
            key = obj.get("Key")
            if not key:
                continue
            if prefix and key.rstrip("/") == prefix.rstrip("/") and obj.get("Size", 0) == 0:
                continue
            if not matches_query(key):
                continue
            storage = obj.get("StorageClass")
            if storage_filter and storage != storage_filter:
                continue
            objects.append(
                BrowserObject(
                    key=key,
                    size=int(obj.get("Size") or 0),
                    last_modified=obj.get("LastModified"),
                    storage_class=storage,
                    etag=self._clean_etag(obj.get("ETag")),
                )
            )
        prefixes = []
        if not recursive and type_filter != "file":
            for entry in resp.get("CommonPrefixes", []) or []:
                prefix_value = entry.get("Prefix")
                if not prefix_value:
                    continue
                if not matches_query(prefix_value):
                    continue
                prefixes.append(prefix_value)
        return ListBrowserObjectsResponse(
            prefix=prefix,
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(resp.get("IsTruncated")),
            next_continuation_token=resp.get("NextContinuationToken"),
        )

    def list_object_versions(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str = "",
        key: Optional[str] = None,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectVersionsResponse:
        client = self._client(account)
        filter_key = (key or "").strip() or None
        query_prefix = filter_key or (prefix or "")
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": query_prefix,
            "MaxKeys": max_keys,
        }
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        try:
            resp = client.list_object_versions(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list object versions for '{bucket_name}': {exc}") from exc
        versions: list[BrowserObjectVersion] = []
        delete_markers: list[BrowserObjectVersion] = []
        for ver in resp.get("Versions", []):
            key = ver.get("Key")
            if not key:
                continue
            if filter_key and key != filter_key:
                continue
            versions.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=ver.get("VersionId"),
                    is_latest=bool(ver.get("IsLatest")),
                    last_modified=ver.get("LastModified"),
                    size=int(ver.get("Size") or 0),
                    etag=self._clean_etag(ver.get("ETag")),
                    storage_class=ver.get("StorageClass"),
                )
            )
        for marker in resp.get("DeleteMarkers", []):
            key = marker.get("Key")
            if not key:
                continue
            if filter_key and key != filter_key:
                continue
            delete_markers.append(
                BrowserObjectVersion(
                    key=key,
                    version_id=marker.get("VersionId"),
                    is_latest=bool(marker.get("IsLatest")),
                    is_delete_marker=True,
                    last_modified=marker.get("LastModified"),
                )
            )
        response_prefix = filter_key or (prefix or None)
        return ListObjectVersionsResponse(
            prefix=response_prefix,
            versions=versions,
            delete_markers=delete_markers,
            is_truncated=bool(resp.get("IsTruncated")),
            key_marker=resp.get("KeyMarker"),
            version_id_marker=resp.get("VersionIdMarker"),
            next_key_marker=resp.get("NextKeyMarker"),
            next_version_id_marker=resp.get("NextVersionIdMarker"),
        )

    def cleanup_object_versions(
        self,
        bucket_name: str,
        account: S3Account,
        payload: CleanupObjectVersionsPayload,
    ) -> CleanupObjectVersionsResponse:
        if not (payload.keep_last_n or payload.older_than_days or payload.delete_orphan_markers):
            raise ValueError("No cleanup criteria provided.")
        client = self._client(account)
        prefix = payload.prefix or ""
        cutoff = None
        if payload.older_than_days:
            cutoff = datetime.now(timezone.utc) - timedelta(days=payload.older_than_days)

        def normalize(value: Optional[datetime]) -> Optional[datetime]:
            if not value:
                return None
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)

        try:
            versions_by_key: dict[str, list[dict]] = {}
            scanned_versions = 0
            scanned_delete_markers = 0
            key_marker = None
            version_marker = None
            while True:
                list_kwargs = {"Bucket": bucket_name, "Prefix": prefix}
                if key_marker:
                    list_kwargs["KeyMarker"] = key_marker
                if version_marker:
                    list_kwargs["VersionIdMarker"] = version_marker
                resp = client.list_object_versions(**list_kwargs)
                for version in resp.get("Versions", []) or []:
                    key = version.get("Key")
                    version_id = version.get("VersionId")
                    if not key or not version_id:
                        continue
                    scanned_versions += 1
                    versions_by_key.setdefault(key, []).append(
                        {
                            "version_id": version_id,
                            "last_modified": normalize(version.get("LastModified")),
                            "is_latest": bool(version.get("IsLatest")),
                        }
                    )
                for marker in resp.get("DeleteMarkers", []) or []:
                    key = marker.get("Key")
                    version_id = marker.get("VersionId")
                    if not key or not version_id:
                        continue
                    scanned_delete_markers += 1
                key_marker = resp.get("NextKeyMarker")
                version_marker = resp.get("NextVersionIdMarker")
                if not key_marker and not version_marker:
                    break

            versions_to_delete: list[dict] = []
            if payload.keep_last_n or cutoff:
                for key, versions in versions_by_key.items():
                    if not versions:
                        continue
                    ordered = sorted(
                        versions,
                        key=lambda entry: (
                            1 if entry.get("is_latest") else 0,
                            entry.get("last_modified") or datetime.min.replace(tzinfo=timezone.utc),
                        ),
                        reverse=True,
                    )
                    for index, entry in enumerate(ordered):
                        if entry.get("is_latest"):
                            continue
                        delete_for_count = payload.keep_last_n is not None and index >= payload.keep_last_n
                        last_modified = entry.get("last_modified")
                        delete_for_age = bool(cutoff and last_modified and last_modified < cutoff)
                        if delete_for_count or delete_for_age:
                            versions_to_delete.append({"Key": key, "VersionId": entry["version_id"]})

            deleted_versions = 0
            if versions_to_delete:
                _delete_objects(client, bucket_name, versions_to_delete)
                deleted_versions = len(versions_to_delete)

            deleted_delete_markers = 0
            if payload.delete_orphan_markers:
                keys_with_versions: set[str] = set()
                delete_markers: list[dict] = []
                key_marker = None
                version_marker = None
                while True:
                    list_kwargs = {"Bucket": bucket_name, "Prefix": prefix}
                    if key_marker:
                        list_kwargs["KeyMarker"] = key_marker
                    if version_marker:
                        list_kwargs["VersionIdMarker"] = version_marker
                    resp = client.list_object_versions(**list_kwargs)
                    for version in resp.get("Versions", []) or []:
                        key = version.get("Key")
                        if key:
                            keys_with_versions.add(key)
                    for marker in resp.get("DeleteMarkers", []) or []:
                        key = marker.get("Key")
                        version_id = marker.get("VersionId")
                        if not key or not version_id:
                            continue
                        delete_markers.append({"Key": key, "VersionId": version_id})
                    key_marker = resp.get("NextKeyMarker")
                    version_marker = resp.get("NextVersionIdMarker")
                    if not key_marker and not version_marker:
                        break

                markers_to_delete = [marker for marker in delete_markers if marker["Key"] not in keys_with_versions]
                if markers_to_delete:
                    _delete_objects(client, bucket_name, markers_to_delete)
                    deleted_delete_markers = len(markers_to_delete)

            return CleanupObjectVersionsResponse(
                prefix=prefix or None,
                deleted_versions=deleted_versions,
                deleted_delete_markers=deleted_delete_markers,
                scanned_versions=scanned_versions,
                scanned_delete_markers=scanned_delete_markers,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to clean versions for '{bucket_name}': {exc}") from exc

    def head_object(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectMetadata:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch metadata for '{key}': {exc}") from exc
        metadata = resp.get("Metadata") or {}
        return ObjectMetadata(
            key=key,
            size=int(resp.get("ContentLength") or 0),
            etag=self._clean_etag(resp.get("ETag")),
            last_modified=resp.get("LastModified"),
            content_type=resp.get("ContentType"),
            cache_control=resp.get("CacheControl"),
            content_disposition=resp.get("ContentDisposition"),
            content_encoding=resp.get("ContentEncoding"),
            content_language=resp.get("ContentLanguage"),
            expires=resp.get("Expires"),
            storage_class=resp.get("StorageClass"),
            metadata=metadata,
            version_id=resp.get("VersionId") or version_id,
        )

    def get_object_tags(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectTags:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch tags for '{key}': {exc}") from exc
        tagset = resp.get("TagSet") or []
        tags = [
            ObjectTag(key=tag.get("Key") or "", value=tag.get("Value") or "")
            for tag in tagset
            if tag.get("Key") is not None
        ]
        return ObjectTags(key=key, tags=tags, version_id=resp.get("VersionId") or version_id)

    def put_object_tags(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        tags: list[ObjectTag],
        version_id: Optional[str] = None,
    ) -> ObjectTags:
        client = self._client(account)
        tag_set = [
            {"Key": tag.key, "Value": tag.value}
            for tag in tags
            if tag.key is not None and str(tag.key).strip()
        ]
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            if tag_set:
                client.put_object_tagging(**kwargs, Tagging={"TagSet": tag_set})
            else:
                client.delete_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update tags for '{key}': {exc}") from exc
        return ObjectTags(key=key, tags=tags, version_id=version_id)

    def update_object_metadata(
        self,
        bucket_name: str,
        account: S3Account,
        payload: ObjectMetadataUpdate,
    ) -> ObjectMetadata:
        client = self._client(account)
        head_kwargs = {"Bucket": bucket_name, "Key": payload.key}
        if payload.version_id:
            head_kwargs["VersionId"] = payload.version_id
        try:
            current = client.head_object(**head_kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch metadata for '{payload.key}': {exc}") from exc

        current_metadata = current.get("Metadata") or {}
        metadata_source = current_metadata if payload.metadata is None else payload.metadata
        metadata = {
            key: value
            for key, value in (metadata_source or {}).items()
            if key is not None and str(key).strip() and value is not None
        }

        def resolve(value: Optional[str], current_value: Optional[str]) -> Optional[str]:
            if value is None:
                return current_value
            if str(value).strip() == "":
                return None
            return value

        content_type = resolve(payload.content_type, current.get("ContentType"))
        cache_control = resolve(payload.cache_control, current.get("CacheControl"))
        content_disposition = resolve(payload.content_disposition, current.get("ContentDisposition"))
        content_encoding = resolve(payload.content_encoding, current.get("ContentEncoding"))
        content_language = resolve(payload.content_language, current.get("ContentLanguage"))
        storage_class = resolve(payload.storage_class, current.get("StorageClass"))

        expires_value: Optional[datetime] = None
        current_expires = current.get("Expires")
        if isinstance(current_expires, datetime):
            expires_value = current_expires
        elif isinstance(current_expires, str) and current_expires.strip():
            try:
                cleaned = current_expires.strip()
                if cleaned.endswith("Z"):
                    cleaned = f"{cleaned[:-1]}+00:00"
                expires_value = datetime.fromisoformat(cleaned)
            except ValueError:
                expires_value = None
        if payload.expires is not None:
            if str(payload.expires).strip() == "":
                expires_value = None
            else:
                try:
                    cleaned = str(payload.expires).strip()
                    if cleaned.endswith("Z"):
                        cleaned = f"{cleaned[:-1]}+00:00"
                    expires_value = datetime.fromisoformat(cleaned)
                except ValueError as exc:
                    raise RuntimeError(f"Invalid expires value: {payload.expires}") from exc

        copy_source: dict[str, str] = {"Bucket": bucket_name, "Key": payload.key}
        if payload.version_id:
            copy_source["VersionId"] = payload.version_id
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "CopySource": copy_source,
            "MetadataDirective": "REPLACE",
            "TaggingDirective": "COPY",
            "Metadata": metadata,
        }
        if content_type is not None:
            kwargs["ContentType"] = content_type
        if cache_control is not None:
            kwargs["CacheControl"] = cache_control
        if content_disposition is not None:
            kwargs["ContentDisposition"] = content_disposition
        if content_encoding is not None:
            kwargs["ContentEncoding"] = content_encoding
        if content_language is not None:
            kwargs["ContentLanguage"] = content_language
        if expires_value is not None:
            kwargs["Expires"] = expires_value
        if storage_class is not None:
            kwargs["StorageClass"] = storage_class

        try:
            client.copy_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update metadata for '{payload.key}': {exc}") from exc

        return self.head_object(bucket_name, account, payload.key, version_id=None)

    def put_object_acl(
        self,
        bucket_name: str,
        account: S3Account,
        payload: ObjectAcl,
    ) -> ObjectAcl:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": payload.key, "ACL": payload.acl}
        if payload.version_id:
            kwargs["VersionId"] = payload.version_id
        try:
            client.put_object_acl(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update ACL for '{payload.key}': {exc}") from exc
        return payload

    def get_object_legal_hold(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectLegalHold:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_legal_hold(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch legal hold for '{key}': {exc}") from exc
        status = (resp.get("LegalHold") or {}).get("Status")
        return ObjectLegalHold(key=key, status=status, version_id=version_id)

    def put_object_legal_hold(
        self,
        bucket_name: str,
        account: S3Account,
        payload: ObjectLegalHold,
    ) -> ObjectLegalHold:
        client = self._client(account)
        if payload.status not in {"ON", "OFF"}:
            raise RuntimeError("Legal hold status must be ON or OFF.")
        status = payload.status.upper()
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "LegalHold": {"Status": status},
        }
        if payload.version_id:
            kwargs["VersionId"] = payload.version_id
        try:
            client.put_object_legal_hold(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update legal hold for '{payload.key}': {exc}") from exc
        return payload

    def get_object_retention(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectRetention:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_retention(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch retention for '{key}': {exc}") from exc
        retention = resp.get("Retention") or {}
        return ObjectRetention(
            key=key,
            mode=retention.get("Mode"),
            retain_until=retention.get("RetainUntilDate"),
            version_id=version_id,
        )

    def put_object_retention(
        self,
        bucket_name: str,
        account: S3Account,
        payload: ObjectRetention,
    ) -> ObjectRetention:
        client = self._client(account)
        if not payload.mode or not payload.retain_until:
            raise RuntimeError("Retention mode and retain-until date are required.")
        mode = payload.mode.upper()
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "Retention": {"Mode": mode, "RetainUntilDate": payload.retain_until},
        }
        if payload.version_id:
            kwargs["VersionId"] = payload.version_id
        if payload.bypass_governance is not None:
            kwargs["BypassGovernanceRetention"] = payload.bypass_governance
        try:
            client.put_object_retention(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to update retention for '{payload.key}': {exc}") from exc
        return payload

    def restore_object(
        self,
        bucket_name: str,
        account: S3Account,
        payload: ObjectRestoreRequest,
    ) -> None:
        client = self._client(account)
        restore_request: dict[str, object] = {"Days": payload.days}
        if payload.tier:
            restore_request["GlacierJobParameters"] = {"Tier": payload.tier}
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "RestoreRequest": restore_request,
        }
        if payload.version_id:
            kwargs["VersionId"] = payload.version_id
        try:
            client.restore_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to restore '{payload.key}': {exc}") from exc

    def presign(
        self,
        bucket_name: str,
        account: S3Account,
        payload: PresignRequest,
    ) -> PresignedUrl:
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {"Bucket": bucket_name, "Key": payload.key}
        headers: dict[str, str] = {}
        if payload.version_id:
            params["VersionId"] = payload.version_id
        try:
            if payload.operation == "get_object":
                url = client.generate_presigned_url(
                    "get_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="GET", expires_in=expires, headers=headers)
            if payload.operation == "delete_object":
                url = client.generate_presigned_url(
                    "delete_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="DELETE", expires_in=expires, headers=headers)
            if payload.operation == "put_object":
                if payload.content_type:
                    params["ContentType"] = payload.content_type
                    headers["Content-Type"] = payload.content_type
                url = client.generate_presigned_url(
                    "put_object",
                    Params=params,
                    ExpiresIn=expires,
                )
                return PresignedUrl(url=url, method="PUT", expires_in=expires, headers=headers)
            if payload.operation == "post_object":
                fields = {}
                conditions: list[dict | list] = []
                if payload.content_type:
                    fields["Content-Type"] = payload.content_type
                    conditions.append({"Content-Type": payload.content_type})
                if payload.content_length is not None:
                    conditions.append(["content-length-range", 0, payload.content_length])
                result = client.generate_presigned_post(
                    bucket_name,
                    payload.key,
                    Fields=fields or None,
                    Conditions=conditions or None,
                    ExpiresIn=expires,
                )
                return PresignedUrl(
                    url=result.get("url") or "",
                    method="POST",
                    expires_in=expires,
                    fields=result.get("fields") or {},
                    headers=headers,
                )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate presigned URL for '{payload.operation}': {exc}") from exc
        raise RuntimeError("Unsupported presign operation")

    def copy_object(
        self,
        bucket_name: str,
        account: S3Account,
        payload: CopyObjectPayload,
    ) -> None:
        client = self._client(account)
        source_bucket = payload.source_bucket or bucket_name
        copy_source: dict[str, str] = {
            "Bucket": source_bucket,
            "Key": payload.source_key,
        }
        if payload.source_version_id:
            copy_source["VersionId"] = payload.source_version_id
        kwargs = {
            "Bucket": bucket_name,
            "Key": payload.destination_key,
            "CopySource": copy_source,
        }
        if payload.replace_metadata:
            kwargs["MetadataDirective"] = "REPLACE"
            kwargs["Metadata"] = payload.metadata or {}
        if payload.replace_tags:
            tag_str = urlencode({tag.key: tag.value for tag in payload.tags if tag.key})
            kwargs["TaggingDirective"] = "REPLACE"
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            resp = client.copy_object(**kwargs)
            if payload.move:
                source_head_kwargs = {"Bucket": source_bucket, "Key": payload.source_key}
                if payload.source_version_id:
                    source_head_kwargs["VersionId"] = payload.source_version_id
                source_head = client.head_object(**source_head_kwargs)
                destination_head_kwargs = {"Bucket": bucket_name, "Key": payload.destination_key}
                destination_version_id = resp.get("VersionId")
                if destination_version_id:
                    destination_head_kwargs["VersionId"] = destination_version_id
                destination_head = client.head_object(**destination_head_kwargs)
                source_etag = self._clean_etag(source_head.get("ETag"))
                destination_etag = self._clean_etag(destination_head.get("ETag"))
                source_size = int(source_head.get("ContentLength") or 0)
                destination_size = int(destination_head.get("ContentLength") or 0)
                if source_size != destination_size:
                    raise RuntimeError("Copy verification failed (size mismatch).")
                if not source_etag or not destination_etag:
                    raise RuntimeError("Copy verification failed (missing ETag).")
                if source_etag != destination_etag:
                    raise RuntimeError("Copy verification failed (ETag mismatch).")
                delete_kwargs = {"Bucket": source_bucket, "Key": payload.source_key}
                if payload.source_version_id:
                    delete_kwargs["VersionId"] = payload.source_version_id
                client.delete_object(**delete_kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to copy object '{payload.source_key}' -> '{payload.destination_key}': {exc}") from exc

    def delete_objects(
        self,
        bucket_name: str,
        account: S3Account,
        payload: DeleteObjectsPayload,
    ) -> int:
        if not payload.objects:
            return 0
        items: list[dict] = []
        for obj in payload.objects:
            if not obj.key:
                continue
            entry = {"Key": obj.key}
            if obj.version_id:
                entry["VersionId"] = obj.version_id
            items.append(entry)
        if not items:
            return 0
        client = self._client(account)
        try:
            _delete_objects(client, bucket_name, items)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc
        return len(items)

    def create_folder(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: str,
    ) -> None:
        client = self._client(account)
        key = prefix if prefix.endswith("/") else f"{prefix}/"
        try:
            client.put_object(Bucket=bucket_name, Key=key, Body=b"")
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to create folder '{key}': {exc}") from exc

    def initiate_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        payload: MultipartUploadInitRequest,
    ) -> MultipartUploadInitResponse:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": payload.key}
        if payload.content_type:
            kwargs["ContentType"] = payload.content_type
        if payload.metadata:
            kwargs["Metadata"] = payload.metadata
        if payload.tags:
            tag_str = urlencode({tag.key: tag.value for tag in payload.tags if tag.key})
            if tag_str:
                kwargs["Tagging"] = tag_str
        if payload.acl:
            kwargs["ACL"] = payload.acl
        try:
            resp = client.create_multipart_upload(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to initiate multipart upload for '{payload.key}': {exc}") from exc
        upload_id = resp.get("UploadId")
        if not upload_id:
            raise RuntimeError("Multipart upload failed to return an upload id")
        return MultipartUploadInitResponse(key=payload.key, upload_id=upload_id)

    def list_multipart_uploads(
        self,
        bucket_name: str,
        account: S3Account,
        prefix: Optional[str] = None,
        key_marker: Optional[str] = None,
        upload_id_marker: Optional[str] = None,
        max_uploads: int = 50,
    ) -> ListMultipartUploadsResponse:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "MaxUploads": max_uploads}
        if prefix:
            kwargs["Prefix"] = prefix
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if upload_id_marker:
            kwargs["UploadIdMarker"] = upload_id_marker
        try:
            resp = client.list_multipart_uploads(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list multipart uploads for '{bucket_name}': {exc}") from exc
        uploads: list[MultipartUploadItem] = []
        for upload in resp.get("Uploads", []) or []:
            uploads.append(
                MultipartUploadItem(
                    key=upload.get("Key"),
                    upload_id=upload.get("UploadId"),
                    initiated=upload.get("Initiated"),
                    storage_class=upload.get("StorageClass"),
                    owner=(upload.get("Owner") or {}).get("DisplayName") or (upload.get("Owner") or {}).get("ID"),
                )
            )
        return ListMultipartUploadsResponse(
            uploads=uploads,
            is_truncated=bool(resp.get("IsTruncated")),
            next_key=resp.get("NextKeyMarker"),
            next_upload_id=resp.get("NextUploadIdMarker"),
        )

    def list_parts(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
        part_number_marker: Optional[int] = None,
        max_parts: int = 1000,
    ) -> ListPartsResponse:
        client = self._client(account)
        kwargs = {
            "Bucket": bucket_name,
            "Key": key,
            "UploadId": upload_id,
            "MaxParts": max_parts,
        }
        if part_number_marker:
            kwargs["PartNumberMarker"] = part_number_marker
        try:
            resp = client.list_parts(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list parts for '{key}': {exc}") from exc
        parts: list[MultipartPart] = []
        for part in resp.get("Parts", []):
            parts.append(
                MultipartPart(
                    part_number=int(part.get("PartNumber") or 0),
                    etag=self._clean_etag(part.get("ETag")) or "",
                    size=int(part.get("Size") or 0),
                    last_modified=part.get("LastModified"),
                )
            )
        return ListPartsResponse(
            parts=parts,
            is_truncated=bool(resp.get("IsTruncated")),
            next_part_number=resp.get("NextPartNumberMarker"),
        )

    def presign_part(
        self,
        bucket_name: str,
        account: S3Account,
        payload: PresignPartRequest,
    ) -> PresignPartResponse:
        if not payload.upload_id:
            raise RuntimeError("Upload id is required to presign a part")
        client = self._client(account)
        expires = payload.expires_in or 900
        params = {
            "Bucket": bucket_name,
            "Key": payload.key,
            "UploadId": payload.upload_id,
            "PartNumber": payload.part_number,
        }
        try:
            url = client.generate_presigned_url(
                "upload_part",
                Params=params,
                ExpiresIn=expires,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to presign part {payload.part_number} for '{payload.key}': {exc}") from exc
        return PresignPartResponse(url=url, expires_in=expires)

    def complete_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
        payload: CompleteMultipartUploadRequest,
    ) -> None:
        if not payload.parts:
            raise RuntimeError("No parts provided to complete multipart upload")
        client = self._client(account)
        sorted_parts = sorted(payload.parts, key=lambda part: part.part_number)
        completed = [{"ETag": part.etag, "PartNumber": part.part_number} for part in sorted_parts]
        try:
            client.complete_multipart_upload(
                Bucket=bucket_name,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": completed},
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to complete multipart upload for '{key}': {exc}") from exc

    def abort_multipart_upload(
        self,
        bucket_name: str,
        account: S3Account,
        key: str,
        upload_id: str,
    ) -> None:
        client = self._client(account)
        try:
            client.abort_multipart_upload(Bucket=bucket_name, Key=key, UploadId=upload_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to abort multipart upload for '{key}': {exc}") from exc


def get_browser_service() -> BrowserService:
    return BrowserService()
