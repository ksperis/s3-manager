# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import metrics as metrics_router
from app.services.traffic_service import TrafficWindow


class FakeRGWAdmin:
    def __init__(self, *, buckets_payload=None, usage_payload=None):
        self._buckets_payload = buckets_payload or {"buckets": []}
        self._usage_payload = usage_payload or {"entries": []}

    def get_all_buckets(self, with_stats: bool = True):
        return self._buckets_payload

    def get_usage(
        self,
        uid=None,
        tenant=None,
        start=None,
        end=None,
        show_entries: bool = True,
        show_summary: bool = False,
    ):
        return self._usage_payload


def _build_endpoint(*, usage_enabled: bool = True, metrics_enabled: bool = True):
    features_yaml = (
        "features:\n"
        "  usage:\n"
        f"    enabled: {'true' if usage_enabled else 'false'}\n"
        "  metrics:\n"
        f"    enabled: {'true' if metrics_enabled else 'false'}\n"
    )
    endpoint = SimpleNamespace(provider="ceph", features_config=features_yaml)
    return endpoint


def test_ceph_admin_cluster_storage_aggregates_bucket_and_owner_usage(monkeypatch: pytest.MonkeyPatch):
    buckets_payload = {
        "buckets": [
            {"bucket": "alpha", "owner": "tenant-a$user-a", "usage": {"total_bytes": 2048, "total_objects": 12}},
            {"bucket": "beta", "owner": "tenant-a$user-a", "usage": {"total_bytes": 1024, "total_objects": 3}},
            {"bucket": "gamma", "owner": "tenant-b$user-b", "usage": {"total_bytes": 4096, "total_objects": 9}},
        ]
    }

    fake_admin = FakeRGWAdmin(buckets_payload=buckets_payload)
    monkeypatch.setattr(metrics_router, "get_supervision_rgw_client", lambda endpoint: fake_admin)

    payload = metrics_router.cluster_storage_metrics(endpoint=_build_endpoint())

    assert payload["total_buckets"] == 3
    assert payload["storage_totals"]["bucket_count"] == 3
    assert payload["storage_totals"]["owners_with_usage"] == 2
    assert payload["storage_totals"]["used_bytes"] == 7168
    assert payload["storage_totals"]["object_count"] == 24
    assert payload["owner_usage"][0]["owner"] == "tenant-b$user-b"
    assert payload["owner_usage"][0]["bucket_count"] == 1
    assert payload["owner_usage"][0]["used_bytes"] == 4096
    assert payload["bucket_usage"][0]["name"] == "gamma"


def test_ceph_admin_cluster_traffic_aggregates_usage_entries(monkeypatch: pytest.MonkeyPatch):
    now = datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
    usage_payload = {
        "entries": [
            {
                "user": "owner-a",
                "bucket": "alpha",
                "time": now,
                "categories": [{"category": "get_obj", "bytes_sent": 100, "bytes_received": 20, "ops": 3, "successful_ops": 3}],
            },
            {
                "user": "owner-b",
                "bucket": "beta",
                "time": now,
                "categories": [{"category": "put_obj", "bytes_sent": 40, "bytes_received": 60, "ops": 2, "successful_ops": 1}],
            },
        ]
    }

    fake_admin = FakeRGWAdmin(usage_payload=usage_payload)
    monkeypatch.setattr(metrics_router, "get_supervision_rgw_client", lambda endpoint: fake_admin)

    payload = metrics_router.cluster_traffic_metrics(window=TrafficWindow.DAY, endpoint=_build_endpoint())

    assert payload["window"] == "day"
    assert payload["totals"]["bytes_out"] == 140
    assert payload["totals"]["bytes_in"] == 80
    assert payload["totals"]["ops"] == 5
    assert payload["totals"]["success_ops"] == 4
    assert payload["data_points"] >= 1


def test_ceph_admin_cluster_storage_requires_usage_feature():
    with pytest.raises(HTTPException) as exc:
        metrics_router.cluster_storage_metrics(endpoint=_build_endpoint(usage_enabled=False, metrics_enabled=True))
    assert exc.value.status_code == 403
