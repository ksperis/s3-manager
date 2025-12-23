# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

import pytest

from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}-cfg"


@pytest.mark.ceph_functional
def test_bucket_lifecycle_cors_and_quota(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket_name(ceph_test_settings.test_prefix)
    manager_session.post(
        "/manager/buckets",
        params={"account_id": account_id},
        json={
            "name": bucket_name,
            "versioning": True,
            "block_public_access": False,
        },
        expected_status=201,
    )
    resource_tracker.track_bucket(account_id, bucket_name)

    lifecycle_rules = [
        {
            "ID": "expire-temp",
            "Status": "Enabled",
            "Prefix": "tmp/",
            "Expiration": {"Days": 1},
        }
    ]
    lifecycle_response = manager_session.put(
        f"/manager/buckets/{bucket_name}/lifecycle",
        params={"account_id": account_id},
        json={"rules": lifecycle_rules},
    )
    assert lifecycle_response["rules"], "Lifecycle rules were not applied"

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
        params={"account_id": account_id},
        json={"rules": cors_rules},
    )
    cors_response = manager_session.get(
        f"/manager/buckets/{bucket_name}/cors",
        params={"account_id": account_id},
    )
    assert cors_response["rules"], "CORS rules missing after update"

    quota_payload = {"max_size_gb": 1, "max_objects": 1000}
    try:
        super_admin_session.put(
            f"/manager/buckets/{bucket_name}/quota",
            params={"account_id": account_id},
            json=quota_payload,
        )
    except BackendAPIError as exc:
        manager_session.delete(
            f"/manager/buckets/{bucket_name}",
            params={"account_id": account_id, "force": "true"},
        )
        resource_tracker.discard_bucket(account_id, bucket_name)
        pytest.skip(f"Bucket quota updates unavailable on this cluster: {exc}")

    properties = manager_session.get(
        f"/manager/buckets/{bucket_name}/properties",
        params={"account_id": account_id},
    )
    assert properties["versioning_status"] in {"Enabled", "Suspended"}

    manager_session.delete(
        f"/manager/buckets/{bucket_name}",
        params={"account_id": account_id, "force": "true"},
    )
    resource_tracker.discard_bucket(account_id, bucket_name)
