# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import json
import time
import uuid
from typing import Any, Callable

import pytest

from .ceph_admin_helpers import backend_error_detail, looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker

pytestmark = pytest.mark.ceph_functional

_MIGRATION_FINAL_STATUSES = {
    "completed",
    "completed_with_errors",
    "failed",
    "canceled",
    "rolled_back",
}
_VERSION_OPERATION_GAP_SECONDS = 1.1


def _bucket_name(prefix: str, label: str = "mig") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _topic_name(prefix: str, label: str = "topic") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _account_params(account_id: int) -> dict[str, int]:
    return {"account_id": account_id}


def _stable_dump(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalize_value(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        normalized = [_normalize_value(item) for item in value]
        return sorted(normalized, key=_stable_dump)
    return value


def _wait_for_value(
    description: str,
    fetch: Callable[[], Any],
    predicate: Callable[[Any], bool],
    *,
    timeout: float = 60.0,
    interval: float = 1.0,
) -> Any:
    deadline = time.monotonic() + timeout
    last_value: Any = None
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            last_value = fetch()
            if predicate(last_value):
                return last_value
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(interval)
    try:
        last_value = fetch()
        if predicate(last_value):
            return last_value
    except Exception as exc:  # noqa: BLE001
        last_error = exc
    if last_error is not None:
        raise AssertionError(f"{description} did not reach the expected state: last error was {last_error}") from last_error
    raise AssertionError(f"{description} did not reach the expected state: last value was {last_value!r}")


def _wait_for_equal(
    description: str,
    fetch: Callable[[], Any],
    expected: Any,
    *,
    timeout: float = 60.0,
    interval: float = 1.0,
) -> Any:
    normalized_expected = _normalize_value(expected)
    return _wait_for_value(
        description,
        fetch,
        lambda current: _normalize_value(current) == normalized_expected,
        timeout=timeout,
        interval=interval,
    )


def _sleep_for_version_gap() -> None:
    time.sleep(_VERSION_OPERATION_GAP_SECONDS)


def _skip_if_cluster_unavailable(action: str, exc: BackendAPIError, *, extra_markers: tuple[str, ...] = ()) -> None:
    detail = backend_error_detail(exc).strip()
    normalized_detail = detail.lower()
    if looks_unsupported(exc) or any(marker.lower() in normalized_detail for marker in extra_markers):
        reason = detail or f"status={exc.status_code}"
        pytest.skip(f"{action} unavailable on this cluster: {reason}")


def _create_bucket(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    versioning: bool = False,
) -> None:
    manager_session.post(
        "/manager/buckets",
        params=_account_params(account_id),
        json={
            "name": bucket_name,
            "versioning": versioning,
            "block_public_access": False,
        },
        expected_status=201,
    )


def _delete_bucket(
    manager_session: BackendSession,
    resource_tracker: ResourceTracker,
    account_id: int,
    bucket_name: str,
) -> None:
    try:
        manager_session.delete(
            f"/manager/buckets/{bucket_name}",
            params={"account_id": account_id, "force": "true"},
            expected_status=(200, 404),
        )
    except BackendAPIError:
        return
    resource_tracker.discard_bucket(account_id, bucket_name)


def _delete_topic(manager_session: BackendSession, account_id: int, topic_arn: str) -> None:
    if not topic_arn:
        return
    try:
        manager_session.delete(
            f"/manager/topics/{topic_arn}",
            params=_account_params(account_id),
            expected_status=(204, 404),
        )
    except BackendAPIError:
        return


def _upload_bytes(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    payload: bytes,
    *,
    content_type: str = "application/octet-stream",
    filename: str | None = None,
) -> None:
    response = manager_session.request(
        "POST",
        f"/browser/buckets/{bucket_name}/proxy-upload",
        params=_account_params(account_id),
        data={"key": key, "content_type": content_type},
        files={"file": (filename or key.rsplit("/", 1)[-1] or "upload.bin", io.BytesIO(payload), content_type)},
    )
    response.close()


def _set_object_tags(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    tags: dict[str, str],
    *,
    version_id: str | None = None,
) -> dict[str, Any]:
    return manager_session.put(
        f"/browser/buckets/{bucket_name}/object-tags",
        params=_account_params(account_id),
        json={
            "key": key,
            "version_id": version_id,
            "tags": [{"key": tag_key, "value": tag_value} for tag_key, tag_value in sorted(tags.items())],
        },
    )


def _set_object_metadata(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    version_id: str | None = None,
    content_type: str | None = None,
    metadata: dict[str, str] | None = None,
    cache_control: str | None = None,
    content_language: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "key": key,
        "version_id": version_id,
        "metadata": metadata,
        "content_type": content_type,
        "cache_control": cache_control,
        "content_language": content_language,
    }
    return manager_session.put(
        f"/browser/buckets/{bucket_name}/object-meta",
        params=_account_params(account_id),
        json=payload,
    )


def _copy_object(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    source_bucket: str,
    source_key: str,
    destination_key: str,
    source_version_id: str | None = None,
    metadata: dict[str, str] | None = None,
    replace_metadata: bool = False,
    tags: dict[str, str] | None = None,
    replace_tags: bool = False,
) -> None:
    manager_session.post(
        f"/browser/buckets/{bucket_name}/copy",
        params=_account_params(account_id),
        json={
            "source_bucket": source_bucket,
            "source_key": source_key,
            "destination_key": destination_key,
            "source_version_id": source_version_id,
            "metadata": metadata or {},
            "replace_metadata": replace_metadata,
            "tags": [{"key": key, "value": value} for key, value in sorted((tags or {}).items())],
            "replace_tags": replace_tags,
        },
    )


def _delete_browser_objects(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    objects: list[dict[str, str | None]],
) -> None:
    manager_session.post(
        f"/browser/buckets/{bucket_name}/delete",
        params=_account_params(account_id),
        json={"objects": objects},
    )


def _download_bytes(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    version_id: str | None = None,
) -> bytes:
    response = manager_session.request(
        "GET",
        f"/browser/buckets/{bucket_name}/download",
        params={
            "account_id": account_id,
            "key": key,
            **({"version_id": version_id} if version_id else {}),
        },
        expected_status=200,
        stream=True,
    )
    try:
        return response.content
    finally:
        response.close()


def _list_current_objects(manager_session: BackendSession, account_id: int, bucket_name: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    continuation_token: str | None = None
    while True:
        params: dict[str, Any] = {"account_id": account_id}
        if continuation_token:
            params["continuation_token"] = continuation_token
        payload = manager_session.get(
            f"/manager/buckets/{bucket_name}/objects",
            params=params,
        )
        objects.extend(payload.get("objects") or [])
        continuation_token = payload.get("next_continuation_token")
        if not payload.get("is_truncated"):
            break
    return objects


def _list_bucket_names(manager_session: BackendSession, account_id: int) -> list[str]:
    payload = manager_session.get("/browser/buckets", params=_account_params(account_id))
    return sorted(str(entry.get("name") or "") for entry in payload or [] if entry.get("name"))


def _bucket_exists(manager_session: BackendSession, account_id: int, bucket_name: str) -> bool:
    return bucket_name in _list_bucket_names(manager_session, account_id)


def _normalize_tags(payload: dict[str, Any]) -> dict[str, str]:
    return {
        str(entry.get("key") or ""): str(entry.get("value") or "")
        for entry in (payload.get("tags") or [])
        if str(entry.get("key") or "").strip()
    }


def _snapshot_current_bucket(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for entry in _list_current_objects(manager_session, account_id, bucket_name):
        key = str(entry.get("key") or "")
        meta = manager_session.get(
            f"/browser/buckets/{bucket_name}/object-meta",
            params={"account_id": account_id, "key": key},
        )
        tags = manager_session.get(
            f"/browser/buckets/{bucket_name}/object-tags",
            params={"account_id": account_id, "key": key},
        )
        snapshot[key] = {
            "size": int(meta.get("size") or 0),
            "etag": meta.get("etag"),
            "content_type": meta.get("content_type"),
            "cache_control": meta.get("cache_control"),
            "content_disposition": meta.get("content_disposition"),
            "content_encoding": meta.get("content_encoding"),
            "content_language": meta.get("content_language"),
            "storage_class": meta.get("storage_class"),
            "metadata": dict(sorted((meta.get("metadata") or {}).items())),
            "tags": _normalize_tags(tags),
            "bytes": _download_bytes(manager_session, account_id, bucket_name, key),
        }
    return snapshot


def _list_all_versions(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    key: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    versions: list[dict[str, Any]] = []
    delete_markers: list[dict[str, Any]] = []
    key_marker: str | None = None
    version_id_marker: str | None = None
    while True:
        params: dict[str, Any] = {"account_id": account_id, "max_keys": 1000}
        if key:
            params["key"] = key
        if key_marker:
            params["key_marker"] = key_marker
        if version_id_marker:
            params["version_id_marker"] = version_id_marker
        payload = manager_session.get(
            f"/browser/buckets/{bucket_name}/versions",
            params=params,
        )
        versions.extend(payload.get("versions") or [])
        delete_markers.extend(payload.get("delete_markers") or [])
        if not payload.get("is_truncated"):
            break
        key_marker = payload.get("next_key_marker")
        version_id_marker = payload.get("next_version_id_marker")
    return {"versions": versions, "delete_markers": delete_markers}


def _latest_version_id(manager_session: BackendSession, account_id: int, bucket_name: str, key: str) -> str:
    payload = _list_all_versions(manager_session, account_id, bucket_name, key=key)
    latest_candidates = [
        entry
        for entry in payload["versions"] + payload["delete_markers"]
        if str(entry.get("key") or "") == key and bool(entry.get("is_latest"))
    ]
    if not latest_candidates:
        raise AssertionError(f"No latest version found for {bucket_name}/{key}")
    version_id = latest_candidates[0].get("version_id")
    if not version_id:
        raise AssertionError(f"Latest version for {bucket_name}/{key} has no version_id")
    return str(version_id)


def _snapshot_versioned_bucket(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
) -> dict[str, list[dict[str, Any]]]:
    payload = _list_all_versions(manager_session, account_id, bucket_name)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in payload["versions"]:
        key = str(entry.get("key") or "")
        grouped.setdefault(key, []).append({"kind": "object", **entry})
    for entry in payload["delete_markers"]:
        key = str(entry.get("key") or "")
        grouped.setdefault(key, []).append({"kind": "delete_marker", **entry})

    snapshot: dict[str, list[dict[str, Any]]] = {}
    for key, entries in sorted(grouped.items()):
        normalized_entries_with_sort: list[tuple[tuple[str, int, str], dict[str, Any]]] = []
        for item in entries:
            version_id = item.get("version_id")
            if item.get("kind") == "delete_marker":
                normalized_entry = {
                    "kind": "delete_marker",
                    "is_latest": bool(item.get("is_latest")),
                }
                normalized_entries_with_sort.append(
                    (
                        (
                            str(item.get("last_modified") or ""),
                            1,
                            _stable_dump(normalized_entry),
                        ),
                        normalized_entry,
                    )
                )
                continue
            meta = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-meta",
                params={"account_id": account_id, "key": key, "version_id": version_id},
            )
            tags = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-tags",
                params={"account_id": account_id, "key": key, "version_id": version_id},
            )
            normalized_entry = {
                "kind": "object",
                "is_latest": bool(item.get("is_latest")),
                "size": int(meta.get("size") or 0),
                "etag": meta.get("etag"),
                "content_type": meta.get("content_type"),
                "cache_control": meta.get("cache_control"),
                "content_disposition": meta.get("content_disposition"),
                "content_encoding": meta.get("content_encoding"),
                "content_language": meta.get("content_language"),
                "storage_class": meta.get("storage_class"),
                "metadata": dict(sorted((meta.get("metadata") or {}).items())),
                "tags": _normalize_tags(tags),
                "bytes": _download_bytes(
                    manager_session,
                    account_id,
                    bucket_name,
                    key,
                    version_id=str(version_id) if version_id else None,
                ),
            }
            normalized_entries_with_sort.append(
                (
                    (
                        str(item.get("last_modified") or ""),
                        0,
                        _stable_dump(normalized_entry),
                    ),
                    normalized_entry,
                )
            )
        snapshot[key] = [
            normalized_entry
            for _sort_key, normalized_entry in sorted(normalized_entries_with_sort, key=lambda item: item[0])
        ]
    return snapshot


def _assert_versioned_snapshot_matches(
    actual: dict[str, list[dict[str, Any]]],
    expected: dict[str, list[dict[str, Any]]],
) -> None:
    assert _normalize_value(actual) == _normalize_value(expected)


def _wait_for_migration_state(
    super_admin_session: BackendSession,
    migration_id: int,
    expected_statuses: set[str],
    *,
    timeout: float = 180.0,
    interval: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_detail: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last_detail = super_admin_session.get(f"/manager/migrations/{migration_id}")
        status = str(last_detail.get("status") or "")
        if status in expected_statuses:
            return last_detail
        if status in _MIGRATION_FINAL_STATUSES and status not in expected_statuses:
            raise AssertionError(_format_migration_failure(last_detail))
        time.sleep(interval)
    if last_detail is None:
        last_detail = super_admin_session.get(f"/manager/migrations/{migration_id}")
    raise AssertionError(
        "Migration did not reach the expected state before timeout. "
        "Ensure the backend is reachable and BUCKET_MIGRATION_WORKER_ENABLED=true.\n"
        + _format_migration_failure(last_detail)
    )


def _format_migration_failure(detail: dict[str, Any]) -> str:
    status = detail.get("status")
    error_message = detail.get("error_message")
    items = detail.get("items") or []
    events = detail.get("recent_events") or []
    item_lines = [
        (
            f"{item.get('source_bucket')} -> {item.get('target_bucket')}: "
            f"status={item.get('status')} step={item.get('step')} "
            f"error={item.get('error_message')}"
        )
        for item in items
    ]
    event_lines = [
        f"{entry.get('level')}: {entry.get('message')}"
        for entry in events[-8:]
    ]
    message_parts = [
        f"migration status={status}",
    ]
    if error_message:
        message_parts.append(f"error={error_message}")
    if item_lines:
        message_parts.append("items=" + " | ".join(item_lines))
    if event_lines:
        message_parts.append("recent_events=" + " | ".join(event_lines))
    return "\n".join(message_parts)


def _create_migration(
    super_admin_session: BackendSession,
    resource_tracker: ResourceTracker,
    *,
    source_context_id: str,
    target_context_id: str,
    source_bucket: str,
    target_bucket: str,
    mode: str = "one_shot",
    copy_bucket_settings: bool = False,
    delete_source: bool = False,
    strong_integrity_check: bool = False,
    lock_target_writes: bool = True,
    use_same_endpoint_copy: bool = False,
    auto_grant_source_read_for_copy: bool | None = None,
    parallelism_max: int = 4,
) -> dict[str, Any]:
    payload = {
        "source_context_id": source_context_id,
        "target_context_id": target_context_id,
        "buckets": [{"source_bucket": source_bucket, "target_bucket": target_bucket}],
        "mode": mode,
        "copy_bucket_settings": copy_bucket_settings,
        "delete_source": delete_source,
        "strong_integrity_check": strong_integrity_check,
        "lock_target_writes": lock_target_writes,
        "use_same_endpoint_copy": use_same_endpoint_copy,
        "parallelism_max": parallelism_max,
    }
    if auto_grant_source_read_for_copy is not None:
        payload["auto_grant_source_read_for_copy"] = auto_grant_source_read_for_copy
    detail = super_admin_session.post(
        "/manager/migrations",
        json=payload,
        expected_status=201,
    )
    resource_tracker.track_migration(int(detail["id"]))
    return detail


def _run_precheck(super_admin_session: BackendSession, migration_id: int) -> dict[str, Any]:
    return super_admin_session.post(f"/manager/migrations/{migration_id}/precheck")


def _start_migration(
    super_admin_session: BackendSession,
    migration_id: int,
    *,
    expected_status: int | tuple[int, ...] = 200,
) -> dict[str, Any]:
    return super_admin_session.post(
        f"/manager/migrations/{migration_id}/start",
        expected_status=expected_status,
    )


def _continue_migration(super_admin_session: BackendSession, migration_id: int) -> dict[str, Any]:
    return super_admin_session.post(f"/manager/migrations/{migration_id}/continue")


def _find_precheck_item(detail: dict[str, Any], source_bucket: str, target_bucket: str) -> dict[str, Any]:
    report = detail.get("precheck_report") or {}
    for item in report.get("items") or []:
        if item.get("source_bucket") == source_bucket and item.get("target_bucket") == target_bucket:
            return item
    raise AssertionError(f"Unable to locate precheck report item for {source_bucket} -> {target_bucket}")


def _precheck_codes(precheck_item: dict[str, Any]) -> set[str]:
    return {str(entry.get("code") or "") for entry in precheck_item.get("checks") or []}


def _configure_supported_bucket_settings(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
) -> dict[str, Any]:
    configured: dict[str, Any] = {}
    candidates = [
        (
            "tags",
            lambda: manager_session.put(
                f"/manager/buckets/{bucket_name}/tags",
                params=_account_params(account_id),
                json={
                    "tags": [
                        {"key": "suite", "value": "migration-live"},
                        {"key": "scope", "value": "copy-settings"},
                    ]
                },
            ),
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/tags",
                params=_account_params(account_id),
            ),
        ),
        (
            "lifecycle",
            lambda: manager_session.put(
                f"/manager/buckets/{bucket_name}/lifecycle",
                params=_account_params(account_id),
                json={
                    "rules": [
                        {
                            "ID": "expire-temp",
                            "Status": "Enabled",
                            "Prefix": "tmp/",
                            "Expiration": {"Days": 7},
                        }
                    ]
                },
            ),
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/lifecycle",
                params=_account_params(account_id),
            ),
        ),
        (
            "cors",
            lambda: manager_session.put(
                f"/manager/buckets/{bucket_name}/cors",
                params=_account_params(account_id),
                json={
                    "rules": [
                        {
                            "AllowedHeaders": ["*"],
                            "AllowedMethods": ["GET", "PUT"],
                            "AllowedOrigins": ["https://example.com"],
                            "ExposeHeaders": ["x-amz-meta-suite"],
                            "MaxAgeSeconds": 300,
                        }
                    ]
                },
            ),
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/cors",
                params=_account_params(account_id),
            ),
        ),
        (
            "public_access_block",
            lambda: manager_session.put(
                f"/manager/buckets/{bucket_name}/public-access-block",
                params=_account_params(account_id),
                json={
                    "block_public_acls": False,
                    "ignore_public_acls": False,
                    "block_public_policy": True,
                    "restrict_public_buckets": True,
                },
            ),
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/public-access-block",
                params=_account_params(account_id),
            ),
        ),
    ]
    for name, apply_fn, fetch_fn in candidates:
        try:
            apply_fn()
        except BackendAPIError as exc:
            detail = backend_error_detail(exc).strip().lower()
            if looks_unsupported(exc) or "accessdenied" in detail:
                continue
            raise
        current_value = fetch_fn()
        if current_value:
            configured[name] = current_value
    return configured


