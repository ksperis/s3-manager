# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import uuid
from typing import Any, Callable, TypeVar

import pytest

from .ceph_admin_helpers import looks_unsupported, run_or_skip
from .clients import BackendAPIError, BackendSession
from .conftest import CephAdminEndpointTestContext, S3AccountTestContext
from .resources import ResourceTracker

T = TypeVar("T")


def _bucket_name(prefix: str, label: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-{label}"


def _optional(action: str, fn: Callable[[], T]) -> T | None:
    try:
        return fn()
    except BackendAPIError as exc:
        if looks_unsupported(exc):
            return None
        raise


@pytest.mark.ceph_functional
def test_ceph_admin_bucket_configuration_and_compare(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
    provisioned_account: S3AccountTestContext,
    ceph_test_settings,
    resource_tracker: ResourceTracker,
) -> None:
    endpoint_id = ceph_admin_endpoint.endpoint_id
    account_id = provisioned_account.account_id
    manager_session = provisioned_account.manager_session
    main_bucket = _bucket_name(ceph_test_settings.test_prefix, "ceph-admin-main")
    logging_bucket = _bucket_name(ceph_test_settings.test_prefix, "ceph-admin-logs")

    for bucket_name in (main_bucket, logging_bucket):
        manager_session.post(
            "/manager/buckets",
            params={"account_id": account_id},
            json={
                "name": bucket_name,
                "versioning": False,
                "block_public_access": False,
            },
            expected_status=201,
        )
        resource_tracker.track_bucket(account_id, bucket_name)

    object_key = f"ceph-admin/{uuid.uuid4().hex}.txt"
    manager_session.request(
        "POST",
        f"/manager/buckets/{main_bucket}/objects/upload",
        params={"account_id": account_id},
        data={"prefix": "", "key": object_key},
        files={"file": ("payload.txt", io.BytesIO(b"ceph-admin compare payload"), "text/plain")},
        expected_status=201,
    )

    try:
        base_path = f"/ceph-admin/endpoints/{endpoint_id}/buckets/{main_bucket}"

        listing = run_or_skip(
            "ceph-admin bucket listing",
            lambda: super_admin_session.get(
                f"/ceph-admin/endpoints/{endpoint_id}/buckets",
                params={
                    "filter": main_bucket,
                    "page": 1,
                    "page_size": 100,
                    "sort_by": "name",
                    "sort_dir": "asc",
                    "include": (
                        "owner_name,tags,versioning,object_lock,block_public_access,lifecycle_rules,static_website,"
                        "bucket_policy,cors,access_logging,server_side_encryption"
                    ),
                },
            ),
        )
        assert any(item["name"] == main_bucket for item in listing.get("items", []))

        properties = run_or_skip(
            "ceph-admin bucket properties",
            lambda: super_admin_session.get(f"{base_path}/properties"),
        )
        assert "versioning_status" in properties

        run_or_skip(
            "ceph-admin bucket versioning",
            lambda: super_admin_session.put(f"{base_path}/versioning", json={"enabled": True}),
        )

        lifecycle_rules = [
            {
                "ID": "ceph-admin-expire",
                "Status": "Enabled",
                "Prefix": "tmp/",
                "Expiration": {"Days": 1},
            }
        ]
        if _optional(
            "ceph-admin bucket lifecycle update",
            lambda: super_admin_session.put(f"{base_path}/lifecycle", json={"rules": lifecycle_rules}),
        ):
            _optional("ceph-admin bucket lifecycle delete", lambda: super_admin_session.delete(f"{base_path}/lifecycle", expected_status=(204,)))

        cors_rules = [
            {
                "AllowedHeaders": ["*"],
                "AllowedMethods": ["GET", "PUT"],
                "AllowedOrigins": ["https://example.com"],
                "ExposeHeaders": ["x-amz-meta-test"],
                "MaxAgeSeconds": 300,
            }
        ]
        if _optional(
            "ceph-admin bucket CORS update",
            lambda: super_admin_session.put(f"{base_path}/cors", json={"rules": cors_rules}),
        ):
            _optional("ceph-admin bucket CORS delete", lambda: super_admin_session.delete(f"{base_path}/cors", expected_status=(204,)))

        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "CephAdminFunctionalAccess",
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetBucketLocation"],
                    "Resource": [f"arn:aws:s3:::{main_bucket}"],
                }
            ],
        }
        if _optional(
            "ceph-admin bucket policy update",
            lambda: super_admin_session.put(f"{base_path}/policy", json={"policy": policy_document}),
        ):
            _optional("ceph-admin bucket policy delete", lambda: super_admin_session.delete(f"{base_path}/policy", expected_status=(204,)))

        tag_payload = {"tags": [{"key": "suite", "value": "ceph-functional"}]}
        if _optional("ceph-admin bucket tags update", lambda: super_admin_session.put(f"{base_path}/tags", json=tag_payload)):
            _optional("ceph-admin bucket tags delete", lambda: super_admin_session.delete(f"{base_path}/tags", expected_status=(204,)))

        _optional("ceph-admin bucket ACL get", lambda: super_admin_session.get(f"{base_path}/acl"))
        _optional("ceph-admin bucket ACL update", lambda: super_admin_session.put(f"{base_path}/acl", json={"acl": "private"}))

        public_block_payload = {
            "block_public_acls": True,
            "ignore_public_acls": True,
            "block_public_policy": True,
            "restrict_public_buckets": True,
        }
        _optional(
            "ceph-admin bucket public-access-block update",
            lambda: super_admin_session.put(f"{base_path}/public-access-block", json=public_block_payload),
        )

        _optional("ceph-admin bucket object-lock get", lambda: super_admin_session.get(f"{base_path}/object-lock"))
        _optional(
            "ceph-admin bucket object-lock update",
            lambda: super_admin_session.put(f"{base_path}/object-lock", json={"enabled": False}),
        )

        _optional(
            "ceph-admin bucket quota update",
            lambda: super_admin_session.put(f"{base_path}/quota", json={"max_size_gb": 1, "max_objects": 1000}),
        )

        _optional("ceph-admin bucket notifications get", lambda: super_admin_session.get(f"{base_path}/notifications"))
        if _optional(
            "ceph-admin bucket notifications update",
            lambda: super_admin_session.put(f"{base_path}/notifications", json={"configuration": {}}),
        ):
            _optional(
                "ceph-admin bucket notifications delete",
                lambda: super_admin_session.delete(f"{base_path}/notifications", expected_status=(204,)),
            )

        _optional("ceph-admin bucket logging get", lambda: super_admin_session.get(f"{base_path}/logging"))
        if _optional(
            "ceph-admin bucket logging update",
            lambda: super_admin_session.put(
                f"{base_path}/logging",
                json={
                    "enabled": True,
                    "target_bucket": logging_bucket,
                    "target_prefix": "ceph-admin-tests/",
                },
            ),
        ):
            _optional("ceph-admin bucket logging delete", lambda: super_admin_session.delete(f"{base_path}/logging", expected_status=(204,)))

        _optional("ceph-admin bucket website get", lambda: super_admin_session.get(f"{base_path}/website"))
        if _optional(
            "ceph-admin bucket website update",
            lambda: super_admin_session.put(
                f"{base_path}/website",
                json={
                    "index_document": "index.html",
                    "error_document": "error.html",
                },
            ),
        ):
            _optional("ceph-admin bucket website delete", lambda: super_admin_session.delete(f"{base_path}/website", expected_status=(204,)))

        _optional("ceph-admin bucket replication get", lambda: super_admin_session.get(f"{base_path}/replication"))
        replication_payload: dict[str, Any] = {
            "configuration": {
                "Role": "arn:aws:iam::000000000000:role/ceph-admin-functional-replication",
                "Rules": [
                    {
                        "ID": "replicate-all",
                        "Status": "Enabled",
                        "Priority": 1,
                        "Filter": {"Prefix": ""},
                        "DeleteMarkerReplication": {"Status": "Disabled"},
                        "Destination": {"Bucket": f"arn:aws:s3:::{logging_bucket}"},
                    }
                ],
            }
        }
        if _optional(
            "ceph-admin bucket replication update",
            lambda: super_admin_session.put(f"{base_path}/replication", json=replication_payload),
        ):
            _optional(
                "ceph-admin bucket replication delete",
                lambda: super_admin_session.delete(f"{base_path}/replication", expected_status=(204,)),
            )

        _optional("ceph-admin bucket encryption get", lambda: super_admin_session.get(f"{base_path}/encryption"))
        if _optional(
            "ceph-admin bucket encryption update",
            lambda: super_admin_session.put(
                f"{base_path}/encryption",
                json={"rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
            ),
        ):
            _optional(
                "ceph-admin bucket encryption delete",
                lambda: super_admin_session.delete(f"{base_path}/encryption", expected_status=(204,)),
            )

        _optional(
            "ceph-admin bucket compare",
            lambda: super_admin_session.post(
                f"/ceph-admin/endpoints/{endpoint_id}/buckets/compare",
                json={
                    "target_endpoint_id": endpoint_id,
                    "source_bucket": main_bucket,
                    "target_bucket": main_bucket,
                    "include_content": True,
                    "include_config": True,
                    "diff_sample_limit": 20,
                },
            ),
        )
    finally:
        _optional(
            "manager object cleanup",
            lambda: manager_session.post(
                f"/manager/buckets/{main_bucket}/objects/delete",
                params={"account_id": account_id},
                json={"keys": [object_key]},
                expected_status=(200, 404),
            ),
        )
        for bucket_name in (main_bucket, logging_bucket):
            try:
                manager_session.delete(
                    f"/manager/buckets/{bucket_name}",
                    params={"account_id": account_id, "force": "true"},
                    expected_status=(200, 404),
                )
                resource_tracker.discard_bucket(account_id, bucket_name)
            except BackendAPIError:
                pass
