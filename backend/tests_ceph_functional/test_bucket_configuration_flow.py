# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable

import pytest

from .ceph_admin_helpers import backend_error_detail, looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket_name(prefix: str, label: str = "cfg") -> str:
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
    timeout: float = 12.0,
    interval: float = 0.5,
) -> Any:
    deadline = time.monotonic() + timeout
    last_value: Any = None
    last_error: BackendAPIError | None = None

    while time.monotonic() < deadline:
        try:
            last_value = fetch()
            if predicate(last_value):
                return last_value
        except BackendAPIError as exc:
            last_error = exc
        time.sleep(interval)

    try:
        last_value = fetch()
        if predicate(last_value):
            return last_value
    except BackendAPIError as exc:
        last_error = exc

    if last_error is not None:
        raise AssertionError(f"{description} did not reach the expected state: last error was {last_error}") from last_error
    raise AssertionError(f"{description} did not reach the expected state: last value was {last_value!r}")


def _wait_for_equal(
    description: str,
    fetch: Callable[[], Any],
    expected: Any,
    *,
    timeout: float = 12.0,
    interval: float = 0.5,
) -> Any:
    normalized_expected = _normalize_value(expected)
    return _wait_for_value(
        description,
        fetch,
        lambda current: _normalize_value(current) == normalized_expected,
        timeout=timeout,
        interval=interval,
    )


def _skip_if_cluster_unavailable(action: str, exc: BackendAPIError, *, extra_markers: tuple[str, ...] = ()) -> None:
    detail = backend_error_detail(exc).strip()
    normalized_detail = detail.lower()
    if looks_unsupported(exc) or any(marker.lower() in normalized_detail for marker in extra_markers):
        reason = detail or f"status={exc.status_code}"
        pytest.skip(f"{action} unavailable on this cluster: {reason}")


def _create_bucket(manager_session: BackendSession, account_id: int, bucket_name: str, *, versioning: bool = False) -> None:
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


@pytest.mark.ceph_functional
def test_manager_bucket_configuration_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "cfg-main")
    _create_bucket(manager_session, account_id, bucket_name)
    resource_tracker.track_bucket(account_id, bucket_name)

    try:
        manager_session.put(
            f"/manager/buckets/{bucket_name}/versioning",
            params=_account_params(account_id),
            json={"enabled": True},
        )
        properties = _wait_for_value(
            "bucket versioning",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/properties",
                params=_account_params(account_id),
            ),
            lambda current: current.get("versioning_status") == "Enabled",
        )
        assert properties["versioning_status"] == "Enabled"

        lifecycle_rules = [
            {
                "ID": "expire-temp",
                "Status": "Enabled",
                "Prefix": "tmp/",
                "Expiration": {"Days": 1},
            }
        ]
        manager_session.put(
            f"/manager/buckets/{bucket_name}/lifecycle",
            params=_account_params(account_id),
            json={"rules": lifecycle_rules},
        )
        _wait_for_equal(
            "bucket lifecycle rules",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/lifecycle",
                params=_account_params(account_id),
            ),
            {"rules": lifecycle_rules},
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/lifecycle",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_equal(
            "bucket lifecycle deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/lifecycle",
                params=_account_params(account_id),
            ),
            {"rules": []},
        )

        cors_rules = [
            {
                "AllowedHeaders": ["*"],
                "AllowedMethods": ["GET", "PUT"],
                "AllowedOrigins": ["https://example.com"],
                "ExposeHeaders": ["x-amz-meta-test"],
                "MaxAgeSeconds": 300,
            }
        ]
        manager_session.put(
            f"/manager/buckets/{bucket_name}/cors",
            params=_account_params(account_id),
            json={"rules": cors_rules},
        )
        _wait_for_equal(
            "bucket CORS rules",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/cors",
                params=_account_params(account_id),
            ),
            {"rules": cors_rules},
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/cors",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_equal(
            "bucket CORS deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/cors",
                params=_account_params(account_id),
            ),
            {"rules": []},
        )

        tag_payload = {
            "tags": [
                {"key": "env", "value": "functional"},
                {"key": "suite", "value": "ceph-functional"},
            ]
        }
        manager_session.put(
            f"/manager/buckets/{bucket_name}/tags",
            params=_account_params(account_id),
            json=tag_payload,
        )
        _wait_for_equal(
            "bucket tags",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/tags",
                params=_account_params(account_id),
            ),
            tag_payload,
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/tags",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_equal(
            "bucket tag deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/tags",
                params=_account_params(account_id),
            ),
            {"tags": []},
        )

        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "FunctionalAccess",
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetBucketLocation"],
                    "Resource": [f"arn:aws:s3:::{bucket_name}"],
                }
            ],
        }
        manager_session.put(
            f"/manager/buckets/{bucket_name}/policy",
            params=_account_params(account_id),
            json={"policy": policy_document},
        )
        _wait_for_equal(
            "bucket policy",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/policy",
                params=_account_params(account_id),
            ),
            {"policy": policy_document},
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/policy",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_value(
            "bucket policy deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/policy",
                params=_account_params(account_id),
            ),
            lambda current: current.get("policy") is None,
        )

        public_access_block = {
            "block_public_acls": False,
            "ignore_public_acls": False,
            "block_public_policy": True,
            "restrict_public_buckets": True,
        }
        manager_session.put(
            f"/manager/buckets/{bucket_name}/public-access-block",
            params=_account_params(account_id),
            json=public_access_block,
        )
        _wait_for_equal(
            "bucket public access block",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/public-access-block",
                params=_account_params(account_id),
            ),
            public_access_block,
        )

    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


