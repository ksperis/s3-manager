# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import json
import time
import uuid
from typing import Any, Callable

import pytest
import requests

from .ceph_admin_helpers import backend_error_detail, looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendAuthenticator, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket_name(prefix: str, label: str = "cfg") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _topic_name(prefix: str, label: str = "topic") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _iam_name(prefix: str, label: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _account_params(account_id: int | str) -> dict[str, int | str]:
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
    last_error: Exception | None = None

    while time.monotonic() < deadline:
        try:
            last_value = fetch()
            if predicate(last_value):
                return last_value
        except (BackendAPIError, requests.RequestException) as exc:
            last_error = exc
        time.sleep(interval)

    try:
        last_value = fetch()
        if predicate(last_value):
            return last_value
    except (BackendAPIError, requests.RequestException) as exc:
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


def _create_bucket(
    manager_session: BackendSession,
    account_id: int | str,
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


def _allow_server_access_log_delivery(
    manager_session: BackendSession,
    account_id: int | str,
    source_bucket: str,
    target_bucket: str,
    target_prefix: str,
) -> None:
    target_resource = f"arn:aws:s3:::{target_bucket}/{target_prefix}*"
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "S3ManagerCephFunctionalLogDelivery",
                "Effect": "Allow",
                "Principal": {"Service": "logging.s3.amazonaws.com"},
                "Action": "s3:PutObject",
                "Resource": target_resource,
                "Condition": {
                    "ArnLike": {"aws:SourceArn": f"arn:aws:s3:::{source_bucket}"},
                },
            },
        ],
    }
    manager_session.put(
        f"/manager/buckets/{target_bucket}/policy",
        params=_account_params(account_id),
        json={"policy": policy},
    )


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


def _find_replication_endpoints(super_admin_session: BackendSession) -> tuple[dict[str, Any], dict[str, Any]]:
    endpoints = super_admin_session.get("/ceph-admin/endpoints")
    if not isinstance(endpoints, list):
        pytest.skip("Bucket replication validation requires Ceph Admin endpoint discovery")

    replication_endpoints = [
        endpoint
        for endpoint in endpoints
        if isinstance(endpoint, dict)
        and bool((endpoint.get("capabilities") or {}).get("replication"))
        and endpoint.get("id") is not None
    ]
    source = next((endpoint for endpoint in replication_endpoints if bool(endpoint.get("is_default"))), None)
    if source is None:
        pytest.skip("Bucket replication validation requires a default replication-capable endpoint")
    source_id = int(source["id"])
    target = next((endpoint for endpoint in replication_endpoints if int(endpoint["id"]) != source_id), None)
    if target is None:
        pytest.skip("Bucket replication validation requires a second replication-capable Ceph endpoint")
    return source, target


def _create_replication_connection_context(
    *,
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    ceph_test_settings: CephTestSettings,
    endpoint: dict[str, Any],
) -> dict[str, Any]:
    if not ceph_test_settings.rgw_admin_access_key or not ceph_test_settings.rgw_admin_secret_key:
        pytest.skip("Bucket replication validation requires lab S3 credentials")

    suffix = uuid.uuid4().hex[:8]
    manager_email = f"{ceph_test_settings.test_prefix}.replication.{suffix}@example.com"
    manager_password = f"Test-{uuid.uuid4().hex[:12]}"
    context: dict[str, Any] = {}

    try:
        created_user = super_admin_session.post(
            "/admin/users",
            json={
                "email": manager_email,
                "password": manager_password,
                "full_name": "Ceph Functional Replication User",
                "role": "ui_user",
            },
            expected_status=201,
        )
        user_id = int(created_user["id"])
        context["user_id"] = user_id

        created_connection = super_admin_session.post(
            "/admin/s3-connections",
            json={
                "name": f"{ceph_test_settings.test_prefix}-replication-conn-{suffix}",
                "storage_endpoint_id": int(endpoint["id"]),
                "access_key_id": ceph_test_settings.rgw_admin_access_key,
                "secret_access_key": ceph_test_settings.rgw_admin_secret_key,
                "provider_hint": "CEPH",
                "region": endpoint.get("region") or ceph_test_settings.rgw_admin_region or "us-east-1",
                "verify_tls": ceph_test_settings.rgw_verify_tls,
            },
            expected_status=201,
        )
        connection_id = int(created_connection["id"])
        context["connection_id"] = connection_id
        super_admin_session.post(
            f"/admin/s3-connections/{connection_id}/users",
            json={"user_id": user_id},
            expected_status=201,
        )

        context["manager_session"] = backend_authenticator.login(manager_email, manager_password)
        context["account_ref"] = f"conn-{connection_id}"
        return context
    except Exception:
        _cleanup_replication_connection_context(super_admin_session, context)
        raise


