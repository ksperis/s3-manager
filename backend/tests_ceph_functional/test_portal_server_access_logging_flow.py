# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import io
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
import pytest
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker
from .test_bucket_configuration_flow import (
    _account_params,
    _skip_if_cluster_unavailable,
    _wait_for_value,
)

pytestmark = pytest.mark.ceph_functional


def _storage_space_name(prefix: str) -> str:
    return f"{prefix}-portal-logs-{uuid.uuid4().hex[:8]}"


def _portal_log_bucket_name(account_id: int, rgw_account_id: str | None, account_name: str) -> str:
    digest = hashlib.sha256(f"{rgw_account_id or ''}{account_name}".encode("utf-8")).hexdigest()[:8]
    return f"s3m-portal-access-logs-{account_id}-{digest}"


def _statement_by_sid(policy: dict[str, Any], sid: str) -> dict[str, Any] | None:
    statements = policy.get("Statement") or []
    if isinstance(statements, dict):
        statements = [statements]
    for statement in statements:
        if isinstance(statement, dict) and statement.get("Sid") == sid:
            return statement
    return None


def _upload_via_portal_browser(
    session: BackendSession,
    account_id: int,
    bucket_name: str,
    key: str,
    payload: bytes,
) -> None:
    response = session.request(
        "POST",
        f"/browser/buckets/{bucket_name}/proxy-upload",
        params=_account_params(account_id),
        headers={"X-S3-Workspace": "portal"},
        data={"key": key, "content_type": "text/plain"},
        files={"file": (key.rsplit("/", 1)[-1], io.BytesIO(payload), "text/plain")},
        expected_status=200,
    )
    response.close()


def _put_external_s3_object(
    ceph_test_settings: CephTestSettings,
    *,
    endpoint_url: str,
    access_key_id: str,
    secret_access_key: str,
    bucket_name: str,
    key: str,
    payload: bytes,
) -> None:
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=ceph_test_settings.rgw_admin_region or "us-east-1",
        verify=ceph_test_settings.rgw_ca_bundle or ceph_test_settings.rgw_verify_tls,
        config=Config(s3={"addressing_style": "path"}),
    )
    deadline = time.monotonic() + 15
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            client.put_object(Bucket=bucket_name, Key=key, Body=payload, ContentType="text/plain")
            return
        except (BotoCoreError, ClientError) as exc:
            last_error = exc
            time.sleep(1)
    raise AssertionError(f"External S3 upload did not succeed: {last_error}") from last_error


def _assert_s3_bucket_access_denied(
    ceph_test_settings: CephTestSettings,
    *,
    endpoint_url: str,
    access_key_id: str,
    secret_access_key: str,
    bucket_name: str,
) -> None:
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=ceph_test_settings.rgw_admin_region or "us-east-1",
        verify=ceph_test_settings.rgw_ca_bundle or ceph_test_settings.rgw_verify_tls,
        config=Config(s3={"addressing_style": "path"}),
    )
    with pytest.raises(ClientError) as exc_info:
        client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
    error = exc_info.value.response.get("Error") or {}
    assert str(error.get("Code") or "").lower() in {"accessdenied", "403"}


def _delete_test_bucket(
    manager_session: BackendSession,
    resource_tracker: ResourceTracker,
    account_id: int,
    bucket_name: str,
) -> None:
    try:
        manager_session.delete(
            f"/manager/buckets/{bucket_name}",
            params={"account_id": account_id, "force": "true"},
            expected_status=(200, 204, 404),
        )
    except BackendAPIError:
        return
    resource_tracker.discard_bucket(account_id, bucket_name)


