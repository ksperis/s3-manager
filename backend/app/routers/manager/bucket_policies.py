# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends

from app.db import S3Account
from app.models.bucket import BucketPolicyInventoryItem
from app.routers.dependencies import get_account_context, get_current_account_admin
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.services.buckets_service import BucketsService, get_buckets_service

router = APIRouter(prefix="/manager/bucket-policies", tags=["manager-bucket-policies"])


@router.get("", response_model=list[BucketPolicyInventoryItem])
def list_bucket_policies(
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> list[BucketPolicyInventoryItem]:
    try:
        buckets = service.list_buckets(account, with_stats=False)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

    inventory: list[BucketPolicyInventoryItem] = []
    for bucket in buckets:
        try:
            inventory.append(
                BucketPolicyInventoryItem(
                    bucket_name=bucket.name,
                    policy=service.get_policy(bucket.name, account),
                )
            )
        except RuntimeError as exc:
            inventory.append(
                BucketPolicyInventoryItem(
                    bucket_name=bucket.name,
                    policy=None,
                    error=str(exc),
                )
            )
    return inventory
