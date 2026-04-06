# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from urllib.parse import quote
import uuid

import pytest

from .ceph_admin_helpers import backend_error_detail, looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker
from .test_browser_clipboard_flow import (
    _account_params,
    _bucket_name,
    _download_bytes,
    _list_object_keys,
    _upload_bytes,
)
from .test_bucket_configuration_flow import (
    _create_bucket,
    _delete_bucket,
    _delete_topic,
    _skip_if_cluster_unavailable,
    _topic_name,
)
from .test_iam_policy_flow import _cleanup_iam_user

pytestmark = pytest.mark.ceph_functional


def _iam_name(prefix: str, label: str) -> str:
    return f"{prefix}-{label}-{uuid.uuid4().hex[:8]}"


def _skip_if_feature_disabled_or_unavailable(action: str, exc: BackendAPIError) -> None:
    detail = backend_error_detail(exc).strip()
    normalized_detail = detail.lower()
    if "feature is disabled" in normalized_detail:
        pytest.skip(f"{action} is disabled in this environment: {detail}")
    if looks_unsupported(exc):
        pytest.skip(f"{action} unavailable on this cluster: {detail or f'status={exc.status_code}'}")


def _has_public_read_bucket_acl(payload: dict) -> bool:
    for grant in payload.get("grants") or []:
        permission = str(grant.get("permission") or "").upper()
        grantee = grant.get("grantee") or {}
        uri = str(grantee.get("uri") or "")
        if permission == "READ" and uri.endswith("/AllUsers"):
            return True
    return False


def _delete_role(session: BackendSession, account_id: int, role_name: str) -> None:
    session.delete(
        f"/manager/iam/roles/{role_name}",
        params=_account_params(account_id),
        expected_status=(204, 404),
    )


def _delete_group(session: BackendSession, account_id: int, group_name: str) -> None:
    session.delete(
        f"/manager/iam/groups/{group_name}",
        params=_account_params(account_id),
        expected_status=(204, 404),
    )


