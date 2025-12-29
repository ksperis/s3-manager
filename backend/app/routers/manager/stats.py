# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db_models import S3Account
from app.routers.dependencies import get_account_context, require_usage_capable_manager
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_iam import get_iam_service
from app.services.traffic_service import TrafficService, TrafficWindow
from app.utils.s3_endpoint import resolve_s3_endpoint

router = APIRouter(prefix="/manager/stats", tags=["manager-stats"])


@router.get("/overview")
def account_stats(
    account: S3Account = Depends(get_account_context),
    bucket_service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(require_usage_capable_manager),
) -> dict:
    if not account.rgw_account_id and not account.rgw_user_uid:
        raise HTTPException(status_code=400, detail="Usage metrics not available for this account")
    try:
        buckets = bucket_service.list_buckets(account)
        total_buckets = len(buckets)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch buckets: {exc}") from exc

    caps = getattr(account, "_manager_capabilities", None)
    users = []
    groups = []
    roles = []
    policies = []
    if not caps or caps.can_manage_iam:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise HTTPException(status_code=400, detail="S3Account root keys missing")
        iam = get_iam_service(access_key, secret_key, endpoint=resolve_s3_endpoint(account))
        try:
            users = iam.list_users()
            groups = iam.list_groups()
            roles = iam.list_roles()
            policies = iam.list_policies()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Unable to fetch IAM stats: {exc}") from exc

    total_bytes = sum((bucket.used_bytes or 0) for bucket in buckets if bucket.used_bytes is not None)
    total_objects = sum((bucket.object_count or 0) for bucket in buckets if bucket.object_count is not None)
    bucket_usage = [
        {
            "name": bucket.name,
            "used_bytes": bucket.used_bytes,
            "object_count": bucket.object_count,
        }
        for bucket in buckets
    ]
    bucket_usage.sort(key=lambda bucket: bucket["used_bytes"] or 0, reverse=True)

    non_empty_buckets = [entry for entry in bucket_usage if (entry["used_bytes"] or 0) > 0]
    object_sorted = sorted(bucket_usage, key=lambda entry: entry["object_count"] or 0, reverse=True)
    avg_bucket_size = (
        int(sum((entry["used_bytes"] or 0) for entry in non_empty_buckets) / len(non_empty_buckets))
        if non_empty_buckets
        else None
    )
    object_samples = [entry["object_count"] or 0 for entry in bucket_usage if entry["object_count"] not in (None, 0)]
    avg_object_count = int(sum(object_samples) / len(object_samples)) if object_samples else None
    bucket_overview = {
        "bucket_count": total_buckets,
        "non_empty_buckets": len(non_empty_buckets),
        "empty_buckets": max(total_buckets - len(non_empty_buckets), 0),
        "avg_bucket_size_bytes": avg_bucket_size,
        "avg_objects_per_bucket": avg_object_count,
        "largest_bucket": bucket_usage[0] if bucket_usage else None,
        "most_objects_bucket": object_sorted[0] if object_sorted else None,
    }

    return {
        "total_buckets": total_buckets,
        "total_iam_users": len(users),
        "total_iam_groups": len(groups),
        "total_iam_roles": len(roles),
        "total_iam_policies": len(policies),
        "total_bytes": total_bytes,
        "total_objects": total_objects,
        "bucket_usage": bucket_usage,
        "bucket_overview": bucket_overview,
    }


@router.get("/traffic")
def account_traffic(
    window: TrafficWindow = Query(TrafficWindow.DAY),
    bucket: Optional[str] = Query(None),
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_usage_capable_manager),
) -> dict:
    try:
        service = TrafficService(account)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    try:
        return service.get_traffic(window=window, bucket=bucket)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RGWAdminError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch traffic logs: {exc}") from exc
