# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import io
import uuid

import pytest

from .clients import BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket_name(prefix: str, label: str = "bucket") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}-{label}"


@pytest.mark.ceph_functional
def test_account_bucket_object_flow(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    provisioned_account,
    resource_tracker: ResourceTracker,
    ceph_verifier,
) -> None:
    """End-to-end smoke test covering account, bucket, and object lifecycles."""

    account_id = provisioned_account.account_id
    manager_session: BackendSession = provisioned_account.manager_session
    manager_user_id = provisioned_account.manager_user_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix)
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

    buckets = manager_session.get("/manager/buckets", params={"account_id": account_id})
    assert any(bucket["name"] == bucket_name for bucket in buckets), "Bucket creation not reflected in listing"

    properties = manager_session.get(
        f"/manager/buckets/{bucket_name}/properties",
        params={"account_id": account_id},
    )
    assert "versioning_status" in properties

    manager_session.put(
        f"/manager/buckets/{bucket_name}/versioning",
        params={"account_id": account_id},
        json={"enabled": True},
    )

    tags_response = manager_session.put(
        f"/manager/buckets/{bucket_name}/tags",
        params={"account_id": account_id},
        json={"tags": [{"key": "env", "value": "functional"}]},
    )
    assert tags_response["tags"][0]["key"] == "env"

    policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "FunctionalAccess",
                "Effect": "Allow",
                "Principal": {"AWS": ["*"]},
                "Action": ["s3:ListBucket"],
                "Resource": [f"arn:aws:s3:::{bucket_name}"],
            }
        ],
    }
    manager_session.put(
        f"/manager/buckets/{bucket_name}/policy",
        params={"account_id": account_id},
        json={"policy": policy_document},
    )
    retrieved_policy = manager_session.get(
        f"/manager/buckets/{bucket_name}/policy",
        params={"account_id": account_id},
    )
    assert retrieved_policy["policy"] == policy_document
    manager_session.delete(
        f"/manager/buckets/{bucket_name}/policy",
        params={"account_id": account_id},
        expected_status=(204,),
    )

    if ceph_verifier and provisioned_account.rgw_account_id:
        tenant = provisioned_account.rgw_account_id
        assert ceph_verifier.bucket_exists(tenant, bucket_name)
        stats = ceph_verifier.account_stats(tenant)
        if stats:
            assert stats.get("account_id") == tenant or stats.get("account") == tenant

    object_key = f"tests/{uuid.uuid4().hex[:12]}.txt"
    object_body = b"Ceph RGW functional test payload"

    upload_response = manager_session.request(
        "POST",
        f"/manager/buckets/{bucket_name}/objects/upload",
        params={"account_id": account_id},
        data={"prefix": "", "key": object_key},
        files={"file": ("payload.txt", io.BytesIO(object_body), "text/plain")},
        expected_status=201,
    ).json()

    assert upload_response["key"] == object_key

    listed_objects = manager_session.get(
        f"/manager/buckets/{bucket_name}/objects",
        params={"account_id": account_id, "prefix": "tests/"},
    )
    assert any(obj["key"] == object_key for obj in listed_objects["objects"]), "Object not found in listing"

    download_info = manager_session.get(
        f"/manager/buckets/{bucket_name}/objects/download",
        params={"account_id": account_id, "key": object_key},
    )
    assert download_info["url"].startswith("http")

    manager_session.post(
        f"/manager/buckets/{bucket_name}/objects/delete",
        params={"account_id": account_id},
        json={"keys": [object_key]},
        expected_status=200,
    )

    delete_response = manager_session.delete(
        f"/manager/buckets/{bucket_name}",
        params={"account_id": account_id, "force": "true"},
    )
    assert delete_response["message"].startswith("Bucket"), "Bucket deletion acknowledgement missing"
    resource_tracker.discard_bucket(account_id, bucket_name)

    super_admin_session.delete(
        f"/admin/users/{manager_user_id}",
        expected_status=(204,),
    )
    resource_tracker.discard_user(manager_user_id)

    super_admin_session.delete(
        f"/admin/accounts/{account_id}",
        params={"delete_rgw": "true"},
        expected_status=(204,),
    )
    resource_tracker.discard_account(account_id)
