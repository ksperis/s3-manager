# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import time
import uuid
from typing import Any

import pytest
import requests

from .clients import BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker

pytestmark = pytest.mark.ceph_functional

_PART_SIZE = 8 * 1024 * 1024


def _bucket_name(prefix: str, label: str = "browser-clipboard") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _account_params(account_id: int) -> dict[str, int]:
    return {"account_id": account_id}


def _s3_verify(ceph_test_settings: CephTestSettings) -> bool | str:
    return ceph_test_settings.rgw_ca_bundle or ceph_test_settings.rgw_verify_tls


def _normalize_etag(value: Any) -> str:
    cleaned = str(value or "").strip()
    if len(cleaned) >= 2 and cleaned.startswith('"') and cleaned.endswith('"'):
        return cleaned[1:-1]
    return cleaned


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


def _grant_account_root_access(
    admin_session: BackendSession,
    user_id: int,
    account_id: int,
) -> None:
    admin_session.post(
        f"/admin/users/{user_id}/assign-account",
        json={"account_id": account_id, "account_root": True},
        expected_status=200,
    )


def _upload_bytes(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    payload: bytes,
    *,
    content_type: str,
    filename: str | None = None,
) -> None:
    response = session.request(
        "POST",
        f"/browser/buckets/{bucket_name}/proxy-upload",
        params=_account_params(account_id),
        data={"key": key, "content_type": content_type},
        files={"file": (filename or key.rsplit("/", 1)[-1] or "upload.bin", io.BytesIO(payload), content_type)},
        expected_status=200,
    )
    response.close()


def _create_folder(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    prefix: str,
) -> None:
    session.post(
        f"/browser/buckets/{bucket_name}/folders",
        params=_account_params(account_id),
        json={"prefix": prefix},
    )


def _set_object_tags(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    tags: dict[str, str],
) -> None:
    session.put(
        f"/browser/buckets/{bucket_name}/object-tags",
        params=_account_params(account_id),
        json={
            "key": key,
            "tags": [{"key": tag_key, "value": value} for tag_key, value in sorted(tags.items())],
        },
    )


def _set_object_metadata(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    content_type: str,
    metadata: dict[str, str],
) -> None:
    session.put(
        f"/browser/buckets/{bucket_name}/object-meta",
        params=_account_params(account_id),
        json={
            "key": key,
            "content_type": content_type,
            "metadata": metadata,
        },
    )


def _copy_object(
    session: BackendSession,
    account_id: int,
    destination_bucket: str,
    *,
    source_bucket: str,
    source_key: str,
    destination_key: str,
    move: bool = False,
) -> None:
    session.post(
        f"/browser/buckets/{destination_bucket}/copy",
        params=_account_params(account_id),
        json={
            "source_bucket": source_bucket,
            "source_key": source_key,
            "destination_key": destination_key,
            "move": move,
        },
    )