def _configure_unsupported_bucket_setting(
    manager_session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    topic_arn_holder: dict[str, str],
    resource_tracker: ResourceTracker,
    test_prefix: str,
) -> str:
    website_payload = {
        "index_document": "index.html",
        "error_document": "error.html",
    }
    try:
        manager_session.put(
            f"/manager/buckets/{bucket_name}/website",
            params=_account_params(account_id),
            json=website_payload,
        )
        _wait_for_value(
            "bucket website configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/website",
                params=_account_params(account_id),
            ),
            lambda current: current.get("index_document") == "index.html",
            timeout=20.0,
        )
        return "website"
    except BackendAPIError as exc:
        if not looks_unsupported(exc):
            raise

    topic_name = _topic_name(test_prefix, "notify")
    try:
        topic = run_or_skip(
            "manager topic creation",
            lambda: manager_session.post(
                "/manager/topics",
                params=_account_params(account_id),
                json={"name": topic_name},
                expected_status=201,
            ),
        )
        topic_arn = str(topic.get("arn") or "")
        topic_arn_holder["arn"] = topic_arn
        manager_session.put(
            f"/manager/buckets/{bucket_name}/notifications",
            params=_account_params(account_id),
            json={
                "configuration": {
                    "TopicConfigurations": [
                        {
                            "Id": "ObjectCreateAll",
                            "TopicArn": topic_arn,
                            "Events": ["s3:ObjectCreated:*"],
                        }
                    ]
                }
            },
        )
        _wait_for_value(
            "bucket notifications configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/notifications",
                params=_account_params(account_id),
            ),
            lambda current: bool((current.get("configuration") or {}).get("TopicConfigurations")),
            timeout=20.0,
        )
        return "notifications"
    except BackendAPIError as exc:
        if not looks_unsupported(exc):
            raise
        _delete_topic(manager_session, account_id, topic_arn_holder.get("arn", ""))
        topic_arn_holder.clear()

    replication_target = _bucket_name(test_prefix, "replication-dst")
    _create_bucket(manager_session, account_id, replication_target, versioning=True)
    resource_tracker.track_bucket(account_id, replication_target)
    try:
        manager_session.put(
            f"/manager/buckets/{bucket_name}/versioning",
            params=_account_params(account_id),
            json={"enabled": True},
        )
        _wait_for_value(
            "bucket versioning",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/properties",
                params=_account_params(account_id),
            ),
            lambda current: current.get("versioning_status") == "Enabled",
            timeout=20.0,
        )
        manager_session.put(
            f"/manager/buckets/{replication_target}/versioning",
            params=_account_params(account_id),
            json={"enabled": True},
        )
        _wait_for_value(
            "replication target versioning",
            lambda: manager_session.get(
                f"/manager/buckets/{replication_target}/properties",
                params=_account_params(account_id),
            ),
            lambda current: current.get("versioning_status") == "Enabled",
            timeout=20.0,
        )
        manager_session.put(
            f"/manager/buckets/{bucket_name}/replication",
            params=_account_params(account_id),
            json={
                "configuration": {
                    "Role": "arn:aws:iam::000000000000:role/manager-functional-replication",
                    "Rules": [
                        {
                            "ID": "replicate-all",
                            "Status": "Enabled",
                            "Priority": 1,
                            "Filter": {"Prefix": ""},
                            "DeleteMarkerReplication": {"Status": "Disabled"},
                            "Destination": {"Bucket": f"arn:aws:s3:::{replication_target}"},
                        }
                    ],
                }
            },
        )
        _wait_for_value(
            "bucket replication configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/replication",
                params=_account_params(account_id),
            ),
            lambda current: bool((current.get("configuration") or {}).get("Rules")),
            timeout=20.0,
        )
        return "replication"
    except BackendAPIError as exc:
        if looks_unsupported(exc):
            pytest.skip(f"No unsupported bucket setting configurable on this cluster: {exc}")
        raise


