# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from .ceph_admin_helpers import run_or_skip
from .clients import BackendSession
from .conftest import CephAdminEndpointTestContext


@pytest.mark.ceph_functional
def test_ceph_admin_endpoint_and_cluster_metrics(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
) -> None:
    endpoint_id = ceph_admin_endpoint.endpoint_id

    endpoints = super_admin_session.get("/ceph-admin/endpoints")
    assert isinstance(endpoints, list) and endpoints, "Ceph Admin endpoint list should not be empty"
    assert any(int(item["id"]) == endpoint_id for item in endpoints if item.get("id") is not None)

    access = super_admin_session.get(f"/ceph-admin/endpoints/{endpoint_id}/access")
    assert access["can_admin"] is True

    info = run_or_skip(
        "ceph-admin endpoint info",
        lambda: super_admin_session.get(f"/ceph-admin/endpoints/{endpoint_id}/info"),
    )
    assert "placement_targets" in info
    assert "storage_classes" in info

    if ceph_admin_endpoint.can_metrics:
        storage = run_or_skip(
            "ceph-admin cluster storage metrics",
            lambda: super_admin_session.get(f"/ceph-admin/endpoints/{endpoint_id}/metrics/storage"),
        )
        assert "total_buckets" in storage
        assert "storage_totals" in storage

    traffic = run_or_skip(
        "ceph-admin cluster traffic metrics",
        lambda: super_admin_session.get(
            f"/ceph-admin/endpoints/{endpoint_id}/metrics/traffic",
            params={"window": "day"},
        ),
    )
    assert "window" in traffic
    assert "series" in traffic
