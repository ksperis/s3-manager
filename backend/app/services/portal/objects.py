# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from app.db import S3Account, User
from app.models.portal import (
    PortalStorageObjectDetail,
    PortalStorageObjectRestoreResponse,
    PortalStorageObjectVersion,
    PortalStorageObjectVersionsResponse,
    PortalStorageSpaceRole,
    PortalTrashItem,
    PortalTrashResponse,
)
from app.services.aws_client_config import StorageRequestProfile
from app.services.s3_client import get_s3_client
from app.utils.s3_endpoint import resolve_s3_client_options

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess

logger = logging.getLogger(__name__)


class PortalObjectsMixin:
    def _user_storage_space_role(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        include_archived: bool = False,
    ) -> Optional[PortalStorageSpaceRole]:
        metadata = self._storage_space_metadata(access.account, bucket_name)
        role_by_bucket = self._storage_space_roles_by_bucket(
            user,
            access.account,
            access.portal_role,
            include_archived=include_archived,
        )
        return self._storage_space_effective_role(
            user,
            access,
            metadata,
            role_by_bucket.get(bucket_name),
            include_archived=include_archived,
        )

    def _require_storage_space_content_role(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> PortalStorageSpaceRole:
        role = self._user_storage_space_role(user, access, bucket_name)
        if role is None:
            raise RuntimeError("Storage Space content access not allowed for this role.")
        return role

    def _portal_object_client(
        self,
        user: User,
        account: S3Account,
        *,
        request_profile: StorageRequestProfile = "interactive",
    ):
        link = self._existing_portal_link(user, account)
        if not link or not link.active_access_key or not link.active_secret_key:
            raise RuntimeError("Portal IAM credentials are not provisioned for this user.")
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        client_options = {
            "endpoint": endpoint,
            "region": region,
            "force_path_style": force_path_style,
            "verify_tls": verify_tls,
        }
        if request_profile != "interactive":
            client_options["request_profile"] = request_profile
        return get_s3_client(
            link.active_access_key,
            link.active_secret_key,
            **client_options,
        )

    def _object_name(self, key: str) -> str:
        normalized = key.rstrip("/")
        return os.path.basename(normalized) or normalized or key

    def _storage_space_versioning_status(self, client, bucket_name: str, space_id: str) -> str:
        try:
            response = client.get_bucket_versioning(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to load versioning status for storage space '{space_id}': {exc}"
            ) from exc
        status = response.get("Status")
        return status if status in {"Enabled", "Suspended"} else "Disabled"

    def _list_storage_space_object_versions_page(
        self,
        client,
        bucket_name: str,
        *,
        key: Optional[str] = None,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> dict:
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "MaxKeys": max_keys,
        }
        if key:
            kwargs["Prefix"] = key
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        try:
            return client.list_object_versions(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to load file history for storage space bucket '{bucket_name}': {exc}"
            ) from exc

    def _portal_version_entry(
        self,
        value: dict,
        *,
        is_delete_marker: bool,
    ) -> Optional[PortalStorageObjectVersion]:
        key = value.get("Key")
        version_id = value.get("VersionId")
        if not key or not version_id:
            return None
        return PortalStorageObjectVersion(
            key=key,
            version_id=version_id,
            is_latest=bool(value.get("IsLatest")),
            is_delete_marker=is_delete_marker,
            last_modified=value.get("LastModified"),
            size=None if is_delete_marker else int(value.get("Size") or 0),
        )

    def get_storage_space_object_versions(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        key: str,
        *,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> PortalStorageObjectVersionsResponse:
        target_key = (key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        role = self._require_storage_space_content_role(user, access, bucket_name)
        client = self._portal_object_client(user, access.account)
        versioning_status = self._storage_space_versioning_status(client, bucket_name, space_id)
        if versioning_status == "Disabled":
            return PortalStorageObjectVersionsResponse(
                key=target_key,
                versioning_status="Disabled",
                can_restore=False,
            )
        response = self._list_storage_space_object_versions_page(
            client,
            bucket_name,
            key=target_key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
        entries: list[PortalStorageObjectVersion] = []
        for value in response.get("Versions", []):
            if value.get("Key") != target_key:
                continue
            entry = self._portal_version_entry(value, is_delete_marker=False)
            if entry is not None:
                entries.append(entry)
        for value in response.get("DeleteMarkers", []):
            if value.get("Key") != target_key:
                continue
            entry = self._portal_version_entry(value, is_delete_marker=True)
            if entry is not None:
                entries.append(entry)
        entries.sort(
            key=lambda entry: entry.last_modified or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return PortalStorageObjectVersionsResponse(
            key=target_key,
            versioning_status=versioning_status,
            can_restore=role != "Viewer",
            versions=entries,
            is_truncated=bool(response.get("IsTruncated")),
            next_key_marker=response.get("NextKeyMarker"),
            next_version_id_marker=response.get("NextVersionIdMarker"),
        )

    def list_storage_space_trash(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> PortalTrashResponse:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        role = self._require_storage_space_content_role(user, access, bucket_name)
        client = self._portal_object_client(user, access.account)
        versioning_status = self._storage_space_versioning_status(client, bucket_name, space_id)
        if versioning_status == "Disabled":
            return PortalTrashResponse(versioning_status="Disabled", can_restore=False)
        response = self._list_storage_space_object_versions_page(
            client,
            bucket_name,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
        versions_by_key: dict[str, list[dict]] = {}
        for version in response.get("Versions", []):
            version_key = version.get("Key")
            if version_key:
                versions_by_key.setdefault(version_key, []).append(version)
        items: list[PortalTrashItem] = []
        for marker in response.get("DeleteMarkers", []):
            key = marker.get("Key")
            marker_version_id = marker.get("VersionId")
            if not key or not marker_version_id or not marker.get("IsLatest"):
                continue
            previous_versions = versions_by_key.get(key, [])
            previous = max(
                previous_versions,
                key=lambda value: value.get("LastModified")
                or datetime.min.replace(tzinfo=timezone.utc),
                default=None,
            )
            items.append(
                PortalTrashItem(
                    key=key,
                    name=self._object_name(key),
                    deleted_at=marker.get("LastModified"),
                    delete_marker_version_id=marker_version_id,
                    previous_version_id=previous.get("VersionId") if previous else None,
                    previous_last_modified=previous.get("LastModified") if previous else None,
                    size=int(previous.get("Size") or 0) if previous else None,
                )
            )
        items.sort(
            key=lambda item: item.deleted_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return PortalTrashResponse(
            versioning_status=versioning_status,
            can_restore=role != "Viewer",
            items=items,
            is_truncated=bool(response.get("IsTruncated")),
            next_key_marker=response.get("NextKeyMarker"),
            next_version_id_marker=response.get("NextVersionIdMarker"),
        )

    def _latest_restorable_storage_space_version(
        self,
        client,
        bucket_name: str,
        target_key: str,
    ) -> str:
        key_marker: Optional[str] = None
        version_id_marker: Optional[str] = None
        current_is_deleted = False
        while True:
            response = self._list_storage_space_object_versions_page(
                client,
                bucket_name,
                key=target_key,
                key_marker=key_marker,
                version_id_marker=version_id_marker,
            )
            exact_markers = [
                marker
                for marker in response.get("DeleteMarkers", [])
                if marker.get("Key") == target_key
            ]
            if any(marker.get("IsLatest") for marker in exact_markers):
                current_is_deleted = True
            exact_versions = [
                version
                for version in response.get("Versions", [])
                if version.get("Key") == target_key and version.get("VersionId")
            ]
            if current_is_deleted and exact_versions:
                latest = max(
                    exact_versions,
                    key=lambda value: value.get("LastModified")
                    or datetime.min.replace(tzinfo=timezone.utc),
                )
                return str(latest["VersionId"])
            if not response.get("IsTruncated"):
                break
            key_marker = response.get("NextKeyMarker")
            version_id_marker = response.get("NextVersionIdMarker")
            if not key_marker:
                break
        if not current_is_deleted:
            raise RuntimeError(f"Object '{target_key}' is not in the trash.")
        raise RuntimeError(f"No restorable version was found for object '{target_key}'.")

    def restore_storage_space_object_version(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> PortalStorageObjectRestoreResponse:
        target_key = (key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        if self._require_storage_space_content_role(user, access, bucket_name) == "Viewer":
            raise RuntimeError("Restore not allowed for this storage space role.")
        client = self._portal_object_client(user, access.account, request_profile="long_running")
        if self._storage_space_versioning_status(client, bucket_name, space_id) == "Disabled":
            raise RuntimeError("File history is not enabled for this storage space.")
        source_version_id = version_id or self._latest_restorable_storage_space_version(
            client,
            bucket_name,
            target_key,
        )
        self._restore_storage_space_object_version_with_client(
            client,
            bucket_name,
            target_key,
            source_version_id,
            space_id=space_id,
        )
        return PortalStorageObjectRestoreResponse(
            key=target_key,
            restored_from_version_id=source_version_id,
        )

    def _restore_storage_space_object_version_with_client(
        self,
        client,
        bucket_name: str,
        target_key: str,
        source_version_id: str,
        *,
        space_id: str,
    ) -> None:
        try:
            client.head_object(
                Bucket=bucket_name,
                Key=target_key,
                VersionId=source_version_id,
            )
            client.copy_object(
                Bucket=bucket_name,
                Key=target_key,
                CopySource={
                    "Bucket": bucket_name,
                    "Key": target_key,
                    "VersionId": source_version_id,
                },
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to restore object '{target_key}' in storage space '{space_id}': {exc}"
            ) from exc

    def _head_storage_space_object(self, client, bucket_name: str, space_id: str, target_key: str) -> dict:
        try:
            return client.head_object(Bucket=bucket_name, Key=target_key)
        except ClientError as exc:
            error = exc.response.get("Error") or {}
            code = str(error.get("Code") or "").lower()
            status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in {"404", "nosuchkey", "notfound"} or status_code == 404:
                raise RuntimeError(f"Object '{target_key}' not found in storage space '{space_id}'.") from exc
            raise RuntimeError(f"Unable to load object '{target_key}' in storage space '{space_id}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to load object '{target_key}' in storage space '{space_id}': {exc}") from exc

    def download_storage_space_object(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        key: str,
    ):
        target_key = (key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_content_role(user, access, bucket_name)
        client = self._portal_object_client(user, access.account, request_profile="long_running")
        try:
            resp = client.get_object(Bucket=bucket_name, Key=target_key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to download object '{target_key}' in storage space '{space_id}': {exc}") from exc
        body = resp.get("Body")
        if not body:
            raise RuntimeError(f"Unable to download object '{target_key}': empty response body")
        stream = body.iter_chunks(chunk_size=1024 * 1024) if hasattr(body, "iter_chunks") else body
        content_type = resp.get("ContentType")
        filename = self._object_name(target_key) or "download"
        return stream, content_type, filename

    def _safe_content_preview(self, client, bucket_name: str, key: str, content_type: Optional[str]) -> tuple[str, Optional[str], Optional[str]]:
        normalized_type = (content_type or "").split(";")[0].strip().lower()
        text_types = {
            "application/json",
            "application/xml",
            "application/csv",
            "application/x-yaml",
            "application/yaml",
            "text/csv",
        }
        is_text = normalized_type.startswith("text/") or normalized_type in text_types or key.lower().endswith(
            (".txt", ".csv", ".json", ".xml", ".yaml", ".yml", ".md", ".log")
        )
        if not is_text:
            if normalized_type.startswith("image/"):
                return "image", None, "Image preview is not embedded in Portal yet. Download the file to inspect it."
            return "unavailable", None, "Preview is available only for small text files."
        try:
            resp = client.get_object(Bucket=bucket_name, Key=key, Range="bytes=0-65535")
            body = resp.get("Body")
            raw = body.read() if hasattr(body, "read") else b""
            if not isinstance(raw, bytes):
                return "unavailable", None, "Preview response could not be decoded."
            return "text", raw.decode("utf-8", errors="replace"), None
        except (ClientError, BotoCoreError) as exc:
            logger.debug("Unable to read object preview for %s/%s: %s", bucket_name, key, exc)
            return "unavailable", None, "Preview could not be loaded."

    def get_storage_space_object_detail(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        key: str,
    ) -> PortalStorageObjectDetail:
        target_key = (key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        self._require_storage_space_content_role(user, access, bucket_name)
        client = self._portal_object_client(user, access.account)
        resp = self._head_storage_space_object(client, bucket_name, space_id, target_key)
        content_type = resp.get("ContentType")
        preview_type, preview_text, preview_reason = self._safe_content_preview(client, bucket_name, target_key, content_type)
        return PortalStorageObjectDetail(
            key=target_key,
            name=self._object_name(target_key),
            size=resp.get("ContentLength"),
            last_modified=resp.get("LastModified"),
            content_type=content_type,
            storage_class=resp.get("StorageClass") or "STANDARD",
            encryption=resp.get("ServerSideEncryption"),
            preview_type=preview_type,
            preview_text=preview_text,
            preview_unavailable_reason=preview_reason,
        )

    def delete_storage_space_object(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        key: str,
    ) -> str:
        target_key = (key or "").lstrip("/")
        if not target_key:
            raise RuntimeError("Object key is required.")
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        if self._require_storage_space_content_role(user, access, bucket_name) == "Viewer":
            raise RuntimeError("Delete not allowed for this storage space role.")
        client = self._portal_object_client(user, access.account)
        try:
            client.delete_object(Bucket=bucket_name, Key=target_key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete object '{target_key}' in storage space '{space_id}': {exc}") from exc
        return target_key
