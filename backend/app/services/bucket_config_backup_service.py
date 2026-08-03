# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from app.services.s3_execution_context import S3ExecutionTarget
from app.models.bucket_config_backup import (
    BucketConfigBackupBucket,
    BucketConfigBackupFeature,
    BucketConfigBackupResponse,
    BucketConfigBackupSource,
)
from app.services.buckets_service import BucketsService
from app.utils.jsonable import model_to_jsonable

QuotaSnapshotLoader = Callable[[str], dict[str, int | None]]


class BucketConfigBackupService:
    def __init__(self, buckets_service: BucketsService | None = None) -> None:
        self._buckets = buckets_service or BucketsService()

    def build_backup(
        self,
        *,
        account: S3ExecutionTarget,
        bucket_names: list[str],
        features: list[BucketConfigBackupFeature],
        source: BucketConfigBackupSource,
        quota_loader: QuotaSnapshotLoader | None = None,
    ) -> BucketConfigBackupResponse:
        selected_features = list(dict.fromkeys(features))
        return BucketConfigBackupResponse(
            generated_at=datetime.now(timezone.utc),
            source=source,
            features=selected_features,
            buckets=[
                self._build_bucket_backup(
                    account=account,
                    bucket_name=bucket_name,
                    features=selected_features,
                    quota_loader=quota_loader,
                )
                for bucket_name in bucket_names
            ],
        )

    def _build_bucket_backup(
        self,
        *,
        account: S3ExecutionTarget,
        bucket_name: str,
        features: list[BucketConfigBackupFeature],
        quota_loader: QuotaSnapshotLoader | None,
    ) -> BucketConfigBackupBucket:
        configuration: dict[str, Any] = {}
        errors: dict[str, str] = {}

        for feature in features:
            try:
                configuration[feature] = self._load_feature(account, bucket_name, feature, quota_loader)
            except Exception as exc:  # noqa: BLE001 - backup files should carry per-feature failures.
                errors[feature] = str(exc)

        return BucketConfigBackupBucket(name=bucket_name, configuration=configuration, errors=errors)

    def _load_feature(
        self,
        account: S3ExecutionTarget,
        bucket_name: str,
        feature: BucketConfigBackupFeature,
        quota_loader: QuotaSnapshotLoader | None,
    ) -> Any:
        if feature == "quota":
            return self._load_quota(account, bucket_name, quota_loader)
        if feature == "versioning":
            status_value = self._buckets.get_bucket_versioning_status(bucket_name, account)
            return {"status": status_value, "enabled": status_value == "Enabled"}
        if feature == "object_lock":
            return model_to_jsonable(self._buckets.get_object_lock(bucket_name, account))
        if feature == "public_access_block":
            return model_to_jsonable(self._buckets.get_public_access_block(bucket_name, account))
        if feature == "lifecycle":
            lifecycle = self._buckets.get_lifecycle(bucket_name, account)
            return {"rules": lifecycle.rules or []}
        if feature == "cors":
            return {"rules": self._buckets.get_bucket_cors(bucket_name, account) or []}
        if feature == "policy":
            return {"policy": self._buckets.get_policy(bucket_name, account)}
        if feature == "access_logging":
            return model_to_jsonable(self._buckets.get_bucket_logging(bucket_name, account))
        if feature == "tags":
            tags = self._buckets.get_bucket_tags(bucket_name, account)
            return {"tags": [model_to_jsonable(tag) for tag in tags]}
        raise ValueError(f"Unsupported backup feature: {feature}")

    def _load_quota(
        self,
        account: S3ExecutionTarget,
        bucket_name: str,
        quota_loader: QuotaSnapshotLoader | None,
    ) -> dict[str, int | None]:
        if quota_loader is not None:
            snapshot = quota_loader(bucket_name)
            return {
                "max_size_bytes": _normalize_quota_limit(snapshot.get("max_size_bytes")),
                "max_objects": _normalize_quota_limit(snapshot.get("max_objects")),
            }

        stats = self._buckets.get_bucket_stats(bucket_name, account, with_stats=True)
        return {
            "max_size_bytes": _normalize_quota_limit(getattr(stats, "quota_max_size_bytes", None)),
            "max_objects": _normalize_quota_limit(getattr(stats, "quota_max_objects", None)),
        }


def _normalize_quota_limit(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def quota_from_bucket_summary(bucket: Any | None) -> dict[str, int | None]:
    return {
        "max_size_bytes": _normalize_quota_limit(getattr(bucket, "quota_max_size_bytes", None)),
        "max_objects": _normalize_quota_limit(getattr(bucket, "quota_max_objects", None)),
    }
