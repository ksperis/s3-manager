# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from typing import Any
import uuid

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

_BROWSER_STORAGE_CLASSES = {
    "STANDARD",
    "STANDARD_IA",
    "ONEZONE_IA",
    "INTELLIGENT_TIERING",
    "GLACIER",
    "GLACIER_IR",
    "DEEP_ARCHIVE",
}
_ARCHIVE_STORAGE_CLASSES = {"GLACIER", "GLACIER_IR", "DEEP_ARCHIVE"}


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


def _delete_all_object_versions(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
) -> None:
    listing = _list_versions(session, account_id, bucket_name, key=key)
    entries = [*(listing.get("versions") or []), *(listing.get("delete_markers") or [])]
    for entry in entries:
        version_id = str(entry.get("version_id") or "").strip()
        if version_id:
            try:
                _delete_version(session, account_id, bucket_name, key, version_id)
            except BackendAPIError:
                continue


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


def _assert_close_datetime(actual: object, expected: datetime, *, tolerance_seconds: int = 2) -> None:
    if not actual:
        raise AssertionError("Expected a datetime value, got an empty response")
    actual_dt = _parse_iso_datetime(str(actual))
    delta_seconds = abs((actual_dt - expected).total_seconds())
    assert delta_seconds <= tolerance_seconds, (
        f"Expected datetime close to {expected.isoformat()}, got {actual_dt.isoformat()}"
    )


def _pick_storage_class_target(
    endpoint_info: dict[str, Any] | None,
    *,
    current_storage_class: str | None,
) -> str:
    available: set[str] = set()
    if endpoint_info:
        for value in endpoint_info.get("storage_classes") or []:
            cleaned = str(value or "").strip().upper()
            if cleaned:
                available.add(cleaned)
        for placement in endpoint_info.get("placement_targets") or []:
            for value in (placement or {}).get("storage_classes") or []:
                cleaned = str(value or "").strip().upper()
                if cleaned:
                    available.add(cleaned)

    supported = sorted(value for value in available if value in _BROWSER_STORAGE_CLASSES)
    current = str(current_storage_class or "").strip().upper() or None

    safe_candidates = [value for value in supported if value not in _ARCHIVE_STORAGE_CLASSES]
    for candidate in safe_candidates:
        if candidate != current:
            return candidate
    if safe_candidates:
        return safe_candidates[0]

    for candidate in supported:
        if candidate != current:
            return candidate
    if supported:
        return supported[0]
    return "STANDARD"


def _get_ceph_endpoint_info(
    session: BackendSession,
    endpoint_id: int,
) -> dict[str, Any] | None:
    try:
        info = run_or_skip(
            "ceph-admin endpoint info for browser object settings",
            lambda: session.get(f"/ceph-admin/endpoints/{endpoint_id}/info"),
        )
    except pytest.skip.Exception:
        return None
    if isinstance(info, dict):
        return info
    return None


def _select_ceph_browser_endpoint(session: BackendSession) -> dict[str, Any]:
    endpoints = session.get("/ceph-admin/endpoints")
    if not isinstance(endpoints, list) or not endpoints:
        pytest.skip("Browser object settings tests require at least one configured Ceph endpoint.")
    default_endpoint = next((item for item in endpoints if bool((item or {}).get("is_default"))), None)
    selected = default_endpoint or endpoints[0]
    endpoint_id = selected.get("id")
    if endpoint_id is None:
        pytest.skip("Browser object settings tests require a Ceph endpoint with an id.")
    return selected