def _prepare_versioned_history(
    manager_session: BackendSession,
    account_id: int,
    source_bucket: str,
    staging_bucket: str,
) -> None:
    _upload_bytes(
        manager_session,
        account_id,
        staging_bucket,
        "seed-alpha-a.txt",
        b"alpha-v1",
        content_type="text/plain",
    )
    _copy_object(
        manager_session,
        account_id,
        source_bucket,
        source_bucket=staging_bucket,
        source_key="seed-alpha-a.txt",
        destination_key="docs/alpha.txt",
    )
    _sleep_for_version_gap()
    first_alpha_version = _latest_version_id(manager_session, account_id, source_bucket, "docs/alpha.txt")
    _set_object_metadata(
        manager_session,
        account_id,
        source_bucket,
        "docs/alpha.txt",
        version_id=first_alpha_version,
        content_type="text/plain",
        metadata={"phase": "first", "variant": "alpha-a"},
        cache_control="max-age=60",
        content_language="fr",
    )
    _sleep_for_version_gap()
    _set_object_tags(
        manager_session,
        account_id,
        source_bucket,
        "docs/alpha.txt",
        {"series": "alpha", "revision": "1"},
        version_id=_latest_version_id(manager_session, account_id, source_bucket, "docs/alpha.txt"),
    )
    _sleep_for_version_gap()

    _upload_bytes(
        manager_session,
        account_id,
        staging_bucket,
        "seed-alpha-b.txt",
        b"alpha-v2",
        content_type="text/plain",
    )
    _copy_object(
        manager_session,
        account_id,
        source_bucket,
        source_bucket=staging_bucket,
        source_key="seed-alpha-b.txt",
        destination_key="docs/alpha.txt",
    )
    _sleep_for_version_gap()
    second_alpha_version = _latest_version_id(manager_session, account_id, source_bucket, "docs/alpha.txt")
    _set_object_metadata(
        manager_session,
        account_id,
        source_bucket,
        "docs/alpha.txt",
        version_id=second_alpha_version,
        content_type="text/plain",
        metadata={"phase": "second", "variant": "alpha-b"},
        cache_control="max-age=120",
        content_language="en",
    )
    _sleep_for_version_gap()
    _set_object_tags(
        manager_session,
        account_id,
        source_bucket,
        "docs/alpha.txt",
        {"series": "alpha", "revision": "2"},
        version_id=_latest_version_id(manager_session, account_id, source_bucket, "docs/alpha.txt"),
    )
    _sleep_for_version_gap()
    _delete_browser_objects(
        manager_session,
        account_id,
        source_bucket,
        [{"key": "docs/alpha.txt"}],
    )
    _sleep_for_version_gap()

    _upload_bytes(
        manager_session,
        account_id,
        staging_bucket,
        "seed-beta.txt",
        b"beta-v1",
        content_type="text/plain",
    )
    _copy_object(
        manager_session,
        account_id,
        source_bucket,
        source_bucket=staging_bucket,
        source_key="seed-beta.txt",
        destination_key="docs/beta.txt",
    )
    _sleep_for_version_gap()
    latest_beta = _latest_version_id(manager_session, account_id, source_bucket, "docs/beta.txt")
    _set_object_metadata(
        manager_session,
        account_id,
        source_bucket,
        "docs/beta.txt",
        version_id=latest_beta,
        content_type="text/plain",
        metadata={"series": "beta", "revision": "1"},
    )
    _sleep_for_version_gap()
    _set_object_tags(
        manager_session,
        account_id,
        source_bucket,
        "docs/beta.txt",
        {"series": "beta", "revision": "1"},
        version_id=_latest_version_id(manager_session, account_id, source_bucket, "docs/beta.txt"),
    )

