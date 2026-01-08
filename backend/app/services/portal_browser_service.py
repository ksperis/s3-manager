# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db_models import S3Account, StorageEndpoint
from app.models.browser import (
    BrowserBucket,
    BrowserObject,
    BrowserStsCredentials,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    PresignRequest,
    PresignedUrl,
    StsStatus,
)
from app.routers.portal.dependencies import PortalContext
from app.services.rgw_iam import get_iam_service
from app.services.s3_client import get_s3_client
from app.services.sts_service import assume_role
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_sts_endpoint


logger = logging.getLogger(__name__)
settings = get_settings()

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


def _normalize_expiration(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _resolve_s3(account: S3Account) -> str:
    endpoint = resolve_s3_endpoint(account)
    if not endpoint:
        raise RuntimeError("S3 endpoint is not configured for this account")
    return endpoint


def _sts_cache_key(account_id: int, sts_endpoint: str, role_arn: str) -> str:
    return f"{account_id}::{sts_endpoint}::{role_arn}"


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


class PortalBrowserService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _account_root_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("Account is missing root credentials")
        return access_key, secret_key

    def _endpoint(self, account: S3Account) -> StorageEndpoint:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is not None:
            return endpoint
        if getattr(account, "storage_endpoint_id", None):
            found = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == account.storage_endpoint_id)
                .first()
            )
            if found:
                return found
        raise RuntimeError("Storage endpoint is not configured for this account")

    def _integrated_role_name(self, account: S3Account) -> str:
        return f"portal-{account.id}-integrated-browser"[:64]

    def _ensure_integrated_role(self, account: S3Account) -> tuple[str, str]:
        endpoint = self._endpoint(account)
        flags = resolve_feature_flags(endpoint)
        if not flags.sts_enabled:
            raise RuntimeError("STS is disabled for this endpoint")
        if not account.rgw_account_id:
            raise RuntimeError("RGW account id is missing for this account")

        access_key, secret_key = self._account_root_credentials(account)
        iam = get_iam_service(access_key, secret_key, endpoint=_resolve_s3(account))

        role_name = self._integrated_role_name(account)
        role = iam.get_role(role_name)

        principal = f"arn:aws:iam::{account.rgw_account_id}:root"
        trust_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": principal},
                    "Action": "sts:AssumeRole",
                }
            ],
        }
        if role is None:
            role = iam.create_role(role_name, trust_policy)
        else:
            iam.update_role_assume_policy(role_name, trust_policy)

        policy_name = "portal-integrated-browser"
        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PortalIntegratedBrowser",
                    "Effect": "Allow",
                    "Action": [
                        "s3:ListAllMyBuckets",
                        "s3:ListBucket",
                        "s3:GetObject",
                        "s3:PutObject",
                        "s3:DeleteObject",
                    ],
                    "Resource": ["*"],
                }
            ],
        }
        iam.put_role_inline_policy(role_name, policy_name, policy_document)
        if not role.arn:
            refreshed = iam.get_role(role_name)
            if not refreshed or not refreshed.arn:
                raise RuntimeError("Unable to resolve integrated role ARN")
            role = refreshed
        return role_name, role.arn

    def check_sts(self, ctx: PortalContext) -> StsStatus:
        caps = ctx.endpoint_capabilities
        if not caps.sts_enabled:
            return StsStatus(available=False, error="STS is disabled for this endpoint")
        endpoint = self._endpoint(ctx.account)
        sts_endpoint = resolve_sts_endpoint(endpoint)
        if not sts_endpoint:
            return StsStatus(available=False, error="STS endpoint is not configured for this endpoint")
        try:
            _, role_arn = self._ensure_integrated_role(ctx.account)
        except RuntimeError as exc:
            return StsStatus(available=False, error=str(exc))
        cache_key = _sts_cache_key(ctx.account.id, sts_endpoint, role_arn)
        cached = _get_cached_sts_credentials(cache_key)
        if cached:
            return StsStatus(available=True)
        try:
            access_key, secret_key = self._account_root_credentials(ctx.account)
            session_name = f"portal-{ctx.account.id}-{ctx.actor.id}"
            duration = max(900, min(int(caps.max_session_duration or 3600), 43200))
            access, secret, token, expiration = assume_role(
                role_arn,
                session_name=session_name,
                duration_seconds=duration,
                access_key=access_key,
                secret_key=secret_key,
                endpoint=sts_endpoint,
            )
        except RuntimeError as exc:
            _record_sts_failure(cache_key)
            return StsStatus(available=False, error=str(exc))
        _store_sts_credentials(
            cache_key,
            CachedStsCredentials(
                access_key_id=access,
                secret_access_key=secret,
                session_token=token,
                expiration=_normalize_expiration(expiration),
            ),
        )
        return StsStatus(available=True)

    def get_sts_credentials(self, ctx: PortalContext) -> BrowserStsCredentials:
        caps = ctx.endpoint_capabilities
        if not caps.sts_enabled:
            raise RuntimeError("STS is disabled for this endpoint")
        endpoint = self._endpoint(ctx.account)
        sts_endpoint = resolve_sts_endpoint(endpoint)
        if not sts_endpoint:
            raise RuntimeError("STS endpoint is not configured for this endpoint")

        _, role_arn = self._ensure_integrated_role(ctx.account)
        cache_key = _sts_cache_key(ctx.account.id, sts_endpoint, role_arn)
        cached = _get_cached_sts_credentials(cache_key)
        if cached:
            return BrowserStsCredentials(
                access_key_id=cached.access_key_id,
                secret_access_key=cached.secret_access_key,
                session_token=cached.session_token,
                expiration=_normalize_expiration(cached.expiration),
                endpoint=_resolve_s3(ctx.account),
                region=settings.s3_region,
            )
        try:
            access_key, secret_key = self._account_root_credentials(ctx.account)
            session_name = f"portal-{ctx.account.id}-{ctx.actor.id}"
            duration = max(900, min(int(caps.max_session_duration or 3600), 43200))
            access, secret, token, expiration = assume_role(
                role_arn,
                session_name=session_name,
                duration_seconds=duration,
                access_key=access_key,
                secret_key=secret_key,
                endpoint=sts_endpoint,
            )
        except RuntimeError as exc:
            _record_sts_failure(cache_key)
            raise RuntimeError(f"Unable to request STS credentials: {exc}") from exc
        normalized_expiration = _normalize_expiration(expiration)
        _store_sts_credentials(
            cache_key,
            CachedStsCredentials(
                access_key_id=access,
                secret_access_key=secret,
                session_token=token,
                expiration=normalized_expiration,
            ),
        )
        return BrowserStsCredentials(
            access_key_id=access,
            secret_access_key=secret,
            session_token=token,
            expiration=normalized_expiration,
            endpoint=_resolve_s3(ctx.account),
            region=settings.s3_region,
        )

    def _executor_credentials(self, ctx: PortalContext) -> tuple[str, str, Optional[str]]:
        if ctx.endpoint_capabilities.sts_enabled:
            try:
                creds = self.get_sts_credentials(ctx)
                return creds.access_key_id, creds.secret_access_key, creds.session_token
            except RuntimeError as exc:
                logger.info("Portal STS unavailable for account %s: %s", ctx.account.id, exc)
        access_key, secret_key = self._account_root_credentials(ctx.account)
        return access_key, secret_key, None

    def _client(self, ctx: PortalContext):
        access_key, secret_key, session_token = self._executor_credentials(ctx)
        return get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            session_token=session_token,
            endpoint=_resolve_s3(ctx.account),
        )

    def list_buckets(self, ctx: PortalContext) -> list[BrowserBucket]:
        client = self._client(ctx)
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
        ctx: PortalContext,
        bucket_name: str,
        prefix: str = "",
        continuation_token: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListBrowserObjectsResponse:
        client = self._client(ctx)
        delimiter = "" if not prefix or prefix.endswith("/") else "/"
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Prefix": prefix or "",
            "MaxKeys": max_keys,
            "Delimiter": "/" if delimiter == "/" else "/",
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        try:
            resp = client.list_objects_v2(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list objects for '{bucket_name}': {exc}") from exc

        objects: list[BrowserObject] = []
        for obj in resp.get("Contents", []) or []:
            key = obj.get("Key")
            if not key or key == prefix:
                continue
            objects.append(
                BrowserObject(
                    key=key,
                    size=int(obj.get("Size") or 0),
                    last_modified=obj.get("LastModified"),
                    etag=(obj.get("ETag") or "").strip('"') if obj.get("ETag") else None,
                    storage_class=obj.get("StorageClass"),
                )
            )
        prefixes = [p.get("Prefix") for p in resp.get("CommonPrefixes", []) or [] if p.get("Prefix")]

        return ListBrowserObjectsResponse(
            prefix=prefix or "",
            objects=objects,
            prefixes=prefixes,
            is_truncated=bool(resp.get("IsTruncated")),
            next_continuation_token=resp.get("NextContinuationToken"),
        )

    def presign(self, ctx: PortalContext, bucket_name: str, payload: PresignRequest) -> PresignedUrl:
        caps = ctx.endpoint_capabilities
        if not caps.presign_enabled:
            raise RuntimeError("Presigned URLs are disabled for this endpoint")
        client = self._client(ctx)
        expires = payload.expires_in or 900
        params = {"Bucket": bucket_name, "Key": payload.key}
        headers: dict[str, str] = {}
        try:
            if payload.operation == "get_object":
                url = client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)
                return PresignedUrl(url=url, method="GET", expires_in=expires, headers=headers)
            if payload.operation == "put_object":
                if payload.content_type:
                    params["ContentType"] = payload.content_type
                    headers["Content-Type"] = payload.content_type
                url = client.generate_presigned_url("put_object", Params=params, ExpiresIn=expires)
                return PresignedUrl(url=url, method="PUT", expires_in=expires, headers=headers)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to generate presigned URL: {exc}") from exc
        raise RuntimeError("Unsupported presign operation")

    def delete_objects(self, ctx: PortalContext, bucket_name: str, payload: DeleteObjectsPayload) -> None:
        if not payload.objects:
            return
        client = self._client(ctx)
        delete_payload = {"Objects": [{"Key": o.key} for o in payload.objects if o.key], "Quiet": True}
        try:
            client.delete_objects(Bucket=bucket_name, Delete=delete_payload)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects: {exc}") from exc

    def proxy_upload(self, ctx: PortalContext, bucket_name: str, key: str, file_obj, content_type: Optional[str]) -> None:
        client = self._client(ctx)
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

    def proxy_download(self, ctx: PortalContext, bucket_name: str, key: str):
        client = self._client(ctx)
        try:
            return client.get_object(Bucket=bucket_name, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to download '{key}': {exc}") from exc


def get_portal_browser_service(db: Session) -> PortalBrowserService:
    return PortalBrowserService(db)

