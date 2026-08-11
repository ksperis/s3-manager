# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Query

from app.db import User
from app.models.access_context import ManagerActor
from app.models.bucket import FeatureRuleInventoryBucket, FeatureRuleInventoryFeature
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    require_manager_feature_rules_enabled,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.feature_rule_inventory_service import FeatureRuleInventoryService
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter(prefix="/manager/feature-rules", tags=["manager-feature-rules"])


@router.get("", response_model=list[FeatureRuleInventoryBucket])
def list_feature_rule_inventory(
    feature: FeatureRuleInventoryFeature = Query(..., description="Bucket feature to inventory."),
    account: S3ExecutionContext = Depends(get_account_context),
    buckets_service: BucketsService = Depends(get_buckets_service),
    _tool_user: User = Depends(require_manager_feature_rules_enabled),
    _: ManagerActor = Depends(get_current_account_admin),
) -> list[FeatureRuleInventoryBucket]:
    try:
        return FeatureRuleInventoryService(buckets_service).list_inventory(feature, account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