def test_bucket_migration_one_shot_current_only_same_endpoint(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-cur-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-cur-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)

    _upload_bytes(source.manager_session, source.account_id, source_bucket, "root.txt", b"root-current", content_type="text/plain")
    _upload_bytes(
        source.manager_session,
        source.account_id,
        source_bucket,
        "nested/path/report.json",
        b'{"ok":true,"scope":"current-only"}',
        content_type="application/json",
    )
    _upload_bytes(source.manager_session, source.account_id, source_bucket, "metadata.bin", b"meta-current", content_type="application/octet-stream")
    _set_object_metadata(
        source.manager_session,
        source.account_id,
        source_bucket,
        "metadata.bin",
        metadata={"suite": "migration-live", "case": "current-only"},
        content_type="application/octet-stream",
        cache_control="max-age=30",
    )
    _set_object_tags(
        source.manager_session,
        source.account_id,
        source_bucket,
        "metadata.bin",
        {"suite": "migration-live", "case": "current-only"},
    )

    expected_snapshot = _snapshot_current_bucket(source.manager_session, source.account_id, source_bucket)

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        use_same_endpoint_copy=True,
        auto_grant_source_read_for_copy=True,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "passed"
    precheck_item = _find_precheck_item(detail, source_bucket, target_bucket)
    assert precheck_item["strategy"] == "current_only"

    _start_migration(super_admin_session, int(migration["id"]))
    final_detail = _wait_for_migration_state(
        super_admin_session,
        int(migration["id"]),
        {"completed"},
    )
    assert final_detail["status"] == "completed"
    assert _snapshot_current_bucket(target.manager_session, target.account_id, target_bucket) == expected_snapshot
    assert _bucket_exists(source.manager_session, source.account_id, source_bucket) is True


