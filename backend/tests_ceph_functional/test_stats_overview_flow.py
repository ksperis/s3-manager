# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

import pytest

from .clients import BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket(prefix: str) -> str:
    return f"{prefix}-stats-{uuid.uuid4().hex[:6]}"


@pytest.mark.ceph_functional
def test_manager_stats_overview_and_traffic(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket(ceph_test_settings.test_prefix)
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

    object_key = f"stats/{uuid.uuid4().hex}.txt"
    manager_session.request(
        "POST",
        f"/manager/buckets/{bucket_name}/objects/upload",
        params={"account_id": account_id},
        data={"prefix": "", "key": object_key},
        files={"file": ("info.txt", b"usage sample", "text/plain")},
        expected_status=201,
    )

    overview = manager_session.get(
        "/manager/stats/overview",
        params={"account_id": account_id},
    )
    assert "total_buckets" in overview
    assert "bucket_overview" in overview

    traffic = manager_session.get(
        "/manager/stats/traffic",
        params={"account_id": account_id, "window": "day"},
        expected_status=(200, 502),
    )
    if isinstance(traffic, dict) and traffic.get("detail"):
        pytest.skip(f"Traffic endpoint unavailable on this cluster: {traffic['detail']}")
    else:
        assert traffic["window"] in {"day", "DAY"}

    manager_session.post(
        f"/manager/buckets/{bucket_name}/objects/delete",
        params={"account_id": account_id},
        json={"keys": [object_key]},
    )
    manager_session.delete(
        f"/manager/buckets/{bucket_name}",
        params={"account_id": account_id, "force": "true"},
    )
    resource_tracker.discard_bucket(account_id, bucket_name)
