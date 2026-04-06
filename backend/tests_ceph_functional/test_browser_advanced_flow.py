# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from typing import Any

import pytest

from .ceph_admin_helpers import backend_error_detail, looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker
from .test_browser_clipboard_flow import (
    _account_params,
    _assert_object_matches,
    _bucket_name,
    _create_bucket,
    _delete_object,
    _get_object_tags,
    _head_object,
    _list_versions,
    _normalize_etag,
    _perform_presigned_request,
    _set_object_tags,
    _upload_bytes,
)
from .test_bucket_configuration_flow import _delete_bucket, _skip_if_cluster_unavailable

pytestmark = pytest.mark.ceph_functional


def _parse_iso_datetime(value: str) -> datetime:
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _get_object_acl(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    *,
    version_id: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"account_id": account_id, "key": key}
    if version_id:
        params["version_id"] = version_id
    return session.get(f"/browser/buckets/{bucket_name}/object-acl", params=params)


def _delete_version(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    version_id: str,
) -> None:
    session.post(
        f"/browser/buckets/{bucket_name}/delete",
        params=_account_params(account_id),
        json={"objects": [{"key": key, "version_id": version_id}]},
    )


def _latest_version_id(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> str:
    listing = _list_versions(session, account_id, bucket_name, key=key)
    for entry in listing.get("versions") or []:
        if str(entry.get("key") or "") == key and bool(entry.get("is_latest")):
            version_id = str(entry.get("version_id") or "").strip()
            if version_id:
                return version_id
    versions = listing.get("versions") or []
    if versions:
        version_id = str(versions[0].get("version_id") or "").strip()
        if version_id:
            return version_id
    raise AssertionError(f"No object version id found for {bucket_name}/{key}")


def _ensure_bucket_object_lock_if_supported(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
) -> bool:
    try:
        session.put(
            f"/manager/buckets/{bucket_name}/object-lock",
            params=_account_params(account_id),
            json={"enabled": True, "mode": "GOVERNANCE", "days": 1},
        )
        return True
    except BackendAPIError as exc:
        detail = backend_error_detail(exc).strip().lower()
        if exc.status_code == 403 and "server-side encryption is disabled" in detail:
            return False
        if looks_unsupported(
            exc,
            markers=(
                "object lock",
                "objectlock",
                "retention",
                "legal hold",
                "invalidbucketstate",
                "malformedxml",
                "not enabled",
                "not supported",
            ),
        ):
            return False
        raise


def test_browser_versions_cleanup_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-versions")
    _create_bucket(manager_session, account_id, bucket_name, versioning=True)
    resource_tracker.track_bucket(account_id, bucket_name)

    key_main = "reports/history.txt"
    key_orphan = "reports/orphaned.txt"

    try:
        for payload in (b"v1-history", b"v2-history", b"v3-history"):
            _upload_bytes(
                manager_session,
                account_id,
                bucket_name,
                key_main,
                payload,
                content_type="text/plain",
            )
            time.sleep(0.2)

        _upload_bytes(
            manager_session,
            account_id,
            bucket_name,
            key_orphan,
            b"orphan-seed",
            content_type="text/plain",
        )
        orphan_version_id = _latest_version_id(manager_session, account_id, bucket_name, key_orphan)

        _delete_object(manager_session, account_id, bucket_name, key_main)
        _delete_object(manager_session, account_id, bucket_name, key_orphan)
        _delete_version(manager_session, account_id, bucket_name, key_orphan, orphan_version_id)

        before_cleanup = manager_session.get(
            f"/browser/buckets/{bucket_name}/versions",
            params={"account_id": account_id, "prefix": "reports/", "max_keys": 1000},
        )
        assert len(before_cleanup.get("versions") or []) == 3
        assert len(before_cleanup.get("delete_markers") or []) == 2

        cleanup = manager_session.post(
            f"/browser/buckets/{bucket_name}/versions/cleanup",
            params=_account_params(account_id),
            json={"prefix": "reports/", "keep_last_n": 1, "delete_orphan_markers": True},
        )
        assert cleanup["deleted_versions"] == 2
        assert cleanup["deleted_delete_markers"] == 1
        assert cleanup["scanned_versions"] == 3
        assert cleanup["scanned_delete_markers"] == 2

        after_cleanup = manager_session.get(
            f"/browser/buckets/{bucket_name}/versions",
            params={"account_id": account_id, "prefix": "reports/", "max_keys": 1000},
        )
        remaining_versions = [entry for entry in (after_cleanup.get("versions") or []) if entry.get("key") == key_main]
        remaining_delete_markers = [
            entry for entry in (after_cleanup.get("delete_markers") or []) if entry.get("key") == key_main
        ]
        assert len(remaining_versions) == 1
        assert len(remaining_delete_markers) == 1
        assert not any((entry.get("key") or "") == key_orphan for entry in (after_cleanup.get("versions") or []))
        assert not any((entry.get("key") or "") == key_orphan for entry in (after_cleanup.get("delete_markers") or []))
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_browser_sts_and_cors_ensure_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-cors")
    _create_bucket(manager_session, account_id, bucket_name, versioning=False)
    resource_tracker.track_bucket(account_id, bucket_name)

    try:
        origin = "https://functional.browser.example.test"
        initial_cors = manager_session.get(
            f"/browser/buckets/{bucket_name}/cors",
            params={"account_id": account_id, "origin": origin},
        )
        assert initial_cors["enabled"] is False
        assert initial_cors["rules"] == []

        ensured_cors = run_or_skip(
            "browser bucket CORS ensure",
            lambda: manager_session.post(
                f"/browser/buckets/{bucket_name}/cors/ensure",
                params=_account_params(account_id),
                json={"origin": origin},
            ),
        )
        assert ensured_cors["enabled"] is True
        assert ensured_cors["rules"], "CORS ensure should return at least one rule"
        matching_rule = next(
            (
                rule
                for rule in ensured_cors["rules"]
                if origin in (rule.get("allowed_origins") or [])
            ),
            None,
        )
        assert matching_rule is not None
        assert {"GET", "PUT", "POST", "HEAD"}.issubset(set(matching_rule.get("allowed_methods") or []))
        assert "Content-Type" in (matching_rule.get("allowed_headers") or [])

        sts_status = manager_session.get("/browser/sts", params=_account_params(account_id))
        assert isinstance(sts_status.get("available"), bool)
        if sts_status["available"]:
            credentials = manager_session.get("/browser/sts/credentials", params=_account_params(account_id))
            assert credentials["access_key_id"]
            assert credentials["secret_access_key"]
            assert credentials["session_token"]
            assert credentials["endpoint"].startswith("http")
            assert credentials["region"]
            expiration = _parse_iso_datetime(str(credentials["expiration"]))
            assert expiration > datetime.now(timezone.utc)
        else:
            response = manager_session.request(
                "GET",
                "/browser/sts/credentials",
                params=_account_params(account_id),
                expected_status=(502,),
            )
            try:
                payload = response.json()
            finally:
                response.close()
            detail = str(payload.get("detail") or "")
            assert detail, "STS credential failures should expose a detail message"
            assert detail == sts_status.get("error")
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_browser_object_governance_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-governance")
    _create_bucket(manager_session, account_id, bucket_name, versioning=True)
    resource_tracker.track_bucket(account_id, bucket_name)

    object_key = "governance/policy.txt"
    payload = b"browser governance payload"

    try:
        _upload_bytes(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            payload,
            content_type="text/plain",
        )
        version_id = _latest_version_id(manager_session, account_id, bucket_name, object_key)

        manager_session.put(
            f"/browser/buckets/{bucket_name}/object-acl",
            params=_account_params(account_id),
            json={"key": object_key, "acl": "public-read", "version_id": version_id},
        )
        acl_payload = _get_object_acl(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            version_id=version_id,
        )
        assert acl_payload["key"] == object_key
        assert acl_payload["acl"] == "public-read"

        if not _ensure_bucket_object_lock_if_supported(manager_session, account_id, bucket_name):
            return

        try:
            legal_hold = manager_session.put(
                f"/browser/buckets/{bucket_name}/object-legal-hold",
                params=_account_params(account_id),
                json={"key": object_key, "status": "ON", "version_id": version_id},
            )
            assert legal_hold["status"] == "ON"
            fetched_legal_hold = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-legal-hold",
                params={"account_id": account_id, "key": object_key, "version_id": version_id},
            )
            assert fetched_legal_hold["status"] == "ON"

            retain_until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
            retention = manager_session.put(
                f"/browser/buckets/{bucket_name}/object-retention",
                params=_account_params(account_id),
                json={
                    "key": object_key,
                    "mode": "GOVERNANCE",
                    "retain_until": retain_until,
                    "version_id": version_id,
                    "bypass_governance": True,
                },
            )
            assert retention["mode"] == "GOVERNANCE"
            fetched_retention = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-retention",
                params={"account_id": account_id, "key": object_key, "version_id": version_id},
            )
            assert fetched_retention["mode"] == "GOVERNANCE"
            assert _parse_iso_datetime(str(fetched_retention["retain_until"])) >= _parse_iso_datetime(retain_until)
        except BackendAPIError as exc:
            if looks_unsupported(
                exc,
                markers=(
                    "object lock",
                    "retention",
                    "legal hold",
                    "invalidbucketstate",
                    "malformedxml",
                    "not enabled",
                    "not supported",
                ),
            ):
                return
            raise
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_browser_multipart_listing_and_parts_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-multipart")
    _create_bucket(manager_session, account_id, bucket_name, versioning=False)
    resource_tracker.track_bucket(account_id, bucket_name)

    object_key = "multipart/assembled.bin"
    second_key = "multipart/aborted.bin"
    part_one = (b"A" * (6 * 1024 * 1024)) + b"1"
    part_two = b"B" * (2 * 1024 * 1024)

    try:
        init = manager_session.post(
            f"/browser/buckets/{bucket_name}/multipart/initiate",
            params=_account_params(account_id),
            json={"key": object_key, "content_type": "application/octet-stream"},
        )
        upload_id = str(init["upload_id"])
        completed_parts: list[dict[str, Any]] = []
        for part_number, part in enumerate((part_one, part_two), start=1):
            presigned_part = manager_session.post(
                f"/browser/buckets/{bucket_name}/multipart/{upload_id}/presign",
                params=_account_params(account_id),
                json={"key": object_key, "part_number": part_number, "expires_in": 1800},
            )
            part_response = _perform_presigned_request(
                ceph_test_settings,
                "PUT",
                presigned_part["url"],
                headers=presigned_part.get("headers") or {},
                data=part,
            )
            etag = _normalize_etag(part_response.headers.get("ETag") or part_response.headers.get("etag"))
            part_response.close()
            assert etag, f"Multipart part {part_number} should expose an ETag"
            completed_parts.append({"part_number": part_number, "etag": etag})

        uploads = manager_session.get(
            f"/browser/buckets/{bucket_name}/multipart",
            params={"account_id": account_id, "prefix": "multipart/"},
        )
        upload_ids = {str(entry.get("upload_id") or "") for entry in (uploads.get("uploads") or [])}
        assert upload_id in upload_ids

        listed_parts = manager_session.get(
            f"/browser/buckets/{bucket_name}/multipart/{upload_id}/parts",
            params={"account_id": account_id, "key": object_key},
        )
        assert [part["part_number"] for part in listed_parts["parts"]] == [1, 2]
        assert [part["size"] for part in listed_parts["parts"]] == [len(part_one), len(part_two)]

        manager_session.post(
            f"/browser/buckets/{bucket_name}/multipart/{upload_id}/complete",
            params={"account_id": account_id, "key": object_key},
            json={"parts": completed_parts},
        )
        assembled_payload = part_one + part_two
        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=assembled_payload,
            expected_content_type="application/octet-stream",
        )

        uploads_after_complete = manager_session.get(
            f"/browser/buckets/{bucket_name}/multipart",
            params={"account_id": account_id, "prefix": "multipart/"},
        )
        assert upload_id not in {
            str(entry.get("upload_id") or "")
            for entry in (uploads_after_complete.get("uploads") or [])
        }

        second_upload = manager_session.post(
            f"/browser/buckets/{bucket_name}/multipart/initiate",
            params=_account_params(account_id),
            json={"key": second_key, "content_type": "application/octet-stream"},
        )
        second_upload_id = str(second_upload["upload_id"])
        manager_session.delete(
            f"/browser/buckets/{bucket_name}/multipart/{second_upload_id}",
            params={"account_id": account_id, "key": second_key},
            expected_status=(200,),
        )
        uploads_after_abort = manager_session.get(
            f"/browser/buckets/{bucket_name}/multipart",
            params={"account_id": account_id, "prefix": "multipart/"},
        )
        assert second_upload_id not in {
            str(entry.get("upload_id") or "")
            for entry in (uploads_after_abort.get("uploads") or [])
        }
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_browser_copy_replace_metadata_tags_acl_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "browser-copy-src")
    destination_bucket = _bucket_name(ceph_test_settings.test_prefix, "browser-copy-dst")
    _create_bucket(manager_session, account_id, source_bucket, versioning=False)
    _create_bucket(manager_session, account_id, destination_bucket, versioning=False)
    resource_tracker.track_bucket(account_id, source_bucket)
    resource_tracker.track_bucket(account_id, destination_bucket)

    source_key = "incoming/report.txt"
    destination_key = "copied/report.txt"
    source_payload = b"copy replace metadata tags acl"
    source_tags = {"source": "true", "stage": "raw"}
    destination_tags = {"copied": "yes", "stage": "processed"}
    destination_metadata = {"owner": "functional", "suite": "browser-advanced"}

    try:
        _upload_bytes(
            manager_session,
            account_id,
            source_bucket,
            source_key,
            source_payload,
            content_type="text/plain",
        )
        _set_object_tags(manager_session, account_id, source_bucket, source_key, source_tags)

        manager_session.post(
            f"/browser/buckets/{destination_bucket}/copy",
            params=_account_params(account_id),
            json={
                "source_bucket": source_bucket,
                "source_key": source_key,
                "destination_key": destination_key,
                "metadata": destination_metadata,
                "replace_metadata": True,
                "tags": [{"key": key, "value": value} for key, value in sorted(destination_tags.items())],
                "replace_tags": True,
                "acl": "public-read",
            },
        )

        _assert_object_matches(
            manager_session,
            account_id,
            destination_bucket,
            destination_key,
            expected_bytes=source_payload,
            expected_content_type="text/plain",
            expected_metadata=destination_metadata,
            expected_tags=destination_tags,
        )
        destination_acl = _get_object_acl(manager_session, account_id, destination_bucket, destination_key)
        assert destination_acl["acl"] == "public-read"

        assert _get_object_tags(manager_session, account_id, source_bucket, source_key) == source_tags
        source_meta = _head_object(manager_session, account_id, source_bucket, source_key)
        assert source_meta.get("metadata") == {}
    except BackendAPIError as exc:
        _skip_if_cluster_unavailable(
            "browser copy replace metadata/tags/acl",
            exc,
            extra_markers=("accessdenied",),
        )
        raise
    finally:
        for bucket_name in (destination_bucket, source_bucket):
            _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)