def test_bucket_migration_one_shot_current_only_copy_bucket_settings(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-cfg-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-cfg-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)

    configured_settings = _configure_supported_bucket_settings(
        source.manager_session,
        source.account_id,
        source_bucket,
    )
    if not configured_settings:
        pytest.skip("No supported bucket setting could be configured on this cluster for copy_bucket_settings=true")

    _upload_bytes(source.manager_session, source.account_id, source_bucket, "copy-settings.txt", b"copy-settings", content_type="text/plain")
    expected_snapshot = _snapshot_current_bucket(source.manager_session, source.account_id, source_bucket)

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        copy_bucket_settings=True,
        use_same_endpoint_copy=False,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "passed"
    _start_migration(super_admin_session, int(migration["id"]))
    final_detail = _wait_for_migration_state(super_admin_session, int(migration["id"]), {"completed"})
    assert final_detail["status"] == "completed"
    assert _snapshot_current_bucket(target.manager_session, target.account_id, target_bucket) == expected_snapshot

    fetch_map = {
        "tags": lambda: target.manager_session.get(
            f"/manager/buckets/{target_bucket}/tags",
            params=_account_params(target.account_id),
        ),
        "lifecycle": lambda: target.manager_session.get(
            f"/manager/buckets/{target_bucket}/lifecycle",
            params=_account_params(target.account_id),
        ),
        "cors": lambda: target.manager_session.get(
            f"/manager/buckets/{target_bucket}/cors",
            params=_account_params(target.account_id),
        ),
        "public_access_block": lambda: target.manager_session.get(
            f"/manager/buckets/{target_bucket}/public-access-block",
            params=_account_params(target.account_id),
        ),
    }
    for setting_name, expected_value in configured_settings.items():
        assert _normalize_value(fetch_map[setting_name]()) == _normalize_value(expected_value)