def _create_browser_connection_context(
    super_admin_session: BackendSession,
    backend_authenticator,
    ceph_test_settings: CephTestSettings,
) -> dict[str, Any]:
    if not ceph_test_settings.rgw_admin_access_key or not ceph_test_settings.rgw_admin_secret_key:
        pytest.skip("Browser object settings tests require S3 credentials in backend/.env.")

    endpoint = _select_ceph_browser_endpoint(super_admin_session)
    suffix = uuid.uuid4().hex[:8]
    manager_email = f"{ceph_test_settings.test_prefix}.browser.{suffix}@example.com"
    manager_password = f"Test-{uuid.uuid4().hex[:12]}"

    created_user = super_admin_session.post(
        "/admin/users",
        json={
            "email": manager_email,
            "password": manager_password,
            "full_name": "Ceph Functional Browser User",
            "role": "ui_user",
        },
        expected_status=201,
    )
    user_id = int(created_user["id"])

    created_connection = super_admin_session.post(
        "/admin/s3-connections",
        json={
            "name": f"{ceph_test_settings.test_prefix}-browser-conn-{suffix}",
            "storage_endpoint_id": int(endpoint["id"]),
            "access_manager": True,
            "access_browser": True,
            "access_key_id": ceph_test_settings.rgw_admin_access_key,
            "secret_access_key": ceph_test_settings.rgw_admin_secret_key,
            "provider_hint": "CEPH",
            "region": endpoint.get("region") or ceph_test_settings.rgw_admin_region or "us-east-1",
            "verify_tls": ceph_test_settings.rgw_verify_tls,
        },
        expected_status=201,
    )
    connection_id = int(created_connection["id"])
    super_admin_session.post(
        f"/admin/s3-connections/{connection_id}/users",
        json={"user_id": user_id},
        expected_status=201,
    )

    manager_session = backend_authenticator.login(manager_email, manager_password)
    return {
        "manager_session": manager_session,
        "account_ref": f"conn-{connection_id}",
        "connection_id": connection_id,
        "user_id": user_id,
        "endpoint_id": int(endpoint["id"]),
    }


def _delete_with_retry(
    session: BackendSession,
    path: str,
    *,
    expected_status: int | tuple[int, ...],
    attempts: int = 5,
) -> None:
    for attempt in range(1, attempts + 1):
        try:
            session.delete(path, expected_status=expected_status)
            return
        except BackendAPIError as exc:
            payload_text = str(exc.payload).lower() if exc.payload is not None else ""
            if attempt < attempts and exc.status_code == 500 and "database is locked" in payload_text:
                time.sleep(0.4 * attempt)
                continue
            raise


def _cleanup_browser_connection_context(
    super_admin_session: BackendSession,
    context: dict[str, Any],
) -> None:
    manager_session: BackendSession = context["manager_session"]
    manager_session.session.close()
    _delete_with_retry(
        super_admin_session,
        f"/admin/s3-connections/{int(context['connection_id'])}",
        expected_status=(204, 404),
    )
    _delete_with_retry(
        super_admin_session,
        f"/admin/users/{int(context['user_id'])}",
        expected_status=(204, 404),
    )


