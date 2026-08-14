# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.utils.s3_etag import etag_md5

from ._shared import (
    _VERSION_CHECKSUM_FIELDS,
    _BucketObjectEntry,
    _BucketVersionEntry,
    _ResolvedContext,
    _VersionedObjectDetails,
    _VersionReplayWatermarkBuilder,
)


class BucketMigrationObjectInspectionMixin:
    def _iter_bucket_objects(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = resolved_client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list objects in bucket '{bucket_name}': {exc}") from exc
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                etag_raw = entry.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                yield _BucketObjectEntry(
                    key=key,
                    size=int(entry.get("Size") or 0),
                    etag=etag or None,
                )
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

    def _normalize_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return datetime.fromtimestamp(0, tz=timezone.utc)

    def _stable_datetime_string(self, value: Any) -> Optional[str]:
        if not isinstance(value, datetime):
            return None
        return self._normalize_datetime(value).isoformat()

    def _version_group_sort_key(self, entry: _BucketVersionEntry) -> tuple[str, float, int]:
        return (
            entry.key,
            -self._normalize_datetime(entry.last_modified).timestamp(),
            entry.order_index,
        )

    def _version_replay_sort_key(self, entry: _BucketVersionEntry) -> tuple[float, int, int]:
        # list_object_versions returns reverse-chronological entries within a key,
        # while replay/verification needs oldest -> newest. When a backend rounds
        # several recreated entries to the same second, keep objects before delete
        # markers and reverse the order_index tie-breaker so versions replay in
        # their original logical order within the timestamp group.
        return (
            self._normalize_datetime(entry.last_modified).timestamp(),
            1 if entry.is_delete_marker else 0,
            -entry.order_index,
        )

    def _iter_bucket_version_timelines(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        key_marker: Optional[str] = None
        version_marker: Optional[str] = None
        order_index = 0
        buffered_key: Optional[str] = None
        buffered_entries: list[_BucketVersionEntry] = []

        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name}
            if key_marker:
                kwargs["KeyMarker"] = key_marker
            if version_marker:
                kwargs["VersionIdMarker"] = version_marker
            try:
                page = resolved_client.list_object_versions(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list object versions in bucket '{bucket_name}': {exc}") from exc

            page_entries: list[_BucketVersionEntry] = []
            for raw in page.get("Versions", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                etag_raw = raw.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=False,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=int(raw.get("Size") or 0),
                        etag=etag or None,
                        storage_class=raw.get("StorageClass"),
                        order_index=order_index,
                    )
                )
                order_index += 1
            for raw in page.get("DeleteMarkers", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=True,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=0,
                        etag=None,
                        storage_class=None,
                        order_index=order_index,
                    )
                )
                order_index += 1

            for entry in sorted(page_entries, key=self._version_group_sort_key):
                if buffered_key is None:
                    buffered_key = entry.key
                if entry.key != buffered_key:
                    yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)
                    buffered_key = entry.key
                    buffered_entries = []
                buffered_entries.append(entry)

            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

        if buffered_key is not None:
            yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)

    def _version_watermark_signature(self, entry: _BucketVersionEntry) -> tuple[str, str, bool]:
        return (entry.key, entry.version_id, bool(entry.is_delete_marker))

    def _add_version_replay_watermark_entry(
        self,
        builder: _VersionReplayWatermarkBuilder,
        entry: _BucketVersionEntry,
    ) -> None:
        entry_dt = self._normalize_datetime(entry.last_modified)
        tie_entry = {
            "key": entry.key,
            "version_id": entry.version_id,
            "is_delete_marker": bool(entry.is_delete_marker),
        }
        if builder.latest_dt is None or entry_dt > builder.latest_dt:
            builder.latest_dt = entry_dt
            builder.tie_entries = [tie_entry]
            return
        if entry_dt == builder.latest_dt:
            builder.tie_entries.append(tie_entry)

    def _finish_version_replay_watermark(
        self,
        builder: _VersionReplayWatermarkBuilder,
    ) -> Optional[dict[str, Any]]:
        if builder.latest_dt is None:
            return None
        return {
            "last_modified": builder.latest_dt.isoformat(),
            "tie_entries": list(builder.tie_entries),
        }

    def _entry_is_after_watermark(self, entry: _BucketVersionEntry, watermark: Optional[dict[str, Any]]) -> bool:
        if not isinstance(watermark, dict):
            return True
        raw_last_modified = watermark.get("last_modified")
        if not isinstance(raw_last_modified, str) or not raw_last_modified.strip():
            return True
        try:
            normalized_watermark = self._normalize_datetime(datetime.fromisoformat(raw_last_modified))
        except ValueError:
            return True
        entry_dt = self._normalize_datetime(entry.last_modified)
        if entry_dt > normalized_watermark:
            return True
        if entry_dt < normalized_watermark:
            return False
        tie_entries = watermark.get("tie_entries") if isinstance(watermark.get("tie_entries"), list) else []
        tie_set = {
            (
                str(raw.get("key") or ""),
                str(raw.get("version_id") or ""),
                bool(raw.get("is_delete_marker")),
            )
            for raw in tie_entries
            if isinstance(raw, dict)
        }
        return self._version_watermark_signature(entry) not in tie_set

    def _head_object_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read metadata for '{key}' in bucket '{bucket_name}': {exc}"
            ) from exc
        return response if isinstance(response, dict) else {}

    def _get_object_tags_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> tuple[tuple[str, str], ...]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.get_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch tags for '{key}' in bucket '{bucket_name}': {exc}") from exc
        tagset = response.get("TagSet") if isinstance(response, dict) else []
        tags: list[tuple[str, str]] = []
        for raw in tagset or []:
            key_value = str(raw.get("Key") or "").strip()
            if not key_value:
                continue
            tags.append((key_value, str(raw.get("Value") or "")))
        return tuple(sorted(tags))

    def _checksums_from_head_response(self, response: dict[str, Any]) -> dict[str, str]:
        checksums: dict[str, str] = {}
        for field in _VERSION_CHECKSUM_FIELDS:
            value = response.get(field)
            if isinstance(value, str) and value.strip():
                checksums[field] = value.strip()
        return checksums

    def _versioned_object_details(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str],
    ) -> _VersionedObjectDetails:
        head = self._head_object_with_version(client, bucket_name, key, version_id=version_id)
        checksums = self._checksums_from_head_response(head)
        etag_raw = head.get("ETag")
        etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
        shared_checksum_compare = next((field for field in _VERSION_CHECKSUM_FIELDS if field in checksums), None)
        compare_by = shared_checksum_compare.lower() if shared_checksum_compare else (
            "md5" if etag_md5(etag) else "size"
        )
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        return _VersionedObjectDetails(
            size=int(head.get("ContentLength") or 0),
            etag=etag or None,
            compare_by=compare_by,
            checksums=checksums,
            content_type=head.get("ContentType"),
            cache_control=head.get("CacheControl"),
            content_disposition=head.get("ContentDisposition"),
            content_encoding=head.get("ContentEncoding"),
            content_language=head.get("ContentLanguage"),
            expires=self._stable_datetime_string(head.get("Expires")),
            storage_class=head.get("StorageClass"),
            metadata={str(key): str(value) for key, value in metadata.items() if key is not None and value is not None},
            tags=self._get_object_tags_with_version(client, bucket_name, key, version_id=version_id),
        )

    def _compare_versioned_object_details(
        self,
        source_details: _VersionedObjectDetails,
        target_details: _VersionedObjectDetails,
    ) -> tuple[bool, str, Optional[str]]:
        for field in _VERSION_CHECKSUM_FIELDS:
            source_value = source_details.checksums.get(field)
            target_value = target_details.checksums.get(field)
            if source_value and target_value:
                if source_value != target_value:
                    return False, field.lower(), f"{field.lower()}_mismatch"
                compare_by = field.lower()
                break
        else:
            source_md5 = etag_md5(source_details.etag)
            target_md5 = etag_md5(target_details.etag)
            if source_md5 and target_md5:
                compare_by = "md5"
                if source_md5 != target_md5:
                    return False, compare_by, "md5_mismatch"
            else:
                compare_by = "size"
                if source_details.size != target_details.size:
                    return False, compare_by, "size_mismatch"

        comparisons = (
            ("content_type", source_details.content_type, target_details.content_type),
            ("cache_control", source_details.cache_control, target_details.cache_control),
            ("content_disposition", source_details.content_disposition, target_details.content_disposition),
            ("content_encoding", source_details.content_encoding, target_details.content_encoding),
            ("content_language", source_details.content_language, target_details.content_language),
            ("expires", source_details.expires, target_details.expires),
            ("storage_class", source_details.storage_class, target_details.storage_class),
            ("metadata", source_details.metadata, target_details.metadata),
            ("tags", source_details.tags, target_details.tags),
        )
        for field_name, source_value, target_value in comparisons:
            if source_value != target_value:
                return False, compare_by, f"{field_name}_mismatch"
        return True, compare_by, None