def test_manager_bucket_compare_and_remediation_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    source_bucket = _bucket_name(ceph_test_settings.test_prefix, "manager-compare-src")
    target_bucket = _bucket_name(ceph_test_settings.test_prefix, "manager-compare-dst")
    _create_bucket(manager_session, account_id, source_bucket, versioning=False)
    _create_bucket(manager_session, account_id, target_bucket, versioning=False)
    resource_tracker.track_bucket(account_id, source_bucket)
    resource_tracker.track_bucket(account_id, target_bucket)

    same_key = "reports/shared.txt"
    different_key = "reports/different.txt"
    source_only_key = "reports/source-only.txt"
    target_only_key = "reports/target-only.txt"

    try:
        _upload_bytes(
            manager_session,
            account_id,
            source_bucket,
            same_key,
            b"same-payload",
            content_type="text/plain",
        )
        _upload_bytes(
            manager_session,
            account_id,
            target_bucket,
            same_key,
            b"same-payload",
            content_type="text/plain",
        )
        _upload_bytes(
            manager_session,
            account_id,
            source_bucket,
            different_key,
            b"source-version",
            content_type="text/plain",
        )
        _upload_bytes(
            manager_session,
            account_id,
            target_bucket,
            different_key,
            b"target-version",
            content_type="text/plain",
        )
        _upload_bytes(
            manager_session,
            account_id,
            source_bucket,
            source_only_key,
            b"source-only",
            content_type="text/plain",
        )
        _upload_bytes(
            manager_session,
            account_id,
            target_bucket,
            target_only_key,
            b"target-only",
            content_type="text/plain",
        )

        try:
            comparison = manager_session.post(
                "/manager/buckets/compare",
                params=_account_params(account_id),
                json={
                    "target_context_id": str(account_id),
                    "source_bucket": source_bucket,
                    "target_bucket": target_bucket,
                    "include_content": True,
                    "include_config": False,
                    "diff_sample_limit": 20,
                },
            )
        except BackendAPIError as exc:
            _skip_if_feature_disabled_or_unavailable("manager bucket compare", exc)
            raise

        content_diff = comparison["content_diff"]
        assert comparison["has_differences"] is True
        assert content_diff["matched_count"] == 1
        assert content_diff["different_count"] == 1
        assert content_diff["only_source_count"] == 1
        assert content_diff["only_target_count"] == 1
        assert content_diff["only_source_sample"] == [source_only_key]
        assert content_diff["only_target_sample"] == [target_only_key]
        assert content_diff["different_sample"][0]["key"] == different_key

        for action, planned_count in (
            ("sync_source_only", 1),
            ("sync_different", 1),
            ("delete_target_only", 1),
        ):
            remediation = manager_session.post(
                "/manager/buckets/compare/action",
                params=_account_params(account_id),
                json={
                    "target_context_id": str(account_id),
                    "source_bucket": source_bucket,
                    "target_bucket": target_bucket,
                    "action": action,
                    "parallelism": 2,
                },
            )
            assert remediation["action"] == action
            assert remediation["planned_count"] == planned_count
            assert remediation["succeeded_count"] == planned_count
            assert remediation["failed_count"] == 0

        assert source_only_key in _list_object_keys(manager_session, account_id, target_bucket, prefix="reports/")
        assert target_only_key not in _list_object_keys(manager_session, account_id, target_bucket, prefix="reports/")
        assert _download_bytes(manager_session, account_id, target_bucket, different_key) == b"source-version"

        final_comparison = manager_session.post(
            "/manager/buckets/compare",
            params=_account_params(account_id),
            json={
                "target_context_id": str(account_id),
                "source_bucket": source_bucket,
                "target_bucket": target_bucket,
                "include_content": True,
                "include_config": False,
                "diff_sample_limit": 20,
            },
        )
        final_content_diff = final_comparison["content_diff"]
        assert final_comparison["has_differences"] is False
        assert final_content_diff["different_count"] == 0
        assert final_content_diff["only_source_count"] == 0
        assert final_content_diff["only_target_count"] == 0
    finally:
        for bucket_name in (target_bucket, source_bucket):
            _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_manager_bucket_advanced_security_roundtrip(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix, "manager-security")
    _create_bucket(manager_session, account_id, bucket_name, versioning=True)
    resource_tracker.track_bucket(account_id, bucket_name)

    try:
        acl_payload = manager_session.put(
            f"/manager/buckets/{bucket_name}/acl",
            params=_account_params(account_id),
            json={"acl": "public-read"},
        )
        assert _has_public_read_bucket_acl(acl_payload)

        try:
            encryption_payload = manager_session.put(
                f"/manager/buckets/{bucket_name}/encryption",
                params=_account_params(account_id),
                json={"rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
            )
        except BackendAPIError as exc:
            detail = backend_error_detail(exc).strip().lower()
            if exc.status_code == 403 and "server-side encryption is disabled for this endpoint" in detail:
                pass
            else:
                _skip_if_cluster_unavailable("manager bucket encryption", exc)
                raise
        else:
            assert encryption_payload["rules"] == [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            fetched_encryption = manager_session.get(
                f"/manager/buckets/{bucket_name}/encryption",
                params=_account_params(account_id),
            )
            assert fetched_encryption["rules"] == encryption_payload["rules"]
            manager_session.delete(
                f"/manager/buckets/{bucket_name}/encryption",
                params=_account_params(account_id),
                expected_status=(204,),
            )
            fetched_after_delete = manager_session.get(
                f"/manager/buckets/{bucket_name}/encryption",
                params=_account_params(account_id),
            )
            assert fetched_after_delete["rules"] == []

        try:
            object_lock_payload = manager_session.put(
                f"/manager/buckets/{bucket_name}/object-lock",
                params=_account_params(account_id),
                json={"enabled": True, "mode": "GOVERNANCE", "days": 1},
            )
        except BackendAPIError as exc:
            if looks_unsupported(
                exc,
                markers=(
                    "object lock",
                    "objectlock",
                    "invalidbucketstate",
                    "not supported",
                    "not enabled",
                ),
            ):
                return
            raise
        assert object_lock_payload["enabled"] is True
        assert object_lock_payload["mode"] == "GOVERNANCE"
        assert object_lock_payload["days"] == 1
        fetched_object_lock = manager_session.get(
            f"/manager/buckets/{bucket_name}/object-lock",
            params=_account_params(account_id),
        )
        assert fetched_object_lock["enabled"] is True
        assert fetched_object_lock["mode"] == "GOVERNANCE"
        assert fetched_object_lock["days"] == 1
    finally:
        _delete_bucket(manager_session, resource_tracker, account_id, bucket_name)


def test_manager_iam_roles_and_groups_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    user_name = _iam_name(ceph_test_settings.test_prefix, "iam-user")
    group_name = _iam_name(ceph_test_settings.test_prefix, "iam-group")
    role_name = _iam_name(ceph_test_settings.test_prefix, "iam-role")
    policy_name = _iam_name(ceph_test_settings.test_prefix, "iam-policy")

    policy_arn: str | None = None
    encoded_policy_arn: str | None = None

    try:
        created_user = manager_session.post(
            "/manager/iam/users",
            params=_account_params(account_id),
            json={"name": user_name, "create_key": True},
            expected_status=201,
        )
        assert created_user["name"] == user_name

        created_group = manager_session.post(
            "/manager/iam/groups",
            params=_account_params(account_id),
            json={
                "name": group_name,
                "inline_policies": [
                    {
                        "name": "GroupInlineAccess",
                        "document": {
                            "Version": "2012-10-17",
                            "Statement": [{"Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["*"]}],
                        },
                    }
                ],
            },
            expected_status=201,
        )
        assert created_group["name"] == group_name

        created_role = manager_session.post(
            "/manager/iam/roles",
            params=_account_params(account_id),
            json={
                "name": role_name,
                "path": "/functional/",
                "assume_role_policy_document": {
                    "Version": "2012-10-17",
                    "Statement": [{"Effect": "Allow", "Principal": {"AWS": "*"}, "Action": "sts:AssumeRole"}],
                },
                "inline_policies": [
                    {
                        "name": "RoleInlineAccess",
                        "document": {
                            "Version": "2012-10-17",
                            "Statement": [{"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": ["*"]}],
                        },
                    }
                ],
            },
            expected_status=201,
        )
        assert created_role["name"] == role_name
        assert created_role["path"] == "/functional/"

        assert any(
            entry["name"] == group_name
            for entry in manager_session.get("/manager/iam/groups", params=_account_params(account_id))
        )
        assert any(
            entry["name"] == role_name
            for entry in manager_session.get("/manager/iam/roles", params=_account_params(account_id))
        )

        group_inline_policies = manager_session.get(
            f"/manager/iam/groups/{group_name}/inline-policies",
            params=_account_params(account_id),
        )
        assert [entry["name"] for entry in group_inline_policies] == ["GroupInlineAccess"]

        role_inline_policies = manager_session.get(
            f"/manager/iam/roles/{role_name}/inline-policies",
            params=_account_params(account_id),
        )
        assert [entry["name"] for entry in role_inline_policies] == ["RoleInlineAccess"]

        manager_session.put(
            f"/manager/iam/roles/{role_name}",
            params=_account_params(account_id),
            json={
                "assume_role_policy_document": {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": "FunctionalAssumeRole",
                            "Effect": "Allow",
                            "Principal": {"AWS": "*"},
                            "Action": "sts:AssumeRole",
                        }
                    ],
                }
            },
        )
        updated_role = manager_session.get(
            f"/manager/iam/roles/{role_name}",
            params=_account_params(account_id),
        )
        statements = (updated_role.get("assume_role_policy_document") or {}).get("Statement") or []
        assert any(statement.get("Sid") == "FunctionalAssumeRole" for statement in statements)

        try:
            managed_policy = manager_session.post(
                "/manager/iam/policies",
                params=_account_params(account_id),
                json={
                    "name": policy_name,
                    "document": {
                        "Version": "2012-10-17",
                        "Statement": [{"Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["*"]}],
                    },
                },
                expected_status=201,
            )
        except BackendAPIError as exc:
            detail = backend_error_detail(exc)
            if "createpolicy is not supported" not in detail.lower():
                raise
        else:
            policy_arn = managed_policy["arn"]
            encoded_policy_arn = quote(policy_arn, safe="")
            manager_session.post(
                f"/manager/iam/groups/{group_name}/policies",
                params=_account_params(account_id),
                json={"arn": policy_arn, "name": policy_name, "path": managed_policy.get("path", "/")},
                expected_status=201,
            )
            manager_session.post(
                f"/manager/iam/roles/{role_name}/policies",
                params=_account_params(account_id),
                json={"arn": policy_arn, "name": policy_name, "path": managed_policy.get("path", "/")},
                expected_status=201,
            )

            group_policies = manager_session.get(
                f"/manager/iam/groups/{group_name}/policies",
                params=_account_params(account_id),
            )
            assert any(entry["arn"] == policy_arn for entry in group_policies)

            role_policies = manager_session.get(
                f"/manager/iam/roles/{role_name}/policies",
                params=_account_params(account_id),
            )
            assert any(entry["arn"] == policy_arn for entry in role_policies)

        manager_session.post(
            f"/manager/iam/groups/{group_name}/users",
            params=_account_params(account_id),
            json={"name": user_name},
            expected_status=201,
        )
        group_users = manager_session.get(
            f"/manager/iam/groups/{group_name}/users",
            params=_account_params(account_id),
        )
        assert any(entry["name"] == user_name for entry in group_users)
    except BackendAPIError as exc:
        _skip_if_feature_disabled_or_unavailable("manager IAM roles/groups", exc)
        raise
    finally:
        try:
            manager_session.delete(
                f"/manager/iam/groups/{group_name}/users/{user_name}",
                params=_account_params(account_id),
                expected_status=(204, 404),
            )
        except BackendAPIError:
            pass
        try:
            manager_session.delete(
                f"/manager/iam/groups/{group_name}/inline-policies/GroupInlineAccess",
                params=_account_params(account_id),
                expected_status=(204, 404),
            )
        except BackendAPIError:
            pass
        try:
            manager_session.delete(
                f"/manager/iam/roles/{role_name}/inline-policies/RoleInlineAccess",
                params=_account_params(account_id),
                expected_status=(204, 404),
            )
        except BackendAPIError:
            pass
        if policy_arn and encoded_policy_arn:
            for path in (
                f"/manager/iam/groups/{group_name}/policies/{encoded_policy_arn}",
                f"/manager/iam/roles/{role_name}/policies/{encoded_policy_arn}",
            ):
                try:
                    manager_session.delete(path, params=_account_params(account_id), expected_status=(204, 404))
                except BackendAPIError:
                    pass
        try:
            _delete_group(manager_session, account_id, group_name)
        except BackendAPIError:
            pass
        try:
            _delete_role(manager_session, account_id, role_name)
        except BackendAPIError:
            pass
        try:
            _cleanup_iam_user(manager_session, account_id, user_name)
        except BackendAPIError:
            pass
        if policy_arn and encoded_policy_arn:
            try:
                manager_session.delete(
                    f"/manager/iam/policies/{encoded_policy_arn}",
                    params=_account_params(account_id),
                    expected_status=(204, 404),
                )
            except BackendAPIError:
                pass


def test_manager_topics_policy_and_configuration_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    topic_name = _topic_name(ceph_test_settings.test_prefix, "advanced-topic")
    topic_arn = ""

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
        assert topic_arn

        listed_topics = manager_session.get("/manager/topics", params=_account_params(account_id))
        assert any(entry["arn"] == topic_arn for entry in listed_topics)

        initial_policy = manager_session.get(
            f"/manager/topics/{topic_arn}/policy",
            params=_account_params(account_id),
        )
        assert isinstance(initial_policy.get("policy"), dict)

        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AllowOwnerPublish",
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["sns:Publish"],
                    "Resource": [topic_arn],
                }
            ],
        }
        manager_session.put(
            f"/manager/topics/{topic_arn}/policy",
            params=_account_params(account_id),
            json={"policy": policy_document},
        )
        fetched_policy = manager_session.get(
            f"/manager/topics/{topic_arn}/policy",
            params=_account_params(account_id),
        )
        assert fetched_policy["policy"] == policy_document

        configuration_payload = {
            "push-endpoint": "https://notify.example.test/hooks/advanced",
            "verify-ssl": False,
        }
        manager_session.put(
            f"/manager/topics/{topic_arn}/configuration",
            params=_account_params(account_id),
            json={"configuration": configuration_payload},
        )
        fetched_configuration = manager_session.get(
            f"/manager/topics/{topic_arn}/configuration",
            params=_account_params(account_id),
        )
        assert fetched_configuration["configuration"] == configuration_payload

        manager_session.delete(
            f"/manager/topics/{topic_arn}",
            params=_account_params(account_id),
            expected_status=(204,),
        )
        topic_arn = ""
        listed_after_delete = manager_session.get("/manager/topics", params=_account_params(account_id))
        assert not any(entry["name"] == topic_name for entry in listed_after_delete)
    except BackendAPIError as exc:
        _skip_if_feature_disabled_or_unavailable("manager topics", exc)
        raise
    finally:
        _delete_topic(manager_session, account_id, topic_arn)


def test_manager_context_overview_and_endpoint_health_flow(
    provisioned_account,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    context = manager_session.get("/manager/context", params=_account_params(account_id))
    assert context["context_kind"] == "account"
    assert context["access_mode"] == "admin"
    assert isinstance(context.get("manager_stats_enabled"), bool)
    assert context["manager_browser_enabled"] is True
    assert isinstance(context.get("manager_ceph_keys_enabled"), bool)
    assert context.get("iam_identity")

    iam_overview = manager_session.get("/manager/iam/overview", params=_account_params(account_id))
    assert iam_overview["iam_users"] >= 0
    assert iam_overview["iam_groups"] >= 0
    assert iam_overview["iam_roles"] >= 0
    assert iam_overview["iam_policies"] >= 0
    assert isinstance(iam_overview["warnings"], list)

    response = manager_session.request(
        "GET",
        "/manager/stats/endpoint-health",
        params=_account_params(account_id),
        expected_status=(200, 403),
    )
    try:
        payload = response.json()
    finally:
        response.close()
    if response.status_code == 403:
        assert payload["detail"] == "Endpoint Status feature is disabled."
        return

    assert payload["endpoint_count"] >= 1
    assert payload["endpoint_count"] == (
        payload["up_count"] + payload["degraded_count"] + payload["down_count"] + payload["unknown_count"]
    )
    assert len(payload["endpoints"]) <= payload["endpoint_count"]
    for entry in payload["endpoints"]:
        assert entry["endpoint_id"] > 0
        assert entry["name"]
        assert entry["endpoint_url"].startswith("http")
        assert entry["status"] in {"up", "degraded", "down", "unknown"}
        assert entry["checked_at"]