def test_bucket_migration_pre_sync_current_only_replays_delta(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-presync-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-presync-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)

    _upload_bytes(source.manager_session, source.account_id, source_bucket, "docs/keep.txt", b"keep-v1", content_type="text/plain")
    _upload_bytes(source.manager_session, source.account_id, source_bucket, "docs/overwrite.txt", b"overwrite-v1", content_type="text/plain")
    _upload_bytes(source.manager_session, source.account_id, source_bucket, "docs/delete.txt", b"delete-v1", content_type="text/plain")

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        mode="pre_sync",
        copy_bucket_settings=False,
        delete_source=False,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "passed"
    _start_migration(super_admin_session, int(migration["id"]))
    _wait_for_migration_state(super_admin_session, int(migration["id"]), {"awaiting_cutover"})

    _upload_bytes(source.manager_session, source.account_id, source_bucket, "docs/new.txt", b"new-v1", content_type="text/plain")
    _upload_bytes(source.manager_session, source.account_id, source_bucket, "docs/overwrite.txt", b"overwrite-v2", content_type="text/plain")
    _delete_browser_objects(
        source.manager_session,
        source.account_id,
        source_bucket,
        [{"key": "docs/delete.txt"}],
    )
    expected_snapshot = _snapshot_current_bucket(source.manager_session, source.account_id, source_bucket)

    _continue_migration(super_admin_session, int(migration["id"]))
    final_detail = _wait_for_migration_state(super_admin_session, int(migration["id"]), {"completed"})
    assert final_detail["status"] == "completed"
    assert _snapshot_current_bucket(target.manager_session, target.account_id, target_bucket) == expected_snapshot