def _cleanup_account_before_user(
    super_admin_session: BackendSession,
    resource_tracker: ResourceTracker,
    ceph_test_settings: CephTestSettings,
    *,
    account_id: int,
    user_id: int,
) -> bool:
    try:
        super_admin_session.delete(
            f"/admin/accounts/{account_id}",
            params={"delete_rgw": "true" if ceph_test_settings.cleanup_delete_rgw else "false"},
            expected_status=(204, 404),
        )
        resource_tracker.discard_account(account_id)
    except BackendAPIError as exc:
        if ceph_test_settings.cleanup_delete_rgw and "cannot delete the rgw tenant" in str(exc.payload).lower():
            super_admin_session.delete(
                f"/admin/accounts/{account_id}",
                params={"delete_rgw": "false"},
                expected_status=(204, 404),
            )
            resource_tracker.discard_account(account_id)
        else:
            return False

    try:
        super_admin_session.delete(f"/admin/users/{user_id}", expected_status=(204, 404))
        resource_tracker.discard_user(user_id)
    except BackendAPIError:
        pass
    return True


def test_portal_storage_space_configures_server_access_logging_on_lab(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    super_admin_session: BackendSession,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id
    log_bucket = _portal_log_bucket_name(
        account_id,
        provisioned_account.rgw_account_id,
        provisioned_account.account_name,
    )
    bucket_name: str | None = None
    external_access_key_id: str | None = None
    personal_access_key_id: str | None = None

    super_admin_session.post(
        f"/admin/users/{provisioned_account.manager_user_id}/assign-account",
        json={"account_id": account_id, "account_root": True, "account_role": "portal_manager"},
        expected_status=200,
    )
    super_admin_session.put(
        f"/admin/accounts/{account_id}/portal-settings",
        json={"server_access_logging_enabled": True},
        expected_status=200,
    )

    try:
        accounts = manager_session.get("/portal/accounts")
        assert any(str(account.get("id")) == str(account_id) for account in accounts)

        storage_space = manager_session.post(
            "/portal/storage-spaces",
            params=_account_params(account_id),
            json={
                "name": _storage_space_name(ceph_test_settings.test_prefix),
                "naming_mode": "generic_uuid",
                "visibility": "private",
            },
            expected_status=201,
        )
        bucket_name = str(storage_space.get("internal_bucket_name") or storage_space["id"])
        resource_tracker.track_bucket(account_id, bucket_name)
        resource_tracker.track_bucket(account_id, log_bucket)

        logging_config = _wait_for_value(
            "Portal Storage Space server access logging",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/logging",
                params=_account_params(account_id),
            ),
            lambda current: (
                current.get("enabled") is True
                and current.get("target_bucket") == log_bucket
                and current.get("target_prefix") == f"portal-server-access/{bucket_name}/"
            ),
        )
        assert logging_config["target_bucket"] == log_bucket

        policy_payload = _wait_for_value(
            "Portal access log bucket policy",
            lambda: manager_session.get(
                f"/manager/buckets/{log_bucket}/policy",
                params=_account_params(account_id),
            ),
            lambda current: bool(
                _statement_by_sid(current.get("policy") or {}, "S3ManagerPortalServerAccessLogging")
            ),
        )
        managed_statement = _statement_by_sid(policy_payload["policy"], "S3ManagerPortalServerAccessLogging")
        assert managed_statement is not None
        assert managed_statement["Principal"] == {"Service": "logging.s3.amazonaws.com"}
        assert managed_statement["Action"] == "s3:PutObject"
        assert managed_statement["Resource"] == f"arn:aws:s3:::{log_bucket}/portal-server-access/*"
        assert managed_statement["Condition"]["StringEquals"] == {
            "aws:SourceAccount": provisioned_account.rgw_account_id
        }
        manager_deny = _statement_by_sid(policy_payload["policy"], "S3ManagerPortalManagerDeny")
        assert manager_deny is not None
        assert manager_deny["Effect"] == "Deny"
        assert manager_deny["Action"] == "s3:*"
        assert manager_deny["Resource"] == [
            f"arn:aws:s3:::{log_bucket}",
            f"arn:aws:s3:::{log_bucket}/*",
        ]

        personal_key = manager_session.post(
            "/portal/access-keys",
            params=_account_params(account_id),
            json={"target_type": "self"},
            expected_status=201,
        )
        personal_access_key_id = str(personal_key["access_key_id"])
        personal_secret_access_key = str(personal_key.get("secret_access_key") or "")
        assert personal_secret_access_key
        access_key_state = manager_session.get("/portal/access-keys", params=_account_params(account_id))
        endpoint_url = str(access_key_state.get("s3_endpoint") or ceph_test_settings.rgw_admin_endpoint or "")
        assert endpoint_url
        _assert_s3_bucket_access_denied(
            ceph_test_settings,
            endpoint_url=endpoint_url,
            access_key_id=personal_access_key_id,
            secret_access_key=personal_secret_access_key,
            bucket_name=log_bucket,
        )
        manager_session.delete(
            f"/portal/access-keys/{personal_access_key_id}",
            params=_account_params(account_id),
            expected_status=204,
        )
        personal_access_key_id = None

        _upload_via_portal_browser(
            manager_session,
            account_id,
            bucket_name,
            "browser/upload.txt",
            b"portal browser upload",
        )

        external_key = manager_session.post(
            "/portal/access-keys",
            params=_account_params(account_id),
            json={
                "target_type": "external",
                "storage_space_id": storage_space["id"],
                "external_email": "ceph-functional-external@example.com",
                "permission": "read_write",
            },
            expected_status=201,
        )
        external_access_key_id = str(external_key["access_key_id"])
        secret_access_key = str(external_key.get("secret_access_key") or "")
        assert secret_access_key
        access_key_state = manager_session.get("/portal/access-keys", params=_account_params(account_id))
        endpoint_url = str(access_key_state.get("s3_endpoint") or ceph_test_settings.rgw_admin_endpoint or "")
        assert endpoint_url
        _put_external_s3_object(
            ceph_test_settings,
            endpoint_url=endpoint_url,
            access_key_id=external_access_key_id,
            secret_access_key=secret_access_key,
            bucket_name=bucket_name,
            key="external/direct-upload.txt",
            payload=b"external client upload",
        )

        today = datetime.now(timezone.utc).date().isoformat()
        server_logs = manager_session.get(
            "/portal/transfers/server-access-logs",
            params={
                "account_id": account_id,
                "date": today,
                "mode": "operations",
                "limit": 50,
                "timezone_offset_minutes": 0,
            },
        )
        assert isinstance(server_logs, list)

        super_admin_session.put(
            f"/admin/accounts/{account_id}/portal-settings",
            json={"server_access_logging_enabled": False},
            expected_status=200,
        )
        _wait_for_value(
            "Portal Storage Space server access logging disable",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/logging",
                params=_account_params(account_id),
            ),
            lambda current: current.get("enabled") is False and not current.get("target_bucket"),
        )
    except BackendAPIError as exc:
        _skip_if_cluster_unavailable(
            "Portal Server Access Logging",
            exc,
            extra_markers=("accessdenied", "logging", "notimplemented"),
        )
        raise
    finally:
        if personal_access_key_id:
            try:
                manager_session.delete(
                    f"/portal/access-keys/{personal_access_key_id}",
                    params=_account_params(account_id),
                    expected_status=(204, 404),
                )
            except BackendAPIError:
                pass
        if external_access_key_id:
            try:
                manager_session.delete(
                    f"/portal/access-keys/{external_access_key_id}",
                    params=_account_params(account_id),
                    expected_status=(204, 404),
                )
            except BackendAPIError:
                pass
        if bucket_name:
            _delete_test_bucket(manager_session, resource_tracker, account_id, bucket_name)
        _delete_test_bucket(manager_session, resource_tracker, account_id, log_bucket)
        account_cleaned = _cleanup_account_before_user(
            super_admin_session,
            resource_tracker,
            ceph_test_settings,
            account_id=account_id,
            user_id=provisioned_account.manager_user_id,
        )
        if account_cleaned:
            if bucket_name:
                resource_tracker.discard_bucket(account_id, bucket_name)
            resource_tracker.discard_bucket(account_id, log_bucket)