def test_browser_object_properties_roundtrip_flow(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator,
) -> None:
    context = _create_browser_connection_context(
        super_admin_session,
        backend_authenticator,
        ceph_test_settings,
    )
    manager_session: BackendSession = context["manager_session"]
    account_id = context["account_ref"]

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-object-properties")
    _create_bucket(manager_session, account_id, bucket_name, versioning=False)

    object_key = "properties/object-settings.txt"
    object_payload = b"browser properties roundtrip payload"
    initial_tags = {"stage": "raw", "suite": "browser"}
    expected_metadata = {"owner": "qa", "purpose": "properties"}
    expected_tags = {"env": "ceph", "flow": "properties"}
    expected_expires = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
    endpoint_info = _get_ceph_endpoint_info(super_admin_session, int(context["endpoint_id"]))

    try:
        _upload_bytes(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            object_payload,
            content_type="text/plain",
        )
        _set_object_tags(manager_session, account_id, bucket_name, object_key, initial_tags)
        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=object_payload,
            expected_content_type="text/plain",
            expected_tags=initial_tags,
        )

        metadata_payload = manager_session.put(
            f"/browser/buckets/{bucket_name}/object-meta",
            params=_account_params(account_id),
            json={
                "key": object_key,
                "content_type": "text/markdown; charset=utf-8",
                "cache_control": "max-age=600",
                "content_disposition": 'inline; filename="object-settings.txt"',
                "content_encoding": "identity",
                "content_language": "fr-FR",
                "expires": expected_expires.isoformat(),
                "metadata": expected_metadata,
            },
        )
        assert metadata_payload["content_type"] == "text/markdown; charset=utf-8"
        assert metadata_payload["cache_control"] == "max-age=600"
        assert metadata_payload["content_disposition"] == 'inline; filename="object-settings.txt"'
        assert metadata_payload["content_encoding"] == "identity"
        assert metadata_payload["content_language"] == "fr-FR"
        _assert_close_datetime(metadata_payload["expires"], expected_expires)
        assert dict(sorted((metadata_payload.get("metadata") or {}).items())) == expected_metadata

        metadata_head = _head_object(manager_session, account_id, bucket_name, object_key)
        assert metadata_head["content_type"] == "text/markdown; charset=utf-8"
        assert metadata_head["cache_control"] == "max-age=600"
        assert metadata_head["content_disposition"] == 'inline; filename="object-settings.txt"'
        assert metadata_head["content_encoding"] == "identity"
        assert metadata_head["content_language"] == "fr-FR"
        _assert_close_datetime(metadata_head["expires"], expected_expires)
        assert dict(sorted((metadata_head.get("metadata") or {}).items())) == expected_metadata
        assert _get_object_tags(manager_session, account_id, bucket_name, object_key) == initial_tags
        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=object_payload,
            expected_content_type="text/markdown; charset=utf-8",
            expected_metadata=expected_metadata,
            expected_tags=initial_tags,
        )

        tags_payload = manager_session.put(
            f"/browser/buckets/{bucket_name}/object-tags",
            params=_account_params(account_id),
            json={
                "key": object_key,
                "tags": [{"key": key, "value": value} for key, value in sorted(expected_tags.items())],
            },
        )
        assert tags_payload["key"] == object_key
        assert _get_object_tags(manager_session, account_id, bucket_name, object_key) == expected_tags
        metadata_after_tags = _head_object(manager_session, account_id, bucket_name, object_key)
        assert dict(sorted((metadata_after_tags.get("metadata") or {}).items())) == expected_metadata
        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=object_payload,
            expected_content_type="text/markdown; charset=utf-8",
            expected_metadata=expected_metadata,
            expected_tags=expected_tags,
        )

        target_storage_class = _pick_storage_class_target(
            endpoint_info,
            current_storage_class=metadata_after_tags.get("storage_class"),
        )
        storage_payload = manager_session.put(
            f"/browser/buckets/{bucket_name}/object-meta",
            params=_account_params(account_id),
            json={
                "key": object_key,
                "storage_class": target_storage_class,
            },
        )
        storage_class = str(storage_payload.get("storage_class") or "").strip().upper()
        assert storage_class, "Storage class update should return a storage class"
        assert storage_class == target_storage_class
        assert dict(sorted((storage_payload.get("metadata") or {}).items())) == expected_metadata

        metadata_after_storage = _head_object(manager_session, account_id, bucket_name, object_key)
        assert str(metadata_after_storage.get("storage_class") or "").strip().upper() == target_storage_class
        assert metadata_after_storage["content_type"] == "text/markdown; charset=utf-8"
        assert metadata_after_storage["cache_control"] == "max-age=600"
        assert metadata_after_storage["content_disposition"] == 'inline; filename="object-settings.txt"'
        assert metadata_after_storage["content_encoding"] == "identity"
        assert metadata_after_storage["content_language"] == "fr-FR"
        _assert_close_datetime(metadata_after_storage["expires"], expected_expires)
        assert dict(sorted((metadata_after_storage.get("metadata") or {}).items())) == expected_metadata
        assert _get_object_tags(manager_session, account_id, bucket_name, object_key) == expected_tags
        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=object_payload,
            expected_content_type="text/markdown; charset=utf-8",
            expected_metadata=expected_metadata,
            expected_tags=expected_tags,
        )
    finally:
        try:
            _delete_object(manager_session, account_id, bucket_name, object_key)
        except BackendAPIError:
            pass
        try:
            manager_session.delete(
                f"/manager/buckets/{bucket_name}",
                params={"account_id": account_id, "force": "true"},
                expected_status=(200, 404),
            )
        except BackendAPIError:
            pass
        _cleanup_browser_connection_context(super_admin_session, context)


