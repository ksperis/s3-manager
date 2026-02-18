# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.db import StorageEndpoint
from app.routers.ceph_admin.dependencies import get_ceph_admin_workspace_endpoint
from app.services.rgw_admin import RGWAdminError
from app.services.traffic_service import (
    WINDOW_RESOLUTION_LABELS,
    TrafficWindow,
    aggregate_usage,
    flatten_usage_entries,
    window_start,
)
from app.utils.rgw import extract_bucket_list, get_supervision_rgw_client
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/metrics", tags=["ceph-admin-metrics"])


def _build_supervision_client(endpoint: StorageEndpoint):
    try:
        return get_supervision_rgw_client(endpoint)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _require_storage_metrics_enabled(endpoint: StorageEndpoint) -> None:
    flags = resolve_feature_flags(endpoint)
    if not flags.metrics_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage metrics are disabled for this endpoint",
        )


def _require_usage_logs_enabled(endpoint: StorageEndpoint) -> None:
    flags = resolve_feature_flags(endpoint)
    if not flags.usage_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usage logs are disabled for this endpoint",
        )


def _normalize_owner(entry: dict[str, Any]) -> str:
    owner = entry.get("owner")
    if isinstance(owner, str) and owner.strip():
        return owner.strip()
    tenant = entry.get("tenant")
    if isinstance(tenant, str) and tenant.strip():
        return tenant.strip()
    return "unknown"


@router.get("/storage")
def cluster_storage_metrics(
    endpoint: StorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
) -> dict[str, Any]:
    _require_storage_metrics_enabled(endpoint)
    rgw_admin = _build_supervision_client(endpoint)
    try:
        payload = rgw_admin.get_all_buckets(with_stats=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    bucket_usage: list[dict[str, Any]] = []
    owner_totals: dict[str, dict[str, Any]] = {}
    total_bytes = 0
    total_objects = 0
    has_bytes = False
    has_objects = False

    for entry in extract_bucket_list(payload):
        if not isinstance(entry, dict):
            continue
        name = entry.get("bucket") or entry.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        bucket_name = name.strip()
        used_bytes, object_count = extract_usage_stats(entry.get("usage"))
        bucket_usage.append(
            {
                "name": bucket_name,
                "used_bytes": used_bytes,
                "object_count": object_count,
            }
        )

        owner = _normalize_owner(entry)
        owner_stats = owner_totals.get(owner)
        if owner_stats is None:
            owner_stats = {
                "owner": owner,
                "used_bytes": 0,
                "object_count": 0,
                "bucket_count": 0,
                "_has_bytes": False,
                "_has_objects": False,
            }
            owner_totals[owner] = owner_stats

        owner_stats["bucket_count"] = int(owner_stats["bucket_count"]) + 1
        if used_bytes is not None:
            has_bytes = True
            total_bytes += int(used_bytes)
            owner_stats["used_bytes"] = int(owner_stats["used_bytes"]) + int(used_bytes)
            owner_stats["_has_bytes"] = True
        if object_count is not None:
            has_objects = True
            total_objects += int(object_count)
            owner_stats["object_count"] = int(owner_stats["object_count"]) + int(object_count)
            owner_stats["_has_objects"] = True

    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)

    owner_usage: list[dict[str, Any]] = []
    for owner, stats in owner_totals.items():
        owner_usage.append(
            {
                "owner": owner,
                "used_bytes": stats["used_bytes"] if stats["_has_bytes"] else None,
                "object_count": stats["object_count"] if stats["_has_objects"] else None,
                "bucket_count": stats["bucket_count"],
            }
        )
    owner_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)

    return {
        "total_buckets": len(bucket_usage),
        "bucket_usage": bucket_usage,
        "owner_usage": owner_usage,
        "storage_totals": {
            "used_bytes": total_bytes if has_bytes else None,
            "object_count": total_objects if has_objects else None,
            "bucket_count": len(bucket_usage),
            "owners_with_usage": len(owner_usage),
        },
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


@router.get("/traffic")
def cluster_traffic_metrics(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    endpoint: StorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
) -> dict[str, Any]:
    _require_usage_logs_enabled(endpoint)
    rgw_admin = _build_supervision_client(endpoint)
    reference = datetime.now(timezone.utc).replace(microsecond=0)
    start = window_start(reference, window)
    try:
        payload = rgw_admin.get_usage(
            uid=None,
            tenant=None,
            start=start,
            end=reference,
            show_entries=True,
            show_summary=False,
        )
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    entries = flatten_usage_entries(payload)
    bucket_filter = bucket.strip() if isinstance(bucket, str) else None
    if bucket_filter == "":
        bucket_filter = None
    aggregation = aggregate_usage(entries, start=start, end=reference, window=window, bucket_filter=bucket_filter)
    aggregation.update(
        {
            "window": window.value if isinstance(window, TrafficWindow) else str(window),
            "start": start.isoformat(),
            "end": reference.isoformat(),
            "resolution": WINDOW_RESOLUTION_LABELS.get(window, "per-entry"),
            "bucket_filter": bucket_filter,
        }
    )
    aggregation["data_points"] = len(aggregation.get("series") or [])
    return aggregation