def test_bucket_migration_one_shot_version_aware_deletes_source(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-ver-src")
    staging_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-ver-stage")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-ver-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket, versioning=True)
    _create_bucket(source.manager_session, source.account_id, staging_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, staging_bucket)

    _prepare_versioned_history(source.manager_session, source.account_id, source_bucket, staging_bucket)
    expected_snapshot = _snapshot_versioned_bucket(source.manager_session, source.account_id, source_bucket)

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        delete_source=True,
        use_same_endpoint_copy=True,
        auto_grant_source_read_for_copy=True,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "passed"
    precheck_item = _find_precheck_item(detail, source_bucket, target_bucket)
    assert precheck_item["strategy"] == "version_aware"

    _start_migration(super_admin_session, int(migration["id"]))
    final_detail = _wait_for_migration_state(super_admin_session, int(migration["id"]), {"completed"})
    assert final_detail["status"] == "completed"
    _assert_versioned_snapshot_matches(
        _snapshot_versioned_bucket(target.manager_session, target.account_id, target_bucket),
        expected_snapshot,
    )
    assert _bucket_exists(source.manager_session, source.account_id, source_bucket) is False
    resource_tracker.discard_bucket(source.account_id, source_bucket)


def test_bucket_migration_pre_sync_version_aware_replays_delta(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-vpre-src")
    staging_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-vpre-stage")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-vpre-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket, versioning=True)
    _create_bucket(source.manager_session, source.account_id, staging_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, staging_bucket)

    _prepare_versioned_history(source.manager_session, source.account_id, source_bucket, staging_bucket)

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        mode="pre_sync",
        copy_bucket_settings=False,
        delete_source=False,
        use_same_endpoint_copy=False,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "passed"
    precheck_item = _find_precheck_item(detail, source_bucket, target_bucket)
    assert precheck_item["strategy"] == "version_aware"

    _start_migration(super_admin_session, int(migration["id"]))
    _wait_for_migration_state(super_admin_session, int(migration["id"]), {"awaiting_cutover"})

    _upload_bytes(
        source.manager_session,
        source.account_id,
        staging_bucket,
        "seed-beta-v2.txt",
        b"beta-v2",
        content_type="text/plain",
    )
    _copy_object(
        source.manager_session,
        source.account_id,
        source_bucket,
        source_bucket=staging_bucket,
        source_key="seed-beta-v2.txt",
        destination_key="docs/beta.txt",
    )
    _sleep_for_version_gap()
    latest_beta = _latest_version_id(source.manager_session, source.account_id, source_bucket, "docs/beta.txt")
    _set_object_metadata(
        source.manager_session,
        source.account_id,
        source_bucket,
        "docs/beta.txt",
        version_id=latest_beta,
        content_type="text/plain",
        metadata={"series": "beta", "revision": "2"},
    )
    _sleep_for_version_gap()
    _set_object_tags(
        source.manager_session,
        source.account_id,
        source_bucket,
        "docs/beta.txt",
        {"series": "beta", "revision": "2"},
        version_id=_latest_version_id(source.manager_session, source.account_id, source_bucket, "docs/beta.txt"),
    )
    _sleep_for_version_gap()
    _delete_browser_objects(
        source.manager_session,
        source.account_id,
        source_bucket,
        [{"key": "docs/beta.txt"}],
    )
    expected_snapshot = _snapshot_versioned_bucket(source.manager_session, source.account_id, source_bucket)

    _continue_migration(super_admin_session, int(migration["id"]))
    final_detail = _wait_for_migration_state(super_admin_session, int(migration["id"]), {"completed"})
    assert final_detail["status"] == "completed"
    _assert_versioned_snapshot_matches(
        _snapshot_versioned_bucket(target.manager_session, target.account_id, target_bucket),
        expected_snapshot,
    )


def test_bucket_migration_precheck_fails_for_unsupported_bucket_settings(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-unsup-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-unsup-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket)
    resource_tracker.track_bucket(source.account_id, source_bucket)

    topic_arn_holder: dict[str, str] = {}
    try:
        configured_kind = _configure_unsupported_bucket_setting(
            source.manager_session,
            source.account_id,
            source_bucket,
            topic_arn_holder=topic_arn_holder,
            resource_tracker=resource_tracker,
            test_prefix=ceph_test_settings.test_prefix,
        )
        _upload_bytes(source.manager_session, source.account_id, source_bucket, "seed.txt", b"unsupported-setting")

        migration = _create_migration(
            super_admin_session,
            resource_tracker,
            source_context_id=str(source.account_id),
            target_context_id=str(target.account_id),
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            copy_bucket_settings=True,
        )
        detail = _run_precheck(super_admin_session, int(migration["id"]))
        assert detail["precheck_status"] == "failed"
        precheck_item = _find_precheck_item(detail, source_bucket, target_bucket)
        assert "unsupported_bucket_settings_configured" in _precheck_codes(precheck_item)
        with pytest.raises(BackendAPIError) as exc_info:
            _start_migration(super_admin_session, int(migration["id"]))
        assert exc_info.value.status_code == 400
        assert "Precheck must pass before start" in str(exc_info.value.payload)
        assert configured_kind in {"website", "notifications", "replication"}
    finally:
        _delete_topic(source.manager_session, source.account_id, topic_arn_holder.get("arn", ""))


def test_bucket_migration_precheck_fails_for_object_lock_governance_when_supported(
    ceph_test_settings: CephTestSettings,
    account_factory,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    source = account_factory()
    target = account_factory()
    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-lock-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "mig-lock-dst")

    _create_bucket(source.manager_session, source.account_id, source_bucket, versioning=True)
    resource_tracker.track_bucket(source.account_id, source_bucket)

    try:
        source.manager_session.put(
            f"/manager/buckets/{source_bucket}/object-lock",
            params=_account_params(source.account_id),
            json={"enabled": True, "mode": "GOVERNANCE", "days": 1},
        )
    except BackendAPIError as exc:
        _skip_if_cluster_unavailable("manager bucket object-lock", exc)
        pytest.skip(f"Object-lock governance cannot be configured on this cluster: {exc}")

    migration = _create_migration(
        super_admin_session,
        resource_tracker,
        source_context_id=str(source.account_id),
        target_context_id=str(target.account_id),
        source_bucket=source_bucket,
        target_bucket=target_bucket,
    )
    detail = _run_precheck(super_admin_session, int(migration["id"]))
    assert detail["precheck_status"] == "failed"
    precheck_item = _find_precheck_item(detail, source_bucket, target_bucket)
    assert "object_lock_governance_not_supported" in _precheck_codes(precheck_item)
