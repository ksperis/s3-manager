# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import (
    BrowserObjectLazyColumn,
    ObjectAcl,
    ObjectColumnValues,
    ObjectColumnsResponse,
    ObjectLegalHold,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectRetention,
    ObjectTag,
    ObjectTags,
    SseCustomerContext,
)
from app.services.s3_execution_context import S3ExecutionTarget

from ._shared import (
    _OBJECT_LAZY_HEAD_CACHE,
    _OBJECT_LAZY_TAGS_CACHE,
    _ObjectLazyHeadCacheValue,
    _ObjectLazyTagsCacheValue,
    _is_missing_object_lock_configuration,
)


_METADATA_COPY_STRING_FIELDS = (
    ("content_type", "ContentType"),
    ("cache_control", "CacheControl"),
    ("content_disposition", "ContentDisposition"),
    ("content_encoding", "ContentEncoding"),
    ("content_language", "ContentLanguage"),
    ("storage_class", "StorageClass"),
)


def _object_version_reference(
    bucket_name: str,
    key: str,
    version_id: Optional[str],
) -> dict[str, str]:
    reference = {"Bucket": bucket_name, "Key": key}
    if version_id:
        reference["VersionId"] = version_id
    return reference


def _load_metadata_copy_state(
    client: Any,
    bucket_name: str,
    payload: ObjectMetadataUpdate,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source = _object_version_reference(bucket_name, payload.key, payload.version_id)
    try:
        current = client.head_object(**source)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to fetch metadata for '{payload.key}': {exc}") from exc
    try:
        current_tagging = client.get_object_tagging(**source)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to fetch tags for '{payload.key}': {exc}") from exc
    return current, current_tagging.get("TagSet") or []


def _normalized_copy_metadata(
    current: dict[str, Any],
    replacement: Optional[dict[str, str]],
) -> dict[str, str]:
    source = (current.get("Metadata") or {}) if replacement is None else replacement
    return {
        key: value
        for key, value in source.items()
        if key is not None and str(key).strip() and value is not None
    }


def _resolved_copy_value(value: Optional[str], current_value: Any) -> Any:
    if value is None:
        return current_value
    if not str(value).strip():
        return None
    return value


def _parsed_iso_datetime(value: str) -> datetime:
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    return datetime.fromisoformat(cleaned)


def _resolved_copy_expiration(
    current_value: Any,
    replacement: Optional[str],
) -> Optional[datetime]:
    if isinstance(current_value, datetime):
        current_expiration = current_value
    elif isinstance(current_value, str) and current_value.strip():
        try:
            current_expiration = _parsed_iso_datetime(current_value)
        except ValueError:
            current_expiration = None
    else:
        current_expiration = None

    if replacement is None:
        return current_expiration
    if not replacement.strip():
        return None
    try:
        return _parsed_iso_datetime(replacement)
    except ValueError as exc:
        raise RuntimeError(f"Invalid expires value: {replacement}") from exc


def _metadata_copy_request(
    bucket_name: str,
    payload: ObjectMetadataUpdate,
    current: dict[str, Any],
    current_tag_set: list[dict[str, Any]],
) -> dict[str, object]:
    kwargs: dict[str, object] = {
        "Bucket": bucket_name,
        "Key": payload.key,
        "CopySource": _object_version_reference(bucket_name, payload.key, payload.version_id),
        "MetadataDirective": "REPLACE",
        "Metadata": _normalized_copy_metadata(current, payload.metadata),
    }
    if current_tag_set:
        kwargs["TaggingDirective"] = "REPLACE"
        kwargs["Tagging"] = urlencode(
            [
                (str(tag.get("Key") or ""), str(tag.get("Value") or ""))
                for tag in current_tag_set
                if str(tag.get("Key") or "").strip()
            ]
        )
    else:
        kwargs["TaggingDirective"] = "COPY"

    for payload_field, request_field in _METADATA_COPY_STRING_FIELDS:
        value = _resolved_copy_value(getattr(payload, payload_field), current.get(request_field))
        if value is not None:
            kwargs[request_field] = value
    expires = _resolved_copy_expiration(current.get("Expires"), payload.expires)
    if expires is not None:
        kwargs["Expires"] = expires
    return kwargs


def _copy_metadata(
    client: Any,
    payload: ObjectMetadataUpdate,
    kwargs: dict[str, object],
) -> Optional[str]:
    try:
        response = client.copy_object(**kwargs)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to update metadata for '{payload.key}': {exc}") from exc
    return response.get("VersionId") if isinstance(response, dict) else None


def _restore_copied_tags(
    client: Any,
    bucket_name: str,
    key: str,
    tag_set: list[dict[str, Any]],
    copied_version_id: Optional[str],
) -> None:
    if not tag_set:
        return
    kwargs: dict[str, object] = {
        "Bucket": bucket_name,
        "Key": key,
        "Tagging": {"TagSet": tag_set},
    }
    if copied_version_id:
        kwargs["VersionId"] = copied_version_id
    try:
        client.put_object_tagging(**kwargs)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to restore tags for '{key}': {exc}") from exc


class BrowserObjectDetailsMixin:
    def head_object(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        version_id: Optional[str] = None,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> ObjectMetadata:
        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        kwargs.update(self._sse_customer_params(sse_customer))
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
            restore_status=self._normalize_restore_status(resp.get("Restore")),
            metadata=metadata,
            version_id=resp.get("VersionId") or version_id,
        )

    def _get_object_lazy_head_columns(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        *,
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> _ObjectLazyHeadCacheValue:
        account_cache_key = self._account_cache_key(account)
        cache_key = self._object_lazy_head_cache_key(
            account_cache_key=account_cache_key,
            bucket_name=bucket_name,
            key=key,
            sse_customer=sse_customer,
        )
        cached = _OBJECT_LAZY_HEAD_CACHE.get(cache_key)
        if cached is not None:
            return cached

        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        kwargs.update(self._sse_customer_params(sse_customer))
        try:
            resp = client.head_object(**kwargs)
            metadata = resp.get("Metadata") or {}
            result = _ObjectLazyHeadCacheValue(
                content_type=resp.get("ContentType"),
                metadata_count=len(metadata),
                cache_control=resp.get("CacheControl"),
                expires=resp.get("Expires"),
                restore_status=self._normalize_restore_status(resp.get("Restore")),
                available=True,
            )
        except (ClientError, BotoCoreError):
            result = _ObjectLazyHeadCacheValue(
                content_type=None,
                metadata_count=None,
                cache_control=None,
                expires=None,
                restore_status=None,
                available=False,
            )
        _OBJECT_LAZY_HEAD_CACHE.set(cache_key, result)
        return result

    def _get_object_lazy_tags_columns(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
    ) -> _ObjectLazyTagsCacheValue:
        account_cache_key = self._account_cache_key(account)
        cache_key = self._object_lazy_tags_cache_key(
            account_cache_key=account_cache_key,
            bucket_name=bucket_name,
            key=key,
        )
        cached = _OBJECT_LAZY_TAGS_CACHE.get(cache_key)
        if cached is not None:
            return cached

        client = self._client(account)
        kwargs = {"Bucket": bucket_name, "Key": key}
        try:
            resp = client.get_object_tagging(**kwargs)
            result = _ObjectLazyTagsCacheValue(
                tags_count=len(resp.get("TagSet") or []),
                available=True,
            )
        except (ClientError, BotoCoreError):
            result = _ObjectLazyTagsCacheValue(tags_count=None, available=False)
        _OBJECT_LAZY_TAGS_CACHE.set(cache_key, result)
        return result

    def get_object_columns(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        *,
        keys: list[str],
        columns: set[BrowserObjectLazyColumn],
        sse_customer: Optional[SseCustomerContext] = None,
    ) -> ObjectColumnsResponse:
        normalized_keys: list[str] = []
        seen_keys: set[str] = set()
        for raw_key in keys:
            key = str(raw_key or "").strip()
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            normalized_keys.append(key)

        head_columns = {"content_type", "metadata_count", "cache_control", "expires", "restore_status"}
        tags_columns = {"tags_count"}
        wants_head = bool(columns & head_columns)
        wants_tags = bool(columns & tags_columns)
        items: list[ObjectColumnValues] = []

        for key in normalized_keys:
            head_value: Optional[_ObjectLazyHeadCacheValue] = None
            tags_value: Optional[_ObjectLazyTagsCacheValue] = None
            if wants_head:
                head_value = self._get_object_lazy_head_columns(
                    bucket_name,
                    account,
                    key,
                    sse_customer=sse_customer,
                )
            if wants_tags:
                tags_value = self._get_object_lazy_tags_columns(bucket_name, account, key)
            items.append(
                ObjectColumnValues(
                    key=key,
                    content_type=head_value.content_type if head_value else None,
                    tags_count=tags_value.tags_count if tags_value else None,
                    metadata_count=head_value.metadata_count if head_value else None,
                    cache_control=head_value.cache_control if head_value else None,
                    expires=head_value.expires if head_value else None,
                    restore_status=head_value.restore_status if head_value else None,
                    metadata_status="ready" if (not wants_head or (head_value and head_value.available)) else "error",
                    tags_status="ready" if (not wants_tags or (tags_value and tags_value.available)) else "error",
                )
            )
        return ObjectColumnsResponse(items=items)

    def get_object_tags(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
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
        account: S3ExecutionTarget,
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
        account: S3ExecutionTarget,
        payload: ObjectMetadataUpdate,
    ) -> ObjectMetadata:
        client = self._client(account)
        current, current_tag_set = _load_metadata_copy_state(client, bucket_name, payload)
        copy_request = _metadata_copy_request(bucket_name, payload, current, current_tag_set)
        copied_version_id = _copy_metadata(client, payload, copy_request)
        _restore_copied_tags(
            client,
            bucket_name,
            payload.key,
            current_tag_set,
            copied_version_id,
        )

        self.invalidate_object_list_cache_for_account(account, bucket_name)
        return self.head_object(bucket_name, account, payload.key, version_id=None)

    def get_object_acl(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectAcl:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_acl(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch ACL for '{key}': {exc}") from exc

        all_users_uri = "http://acs.amazonaws.com/groups/global/AllUsers"
        authenticated_users_uri = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers"
        owner = resp.get("Owner") or {}
        owner_id = str(owner.get("ID") or "")
        all_users_permissions: set[str] = set()
        authenticated_users_permissions: set[str] = set()
        has_extra_grants = False

        for grant in resp.get("Grants") or []:
            grantee = grant.get("Grantee") or {}
            permission = str(grant.get("Permission") or "").upper()
            grantee_type = str(grantee.get("Type") or "")
            grantee_id = str(grantee.get("ID") or "")
            uri = str(grantee.get("URI") or "")
            if uri == all_users_uri:
                all_users_permissions.add(permission)
                continue
            if uri == authenticated_users_uri:
                authenticated_users_permissions.add(permission)
                continue
            if (
                grantee_type == "CanonicalUser"
                and owner_id
                and grantee_id == owner_id
                and permission == "FULL_CONTROL"
            ):
                continue
            if permission:
                has_extra_grants = True

        inferred_acl = "private"
        if all_users_permissions.issuperset({"READ", "WRITE"}):
            inferred_acl = "public-read-write"
        elif "READ" in all_users_permissions:
            inferred_acl = "public-read"
        elif "READ" in authenticated_users_permissions:
            inferred_acl = "authenticated-read"
        elif has_extra_grants:
            inferred_acl = "custom"

        return ObjectAcl(key=key, acl=inferred_acl, version_id=version_id)

    def put_object_acl(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
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
        account: S3ExecutionTarget,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectLegalHold:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_legal_hold(**kwargs)
        except ClientError as exc:
            if _is_missing_object_lock_configuration(exc):
                return ObjectLegalHold(key=key, status=None, version_id=version_id)
            raise RuntimeError(f"Unable to fetch legal hold for '{key}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch legal hold for '{key}': {exc}") from exc
        status = (resp.get("LegalHold") or {}).get("Status")
        return ObjectLegalHold(key=key, status=status, version_id=version_id)

    def put_object_legal_hold(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
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
        account: S3ExecutionTarget,
        key: str,
        version_id: Optional[str] = None,
    ) -> ObjectRetention:
        client = self._client(account)
        kwargs: dict[str, object] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            resp = client.get_object_retention(**kwargs)
        except ClientError as exc:
            if _is_missing_object_lock_configuration(exc):
                return ObjectRetention(key=key, mode=None, retain_until=None, version_id=version_id)
            raise RuntimeError(f"Unable to fetch retention for '{key}': {exc}") from exc
        except BotoCoreError as exc:
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
        account: S3ExecutionTarget,
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
        account: S3ExecutionTarget,
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
        self.invalidate_object_list_cache_for_account(account, bucket_name)