def _cleanup_replication_connection_context(super_admin_session: BackendSession, context: dict[str, Any]) -> None:
    manager_session = context.get("manager_session")
    if isinstance(manager_session, BackendSession):
        manager_session.session.close()
    connection_id = context.get("connection_id")
    if connection_id is not None:
        try:
            super_admin_session.delete(f"/admin/s3-connections/{int(connection_id)}", expected_status=(204, 404))
        except BackendAPIError:
            pass
    user_id = context.get("user_id")
    if user_id is not None:
        try:
            super_admin_session.delete(f"/admin/users/{int(user_id)}", expected_status=(204, 404))
        except BackendAPIError:
            pass


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
        target_prefix = "ceph-functional-logs/"
        _allow_server_access_log_delivery(
            manager_session,
            account_id,
            source_bucket=bucket_name,
            target_bucket=logging_bucket,
            target_prefix=target_prefix,
        )
        logging_payload = {
            "enabled": True,
            "target_bucket": logging_bucket,
            "target_prefix": target_prefix,
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
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
) -> None:
    source_endpoint, target_endpoint = _find_replication_endpoints(super_admin_session)
    context = _create_replication_connection_context(
        super_admin_session=super_admin_session,
        backend_authenticator=backend_authenticator,
        ceph_test_settings=ceph_test_settings,
        endpoint=source_endpoint,
    )
    manager_session: BackendSession = context["manager_session"]
    account_ref = context["account_ref"]
    target_endpoint_id = int(target_endpoint["id"])

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "replication")
    role_arn = "arn:aws:iam::000000000000:role/manager-functional-replication"

    replication_configured = False
    try:
        _create_bucket(manager_session, account_ref, bucket_name, versioning=True)
        _wait_for_value(
            f"bucket versioning for {bucket_name}",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/properties",
                params=_account_params(account_ref),
            ),
            lambda current: current.get("versioning_status") == "Enabled",
        )

        expected_rules = [
            {
                "ID": "replicate-to-lab-z2",
                "Status": "Enabled",
                "Priority": 1,
                "Filter": {"Prefix": ""},
                "DeleteMarkerReplication": {"Status": "Disabled"},
                "Destination": {"Bucket": f"arn:aws:s3:::{bucket_name}"},
            }
        ]

        replication_payload = {
            "configuration": {
                "Role": role_arn,
                "Rules": expected_rules,
            }
        }

        manager_session.put(
            f"/manager/buckets/{bucket_name}/replication",
            params=_account_params(account_ref),
            json=replication_payload,
        )
        replication_configured = True

        def _replication_matches(current: Any) -> bool:
            configuration = current.get("configuration") if isinstance(current, dict) else {}
            if not isinstance(configuration, dict):
                return False
            rules = configuration.get("Rules") or []
            if not isinstance(rules, list) or len(rules) != 1:
                return False
            rule = rules[0]
            if not isinstance(rule, dict):
                return False
            destination = rule.get("Destination") if isinstance(rule.get("Destination"), dict) else {}
            if rule.get("ID") != "replicate-to-lab-z2":
                return False
            if rule.get("Status") != "Enabled":
                return False
            if destination.get("Bucket") != f"arn:aws:s3:::{bucket_name}":
                return False
            returned_role = str(configuration.get("Role") or "").strip()
            return returned_role in {"", role_arn}

        fetched_replication = _wait_for_value(
            "bucket replication configuration",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/replication",
                params=_account_params(account_ref),
            ),
            _replication_matches,
        )
        fetched_configuration = fetched_replication["configuration"]
        fetched_rule = fetched_configuration["Rules"][0]
        assert fetched_rule["ID"] == "replicate-to-lab-z2"
        assert fetched_rule["Status"] == "Enabled"
        assert fetched_rule["Destination"]["Bucket"] == f"arn:aws:s3:::{bucket_name}"
        assert str(fetched_configuration.get("Role") or "").strip() in {"", role_arn}

        object_key = f"replication/{uuid.uuid4().hex}.txt"
        object_body = f"same-zonegroup {uuid.uuid4().hex}\n".encode("utf-8")
        upload_response = manager_session.request(
            "POST",
            f"/manager/buckets/{bucket_name}/objects/upload",
            params=_account_params(account_ref),
            data={"prefix": "", "key": object_key},
            files={"file": ("replication.txt", io.BytesIO(object_body), "text/plain")},
            expected_status=201,
        ).json()
        assert upload_response["key"] == object_key

        replicated_object = _wait_for_value(
            "replicated object on target zone",
            lambda: super_admin_session.get(
                f"/browser/buckets/{bucket_name}/object-meta",
                params={"account_id": f"ceph-admin-{target_endpoint_id}", "key": object_key},
            ),
            lambda current: isinstance(current, dict)
            and current.get("key") == object_key
            and int(current.get("size") or -1) == len(object_body),
            timeout=300.0,
            interval=5.0,
        )
        assert replicated_object["key"] == object_key

        manager_session.delete(
            f"/manager/buckets/{bucket_name}/replication",
            params=_account_params(account_ref),
            expected_status=(204,),
        )
        replication_configured = False
        _wait_for_value(
            "bucket replication deletion",
            lambda: manager_session.get(
                f"/manager/buckets/{bucket_name}/replication",
                params=_account_params(account_ref),
            ),
            lambda current: not ((current.get("configuration") or {}).get("Rules"))
            if isinstance(current, dict)
            else False,
        )
    finally:
        if replication_configured:
            try:
                manager_session.delete(
                    f"/manager/buckets/{bucket_name}/replication",
                    params=_account_params(account_ref),
                    expected_status=(204, 404),
                )
            except BackendAPIError:
                pass
        try:
            manager_session.delete(
                f"/manager/buckets/{bucket_name}",
                params={"account_id": account_ref, "force": "true"},
                expected_status=(200, 404),
            )
        except BackendAPIError:
            pass
        _cleanup_replication_connection_context(super_admin_session, context)