@pytest.mark.ceph_functional
def test_manager_bucket_logging_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "cfg-main")
    logging_bucket = _bucket_name(ceph_test_settings.test_prefix, "cfg-logs")

    for created_bucket in (bucket_name, logging_bucket):
        _create_bucket(manager_session, account_id, created_bucket)
        resource_tracker.track_bucket(account_id, created_bucket)

    try:
        logging_payload = {
            "enabled": True,
            "target_bucket": logging_bucket,
            "target_prefix": "ceph-functional-logs/",
        }
        manager_session.put(
            f"/manager/buckets/{bucket_name}/logging",
            params=_account_params(account_id),
            json=logging_payload,
        )
        _wait_for_value(
            "bucket access logging",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/logging",
                params=_account_params(account_id),
            ),
            lambda current: (
                current.get("enabled") is True
                and current.get("target_bucket") == logging_bucket
                and current.get("target_prefix") == "ceph-functional-logs/"
            ),
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/logging",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_value(
            "bucket access logging deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/logging",
                params=_account_params(account_id),
            ),
            lambda current: (
                current.get("enabled") is False
                and not current.get("target_bucket")
                and not current.get("target_prefix")
            ),
        )
    except BackendAPIError as exc:
        _skip_if_cluster_unavailable(
            "manager bucket logging",
            exc,
            extra_markers=("accessdenied",),
        )
        raise
    finally:
        for created_bucket in (bucket_name, logging_bucket):
            _delete_bucket(manager_session, resource_tracker, account_id, created_bucket)


@pytest.mark.ceph_functional
def test_manager_bucket_website_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "cfg-site")
    _create_bucket(manager_session, account_id, bucket_name)
    resource_tracker.track_bucket(account_id, bucket_name)

    try:
        website_payload = {
            "index_document": "index.html",
            "error_document": "error.html",
        }
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
            lambda current: (
                current.get("index_document") == "index.html"
                and current.get("error_document") == "error.html"
                and current.get("redirect_all_requests_to") in (None, {})
            ),
        )
        manager_session.delete(
            f"/manager/buckets/{bucket_name}/website",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_value(
            "bucket website deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/website",
                params=_account_params(account_id),
            ),
            lambda current: (
                not current.get("index_document")
                and not current.get("error_document")
                and current.get("redirect_all_requests_to") in (None, {})
                and not current.get("routing_rules")
            ),
        )
    except BackendAPIError as exc:
        _skip_if_cluster_unavailable("manager bucket website", exc)
        raise
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