def _delete_object(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> None:
    session.post(
        f"/browser/buckets/{bucket_name}/delete",
        params=_account_params(account_id),
        json={"objects": [{"key": key}]},
    )


def _download_bytes(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> bytes:
    response = session.request(
        "GET",
        f"/browser/buckets/{bucket_name}/download",
        params={"account_id": account_id, "key": key},
        expected_status=200,
        stream=True,
    )
    try:
        return response.content
    finally:
        response.close()


def _head_object(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> dict[str, Any]:
    return session.get(
        f"/browser/buckets/{bucket_name}/object-meta",
        params={"account_id": account_id, "key": key},
    )


def _get_object_tags(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> dict[str, str]:
    payload = session.get(
        f"/browser/buckets/{bucket_name}/object-tags",
        params={"account_id": account_id, "key": key},
    )
    return {
        str(entry.get("key") or ""): str(entry.get("value") or "")
        for entry in (payload.get("tags") or [])
        if str(entry.get("key") or "").strip()
    }


def _list_all_objects(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    prefix: str = "",
) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    continuation_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "account_id": account_id,
            "prefix": prefix,
            "recursive": "true",
            "max_keys": 1000,
        }
        if continuation_token:
            params["continuation_token"] = continuation_token
        payload = session.get(
            f"/browser/buckets/{bucket_name}/objects",
            params=params,
        )
        objects.extend(payload.get("objects") or [])
        continuation_token = payload.get("next_continuation_token")
        if not payload.get("is_truncated"):
            break
    return objects


def _list_object_keys(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    prefix: str = "",
) -> set[str]:
    return {
        str(entry.get("key") or "")
        for entry in _list_all_objects(session, account_id, bucket_name, prefix=prefix)
        if str(entry.get("key") or "").strip()
    }


def _list_all_prefixes(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    prefix: str = "",
) -> set[str]:
    prefixes: set[str] = set()
    continuation_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "account_id": account_id,
            "prefix": prefix,
            "recursive": "true",
            "max_keys": 1000,
        }
        if continuation_token:
            params["continuation_token"] = continuation_token
        payload = session.get(
            f"/browser/buckets/{bucket_name}/objects",
            params=params,
        )
        prefixes.update(
            str(entry or "")
            for entry in (payload.get("prefixes") or [])
            if str(entry or "").strip()
        )
        continuation_token = payload.get("next_continuation_token")
        if not payload.get("is_truncated"):
            break
    return prefixes


def _list_versions(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    *,
    key: str,
) -> dict[str, Any]:
    return session.get(
        f"/browser/buckets/{bucket_name}/versions",
        params={"account_id": account_id, "key": key, "max_keys": 1000},
    )


def _wait_for_object_presence(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    timeout: float = 20.0,
    interval: float = 0.5,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if key in _list_object_keys(session, account_id, bucket_name):
            return
        time.sleep(interval)
    raise AssertionError(f"Object '{bucket_name}/{key}' not visible after upload/copy")


def _wait_for_object_absence(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    timeout: float = 20.0,
    interval: float = 0.5,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if key not in _list_object_keys(session, account_id, bucket_name):
            return
        time.sleep(interval)
    raise AssertionError(f"Object '{bucket_name}/{key}' still visible after deletion/move")


def _assert_object_matches(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    expected_bytes: bytes,
    expected_content_type: str,
    expected_metadata: dict[str, str] | None = None,
    expected_tags: dict[str, str] | None = None,
) -> None:
    _wait_for_object_presence(session, account_id, bucket_name, key)
    metadata = _head_object(session, account_id, bucket_name, key)
    assert int(metadata.get("size") or 0) == len(expected_bytes)
    assert metadata.get("content_type") == expected_content_type
    if expected_metadata is not None:
        assert dict(sorted((metadata.get("metadata") or {}).items())) == dict(sorted(expected_metadata.items()))
    if expected_tags is not None:
        assert _get_object_tags(session, account_id, bucket_name, key) == dict(sorted(expected_tags.items()))
    assert _download_bytes(session, account_id, bucket_name, key) == expected_bytes


def _perform_presigned_request(
    ceph_test_settings: CephTestSettings,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
) -> requests.Response:
    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            data=data,
            timeout=ceph_test_settings.request_timeout,
            verify=_s3_verify(ceph_test_settings),
        )
    except requests.RequestException as exc:
        pytest.skip(f"Presigned S3 endpoint is not reachable from the test runner: {exc}")
    if response.status_code >= 400:
        body = response.text[:400]
        raise AssertionError(
            f"Unexpected response for presigned {method} {url}: status={response.status_code} body={body}"
        )
    return response


def _presign_object(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    operation: str,
    content_type: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "key": key,
        "operation": operation,
        "expires_in": 1800,
    }
    if content_type:
        payload["content_type"] = content_type
    return session.post(
        f"/browser/buckets/{bucket_name}/presign",
        params=_account_params(account_id),
        json=payload,
    )


def _direct_copy_between_accounts(
    session: BackendSession,
    ceph_test_settings: CephTestSettings,
    *,
    source_account_id: int,
    source_bucket: str,
    source_key: str,
    destination_account_id: int,
    destination_bucket: str,
    destination_key: str,
    multipart: bool = False,
    move: bool = False,
) -> None:
    source_meta = _head_object(session, source_account_id, source_bucket, source_key)
    download_presign = _presign_object(
        session,
        source_account_id,
        source_bucket,
        source_key,
        operation="get_object",
    )
    download_response = _perform_presigned_request(
        ceph_test_settings,
        "GET",
        download_presign["url"],
        headers=download_presign.get("headers") or {},
    )
    payload = download_response.content
    download_response.close()

    if multipart:
        init = session.post(
            f"/browser/buckets/{destination_bucket}/multipart/initiate",
            params=_account_params(destination_account_id),
            json={
                "key": destination_key,
                "content_type": source_meta.get("content_type") or "application/octet-stream",
            },
        )
        upload_id = str(init["upload_id"])
        completed_parts: list[dict[str, Any]] = []
        try:
            for part_number, start in enumerate(range(0, len(payload), _PART_SIZE), start=1):
                part = payload[start:start + _PART_SIZE]
                presign_part = session.post(
                    f"/browser/buckets/{destination_bucket}/multipart/{upload_id}/presign",
                    params=_account_params(destination_account_id),
                    json={
                        "key": destination_key,
                        "part_number": part_number,
                        "expires_in": 1800,
                    },
                )
                part_response = _perform_presigned_request(
                    ceph_test_settings,
                    "PUT",
                    presign_part["url"],
                    headers=presign_part.get("headers") or {},
                    data=part,
                )
                etag = _normalize_etag(part_response.headers.get("ETag") or part_response.headers.get("etag"))
                part_response.close()
                if not etag:
                    raise AssertionError(f"Multipart upload part {part_number} did not return an ETag")
                completed_parts.append({"part_number": part_number, "etag": etag})

            session.post(
                f"/browser/buckets/{destination_bucket}/multipart/{upload_id}/complete",
                params={"account_id": destination_account_id, "key": destination_key},
                json={"parts": completed_parts},
            )
        except Exception:
            session.delete(
                f"/browser/buckets/{destination_bucket}/multipart/{upload_id}",
                params={"account_id": destination_account_id, "key": destination_key},
                expected_status=(200, 404),
            )
            raise
    else:
        upload_presign = _presign_object(
            session,
            destination_account_id,
            destination_bucket,
            destination_key,
            operation="put_object",
            content_type=source_meta.get("content_type") or "application/octet-stream",
        )
        upload_response = _perform_presigned_request(
            ceph_test_settings,
            "PUT",
            upload_presign["url"],
            headers=upload_presign.get("headers") or {},
            data=payload,
        )
        upload_response.close()

    destination_meta = _head_object(session, destination_account_id, destination_bucket, destination_key)
    assert int(destination_meta.get("size") or 0) == int(source_meta.get("size") or 0)
    assert destination_meta.get("content_type") == source_meta.get("content_type")

    if move:
        _delete_object(session, source_account_id, source_bucket, source_key)


def _proxy_copy_between_accounts(
    session: BackendSession,
    *,
    source_account_id: int,
    source_bucket: str,
    source_key: str,
    destination_account_id: int,
    destination_bucket: str,
    destination_key: str,
) -> None:
    source_meta = _head_object(session, source_account_id, source_bucket, source_key)
    payload = _download_bytes(session, source_account_id, source_bucket, source_key)
    _upload_bytes(
        session,
        destination_account_id,
        destination_bucket,
        destination_key,
        payload,
        content_type=source_meta.get("content_type") or "application/octet-stream",
        filename=destination_key.rsplit("/", 1)[-1] or "upload.bin",
    )


def test_browser_copy_and_move_same_account_across_bucket_configs(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    account_id = provisioned_account.account_id
    manager_session: BackendSession = provisioned_account.manager_session

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-src-versioned")
    destination_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-dst")
    _create_bucket(manager_session, account_id, source_bucket, versioning=True)
    _create_bucket(manager_session, account_id, destination_bucket, versioning=False)
    resource_tracker.track_bucket(account_id, source_bucket)
    resource_tracker.track_bucket(account_id, destination_bucket)

    source_key = "reports/quarterly.txt"
    source_bytes = b"browser clipboard same-account payload"
    source_content_type = "text/plain"
    source_metadata = {"owner": "functional", "suite": "clipboard"}
    source_tags = {"case": "same-account", "mode": "copy-move"}

    _upload_bytes(
        manager_session,
        account_id,
        source_bucket,
        source_key,
        source_bytes,
        content_type=source_content_type,
    )
    _set_object_metadata(
        manager_session,
        account_id,
        source_bucket,
        source_key,
        content_type=source_content_type,
        metadata=source_metadata,
    )
    _set_object_tags(
        manager_session,
        account_id,
        source_bucket,
        source_key,
        source_tags,
    )

    copied_key = "copies/quarterly-copy.txt"
    _copy_object(
        manager_session,
        account_id,
        destination_bucket,
        source_bucket=source_bucket,
        source_key=source_key,
        destination_key=copied_key,
    )
    _assert_object_matches(
        manager_session,
        account_id,
        destination_bucket,
        copied_key,
        expected_bytes=source_bytes,
        expected_content_type=source_content_type,
        expected_metadata=source_metadata,
        expected_tags=source_tags,
    )

    moved_key = "moves/quarterly-moved.txt"
    _copy_object(
        manager_session,
        account_id,
        destination_bucket,
        source_bucket=source_bucket,
        source_key=source_key,
        destination_key=moved_key,
        move=True,
    )
    _assert_object_matches(
        manager_session,
        account_id,
        destination_bucket,
        moved_key,
        expected_bytes=source_bytes,
        expected_content_type=source_content_type,
        expected_metadata=source_metadata,
        expected_tags=source_tags,
    )
    _wait_for_object_absence(
        manager_session,
        account_id,
        source_bucket,
        source_key,
    )

    versions = _list_versions(
        manager_session,
        account_id,
        source_bucket,
        key=source_key,
    )
    latest_delete_markers = [
        entry
        for entry in (versions.get("delete_markers") or [])
        if str(entry.get("key") or "") == source_key and bool(entry.get("is_latest"))
    ]
    assert latest_delete_markers, "Versioned move should leave the source hidden behind a latest delete marker"


def test_browser_cross_account_direct_transfer_handles_small_copy_and_large_move(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    account_factory,
    resource_tracker: ResourceTracker,
) -> None:
    source_account = account_factory()
    destination_account = account_factory()
    _grant_account_root_access(
        super_admin_session,
        source_account.manager_user_id,
        destination_account.account_id,
    )
    shared_manager_session = source_account.manager_session

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-direct-src")
    destination_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-direct-dst-versioned")
    _create_bucket(source_account.manager_session, source_account.account_id, source_bucket, versioning=False)
    _create_bucket(destination_account.manager_session, destination_account.account_id, destination_bucket, versioning=True)
    resource_tracker.track_bucket(source_account.account_id, source_bucket)
    resource_tracker.track_bucket(destination_account.account_id, destination_bucket)

    small_key = "incoming/direct-small.txt"
    small_bytes = (b"direct-copy-small-payload-" * 512)[:11_264]
    small_content_type = "text/plain"
    _upload_bytes(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
        small_key,
        small_bytes,
        content_type=small_content_type,
    )

    large_key = "incoming/direct-large.bin"
    large_bytes = (b"0123456789abcdef" * (26 * 1024 * 1024 // 16 + 1))[:26 * 1024 * 1024]
    large_content_type = "application/octet-stream"
    _upload_bytes(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
        large_key,
        large_bytes,
        content_type=large_content_type,
    )

    copied_key = "target/direct-small-copy.txt"
    _direct_copy_between_accounts(
        shared_manager_session,
        ceph_test_settings,
        source_account_id=source_account.account_id,
        source_bucket=source_bucket,
        source_key=small_key,
        destination_account_id=destination_account.account_id,
        destination_bucket=destination_bucket,
        destination_key=copied_key,
    )
    _assert_object_matches(
        destination_account.manager_session,
        destination_account.account_id,
        destination_bucket,
        copied_key,
        expected_bytes=small_bytes,
        expected_content_type=small_content_type,
    )
    assert small_key in _list_object_keys(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
    )

    moved_key = "target/direct-large-moved.bin"
    _direct_copy_between_accounts(
        shared_manager_session,
        ceph_test_settings,
        source_account_id=source_account.account_id,
        source_bucket=source_bucket,
        source_key=large_key,
        destination_account_id=destination_account.account_id,
        destination_bucket=destination_bucket,
        destination_key=moved_key,
        multipart=True,
        move=True,
    )
    _assert_object_matches(
        destination_account.manager_session,
        destination_account.account_id,
        destination_bucket,
        moved_key,
        expected_bytes=large_bytes,
        expected_content_type=large_content_type,
    )
    _wait_for_object_absence(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
        large_key,
    )


def test_browser_cross_account_proxy_folder_copy_recreates_prefix_and_contents(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    account_factory,
    resource_tracker: ResourceTracker,
) -> None:
    source_account = account_factory()
    destination_account = account_factory()
    _grant_account_root_access(
        super_admin_session,
        source_account.manager_user_id,
        destination_account.account_id,
    )
    shared_manager_session = source_account.manager_session

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-proxy-src")
    destination_bucket = _bucket_name(ceph_test_settings.test_prefix, "clip-proxy-dst")
    _create_bucket(source_account.manager_session, source_account.account_id, source_bucket, versioning=False)
    _create_bucket(destination_account.manager_session, destination_account.account_id, destination_bucket, versioning=True)
    resource_tracker.track_bucket(source_account.account_id, source_bucket)
    resource_tracker.track_bucket(destination_account.account_id, destination_bucket)

    source_prefix = "docs/"
    destination_root = "archive/"
    destination_prefix = f"{destination_root}docs/"
    _create_folder(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
        source_prefix,
    )

    source_objects = {
        "docs/readme.txt": (b"Read me first", "text/plain"),
        "docs/nested/config.json": (b'{\"enabled\":true}', "application/json"),
        "docs/nested/empty.bin": (b"", "application/octet-stream"),
    }
    for key, (payload, content_type) in source_objects.items():
        _upload_bytes(
            source_account.manager_session,
            source_account.account_id,
            source_bucket,
            key,
            payload,
            content_type=content_type,
        )

    _create_folder(
        shared_manager_session,
        destination_account.account_id,
        destination_bucket,
        destination_prefix,
    )
    objects = _list_all_objects(
        shared_manager_session,
        source_account.account_id,
        source_bucket,
        prefix=source_prefix,
    )
    for obj in objects:
        source_key = str(obj.get("key") or "")
        if not source_key or source_key == source_prefix:
            continue
        relative_key = source_key[len(source_prefix):] if source_key.startswith(source_prefix) else source_key
        _proxy_copy_between_accounts(
            shared_manager_session,
            source_account_id=source_account.account_id,
            source_bucket=source_bucket,
            source_key=source_key,
            destination_account_id=destination_account.account_id,
            destination_bucket=destination_bucket,
            destination_key=f"{destination_prefix}{relative_key}",
        )

    expected_destination_files = {
        "archive/docs/readme.txt",
        "archive/docs/nested/config.json",
        "archive/docs/nested/empty.bin",
    }
    assert expected_destination_files.issubset(
        _list_object_keys(
            destination_account.manager_session,
            destination_account.account_id,
            destination_bucket,
            prefix=destination_root,
        )
    )
    destination_prefixes = _list_all_prefixes(
        destination_account.manager_session,
        destination_account.account_id,
        destination_bucket,
        prefix=destination_root,
    )
    assert destination_prefix in destination_prefixes
    assert "archive/docs/nested/" in destination_prefixes
    for key, (payload, content_type) in source_objects.items():
        relative_key = key[len(source_prefix):]
        _assert_object_matches(
            destination_account.manager_session,
            destination_account.account_id,
            destination_bucket,
            f"{destination_prefix}{relative_key}",
            expected_bytes=payload,
            expected_content_type=content_type,
        )

    assert source_prefix in _list_all_prefixes(
        source_account.manager_session,
        source_account.account_id,
        source_bucket,
        prefix="",
    )
    for key in source_objects:
        assert key in _list_object_keys(
            source_account.manager_session,
            source_account.account_id,
            source_bucket,
            prefix=source_prefix,
        )
