# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


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
        role_by_bucket = self._db_storage_space_access(
            user,
            access.account,
            access.role,
            include_archived=include_archived,
        )
        return self._storage_space_effective_role(
            user,
            access,
            metadata,
            role_by_bucket.get(bucket_name),
            include_archived=include_archived,
        )

    def _user_storage_space_content_role(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> Optional[PortalStorageSpaceRole]:
        metadata = self._storage_space_metadata(access.account, bucket_name)
        role_by_bucket = self._db_storage_space_content_access(user, access.account, access.role)
        return self._storage_space_effective_content_role(
            user,
            access,
            metadata,
            role_by_bucket.get(bucket_name),
        )

    def _require_storage_space_content_role(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> PortalStorageSpaceRole:
        role = self._user_storage_space_content_role(user, access, bucket_name)
        if role is None:
            raise RuntimeError("Storage Space content access not allowed for this role.")
        return role

    def _portal_object_client(self, user: User, account: S3Account):
        link = self._existing_portal_link(user, account)
        if not link or not link.active_access_key or not link.active_secret_key:
            raise RuntimeError("Portal IAM credentials are not provisioned for this user.")
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        return get_s3_client(
            link.active_access_key,
            link.active_secret_key,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
        )

    def _object_name(self, key: str) -> str:
        normalized = key.rstrip("/")
        return os.path.basename(normalized) or normalized or key

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
        client = self._portal_object_client(user, access.account)
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