def test_browser_object_access_and_protection_roundtrip_flow(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator,
) -> None:
    context = _create_browser_connection_context(
        super_admin_session,
        backend_authenticator,
        ceph_test_settings,
    )
    manager_session: BackendSession = context["manager_session"]
    account_id = context["account_ref"]

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "browser-object-protection")
    _create_bucket(manager_session, account_id, bucket_name, versioning=True)

    object_key = "protection/object-lock.txt"
    object_payload = b"browser access and protection payload"
    version_id: str | None = None

    try:
        _upload_bytes(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            object_payload,
            content_type="text/plain",
        )
        version_id = _latest_version_id(manager_session, account_id, bucket_name, object_key)

        acl_payload = manager_session.put(
            f"/browser/buckets/{bucket_name}/object-acl",
            params=_account_params(account_id),
            json={"key": object_key, "acl": "public-read", "version_id": version_id},
        )
        assert acl_payload["acl"] == "public-read"
        fetched_acl = _get_object_acl(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            version_id=version_id,
        )
        assert fetched_acl["key"] == object_key
        assert fetched_acl["acl"] == "public-read"

        presigned = manager_session.post(
            f"/browser/buckets/{bucket_name}/presign",
            params=_account_params(account_id),
            json={
                "key": object_key,
                "operation": "get_object",
                "expires_in": 1800,
                "version_id": version_id,
            },
        )
        assert presigned["url"].startswith("http")
        presigned_response = _perform_presigned_request(
            ceph_test_settings,
            presigned.get("method") or "GET",
            presigned["url"],
            headers=presigned.get("headers") or {},
        )
        try:
            assert presigned_response.content == object_payload
        finally:
            presigned_response.close()

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

            initial_retain_until = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
            retention = manager_session.put(
                f"/browser/buckets/{bucket_name}/object-retention",
                params=_account_params(account_id),
                json={
                    "key": object_key,
                    "mode": "GOVERNANCE",
                    "retain_until": initial_retain_until.isoformat(),
                    "version_id": version_id,
                },
            )
            assert retention["mode"] == "GOVERNANCE"
            fetched_retention = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-retention",
                params={"account_id": account_id, "key": object_key, "version_id": version_id},
            )
            assert fetched_retention["mode"] == "GOVERNANCE"
            _assert_close_datetime(fetched_retention["retain_until"], initial_retain_until)

            bypass_retain_until = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
            bypass_retention = manager_session.put(
                f"/browser/buckets/{bucket_name}/object-retention",
                params=_account_params(account_id),
                json={
                    "key": object_key,
                    "mode": "GOVERNANCE",
                    "retain_until": bypass_retain_until.isoformat(),
                    "version_id": version_id,
                    "bypass_governance": True,
                },
            )
            assert bypass_retention["mode"] == "GOVERNANCE"
            assert bypass_retention["bypass_governance"] is True
            fetched_bypass_retention = manager_session.get(
                f"/browser/buckets/{bucket_name}/object-retention",
                params={"account_id": account_id, "key": object_key, "version_id": version_id},
            )
            assert fetched_bypass_retention["mode"] == "GOVERNANCE"
            _assert_close_datetime(fetched_bypass_retention["retain_until"], bypass_retain_until)
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

        _assert_object_matches(
            manager_session,
            account_id,
            bucket_name,
            object_key,
            expected_bytes=object_payload,
            expected_content_type="text/plain",
        )
    finally:
        if version_id:
            try:
                manager_session.put(
                    f"/browser/buckets/{bucket_name}/object-legal-hold",
                    params=_account_params(account_id),
                    json={"key": object_key, "status": "OFF", "version_id": version_id},
                )
            except BackendAPIError:
                pass
            try:
                manager_session.put(
                    f"/browser/buckets/{bucket_name}/object-retention",
                    params=_account_params(account_id),
                    json={
                        "key": object_key,
                        "mode": "GOVERNANCE",
                        "retain_until": (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
                        "version_id": version_id,
                        "bypass_governance": True,
                    },
                )
                time.sleep(1.2)
            except BackendAPIError:
                pass
            try:
                _delete_version(manager_session, account_id, bucket_name, object_key, version_id)
            except BackendAPIError:
                pass
        try:
            _delete_object(manager_session, account_id, bucket_name, object_key)
        except BackendAPIError:
            pass
        try:
            _delete_all_object_versions(manager_session, account_id, bucket_name, object_key)
        except BackendAPIError:
            pass
        try:
            manager_session.delete(
                f"/manager/buckets/{bucket_name}",
                params={"account_id": account_id, "force": "true"},
                expected_status=(200, 404),
            )
        except BackendAPIError:
            pass
        _cleanup_browser_connection_context(super_admin_session, context)


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