@pytest.mark.ceph_functional
def test_manager_bucket_quota_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "quota")
    _create_bucket(manager_session, account_id, bucket_name)
    resource_tracker.track_bucket(account_id, bucket_name)

    try:
        try:
            run_or_skip(
                "manager bucket quota update",
                lambda: super_admin_session.put(
                    f"/manager/buckets/{bucket_name}/quota",
                    params=_account_params(account_id),
                    json={"max_size_gb": 1, "max_objects": 1000},
                ),
            )
        except BackendAPIError as exc:
            if looks_unsupported(exc):
                pytest.skip(f"Bucket quota updates unavailable on this cluster: {exc}")
            raise

        stats = _wait_for_value(
            "bucket quota stats",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/stats",
                params=_account_params(account_id),
            ),
            lambda current: (
                current.get("quota_max_size_bytes") == 1024**3 and current.get("quota_max_objects") == 1000
            ),
        )
        assert stats["quota_max_size_bytes"] == 1024**3
        assert stats["quota_max_objects"] == 1000
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


@pytest.mark.ceph_functional
def test_manager_bucket_notifications_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "notify")
    topic_name = _topic_name(ceph_test_settings.test_prefix, "notify")
    topic_arn = ""

    _create_bucket(manager_session, account_id, bucket_name)
    resource_tracker.track_bucket(account_id, bucket_name)

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
        assert topic_arn, "Topic creation did not return an ARN"

        notification_configuration = {
            "TopicConfigurations": [
                {
                    "Id": "ObjectCreateAll",
                    "TopicArn": topic_arn,
                    "Events": ["s3:ObjectCreated:*"],
                    "Filter": {
                        "Key": {
                            "FilterRules": [
                                {"Name": "prefix", "Value": "uploads/"},
                            ]
                        }
                    },
                }
            ]
        }
        run_or_skip(
            "manager bucket notifications update",
            lambda: manager_session.put(
                f"/manager/buckets/{bucket_name}/notifications",
                params=_account_params(account_id),
                json={"configuration": notification_configuration},
            ),
        )
        _wait_for_equal(
            "bucket notification configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/notifications",
                params=_account_params(account_id),
            ),
            {"configuration": notification_configuration},
        )

        manager_session.delete(
            f"/manager/buckets/{bucket_name}/notifications",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_equal(
            "bucket notification deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/notifications",
                params=_account_params(account_id),
            ),
            {"configuration": {}},
        )
    finally:
        _delete_topic(manager_session, account_id, topic_arn)
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


@pytest.mark.ceph_functional
def test_manager_bucket_replication_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "replication-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "replication-dst")

    for created_bucket in (source_bucket, target_bucket):
        _create_bucket(manager_session, account_id, created_bucket)
        resource_tracker.track_bucket(account_id, created_bucket)

    try:
        for created_bucket in (source_bucket, target_bucket):
            manager_session.put(
                f"/manager/buckets/{created_bucket}/versioning",
                params=_account_params(account_id),
                json={"enabled": True},
            )
            _wait_for_value(
                f"bucket versioning for {created_bucket}",
                lambda bucket_name=created_bucket: manager_session.get(
                    f"/manager/buckets/{bucket_name}/properties",
                    params=_account_params(account_id),
                ),
                lambda current: current.get("versioning_status") == "Enabled",
            )

        replication_payload = {
            "configuration": {
                "Role": "arn:aws:iam::000000000000:role/manager-functional-replication",
                "Rules": [
                    {
                        "ID": "replicate-all",
                        "Status": "Enabled",
                        "Priority": 1,
                        "Filter": {"Prefix": ""},
                        "DeleteMarkerReplication": {"Status": "Disabled"},
                        "Destination": {"Bucket": f"arn:aws:s3:::{target_bucket}"},
                    }
                ],
            }
        }
        run_or_skip(
            "manager bucket replication update",
            lambda: manager_session.put(
                f"/manager/buckets/{source_bucket}/replication",
                params=_account_params(account_id),
                json=replication_payload,
            ),
        )
        _wait_for_equal(
            "bucket replication configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{source_bucket}/replication",
                params=_account_params(account_id),
            ),
            replication_payload,
        )

        manager_session.delete(
            f"/manager/buckets/{source_bucket}/replication",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        _wait_for_equal(
            "bucket replication deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{source_bucket}/replication",
                params=_account_params(account_id),
            ),
            {"configuration": {}},
        )
    finally:
        for created_bucket in (source_bucket, target_bucket):
            _delete_bucket(manager_session, resource_tracker, account_id, created_bucket)
