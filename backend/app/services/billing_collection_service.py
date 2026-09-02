# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.services.data_retention_service import DataRetentionService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.traffic_service import aggregate_usage, flatten_usage_entries
from app.utils.numbers import int_or_zero
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow
from app.utils.usage_stats import extract_usage_stats


logger = logging.getLogger(__name__)
settings = get_settings()


class BillingCollector:
    """Collect and persist daily RGW usage and storage billing inputs."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def collect_daily(self, day: date) -> dict[str, Any]:
        from app.services.app_settings_service import load_app_settings

        app_settings = load_app_settings()
        if not app_settings.general.billing_enabled:
            raise ValueError("Billing is disabled")
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
            .all()
        )
        summary: dict[str, Any] = {
            "day": day.isoformat(),
            "endpoints": 0,
            "usage_records": 0,
            "storage_records": 0,
            "errors": [],
        }
        for endpoint in endpoints:
            flags = resolve_feature_flags(endpoint)
            if not flags.admin_enabled:
                continue
            try:
                rgw_admin = get_supervision_rgw_client(endpoint)
            except Exception as exc:
                logger.warning(
                    "Billing collection skipped for endpoint %s: %s",
                    endpoint.id,
                    exc,
                )
                summary["errors"].append(
                    {"endpoint_id": endpoint.id, "error": str(exc)}
                )
                continue

            summary["endpoints"] += 1
            if flags.usage_enabled:
                usage_records, usage_errors = self._collect_usage_for_endpoint(
                    rgw_admin,
                    endpoint,
                    day,
                )
                summary["usage_records"] += usage_records
                summary["errors"].extend(usage_errors)

            storage_records, storage_errors = self._collect_storage_for_endpoint(
                rgw_admin,
                endpoint,
                day,
            )
            summary["storage_records"] += storage_records
            summary["errors"].extend(storage_errors)
        summary["retention"] = DataRetentionService(self.db).purge_all()
        return summary

    def _collect_usage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
    ) -> tuple[int, list[dict[str, Any]]]:
        start = datetime.combine(day, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )
        end = start + timedelta(days=1)
        accounts = (
            self.db.query(S3Account)
            .filter(S3Account.storage_endpoint_id == endpoint.id)
            .all()
        )
        s3_users = (
            self.db.query(S3User)
            .filter(S3User.storage_endpoint_id == endpoint.id)
            .all()
        )
        created = 0
        errors: list[dict[str, Any]] = []

        for account in accounts:
            try:
                payload = rgw_admin.get_usage(
                    uid=account.rgw_account_id,
                    start=start,
                    end=end,
                    show_entries=True,
                    show_summary=False,
                )
                entries = flatten_usage_entries(payload)
                aggregation = aggregate_usage(entries, start=start, end=end)
                totals = aggregation.get("totals", {})
                breakdown = {
                    entry["category"]: entry["ops"]
                    for entry in aggregation.get("category_breakdown", [])
                    if entry.get("category")
                }
                self._upsert_usage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    s3_user_id=None,
                    bytes_in=int_or_zero(totals.get("bytes_in")),
                    bytes_out=int_or_zero(totals.get("bytes_out")),
                    ops_total=int_or_zero(totals.get("ops")),
                    ops_breakdown=breakdown,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning(
                    "Usage collection failed for account %s: %s",
                    account.id,
                    exc,
                )
                errors.append(
                    {"subject": "account", "subject_id": account.id, "error": str(exc)}
                )
            except Exception as exc:
                logger.exception("Usage collection error for account %s", account.id)
                errors.append(
                    {"subject": "account", "subject_id": account.id, "error": str(exc)}
                )

        for s3_user in s3_users:
            uid = s3_user.rgw_user_uid
            if not uid:
                continue
            try:
                payload = rgw_admin.get_usage(
                    uid=uid,
                    start=start,
                    end=end,
                    show_entries=True,
                    show_summary=False,
                )
                entries = flatten_usage_entries(payload)
                aggregation = aggregate_usage(entries, start=start, end=end)
                totals = aggregation.get("totals", {})
                breakdown = {
                    entry["category"]: entry["ops"]
                    for entry in aggregation.get("category_breakdown", [])
                    if entry.get("category")
                }
                self._upsert_usage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=None,
                    s3_user_id=s3_user.id,
                    bytes_in=int_or_zero(totals.get("bytes_in")),
                    bytes_out=int_or_zero(totals.get("bytes_out")),
                    ops_total=int_or_zero(totals.get("ops")),
                    ops_breakdown=breakdown,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning(
                    "Usage collection failed for s3 user %s: %s",
                    s3_user.id,
                    exc,
                )
                errors.append(
                    {
                        "subject": "s3_user",
                        "subject_id": s3_user.id,
                        "error": str(exc),
                    }
                )
            except Exception as exc:
                logger.exception("Usage collection error for s3 user %s", s3_user.id)
                errors.append(
                    {
                        "subject": "s3_user",
                        "subject_id": s3_user.id,
                        "error": str(exc),
                    }
                )
        return created, errors

    def _collect_storage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
    ) -> tuple[int, list[dict[str, Any]]]:
        accounts = (
            self.db.query(S3Account)
            .filter(S3Account.storage_endpoint_id == endpoint.id)
            .all()
        )
        s3_users = (
            self.db.query(S3User)
            .filter(S3User.storage_endpoint_id == endpoint.id)
            .all()
        )
        created = 0
        errors: list[dict[str, Any]] = []
        for account in accounts:
            try:
                total_bytes, total_objects, by_bucket = self._collect_bucket_stats(
                    rgw_admin,
                    account.rgw_user_uid,
                )
                self._upsert_storage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    s3_user_id=None,
                    total_bytes=total_bytes,
                    total_objects=total_objects,
                    by_bucket=by_bucket,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning(
                    "Storage collection failed for account %s: %s",
                    account.id,
                    exc,
                )
                errors.append(
                    {"subject": "account", "subject_id": account.id, "error": str(exc)}
                )
            except Exception as exc:
                logger.exception("Storage collection error for account %s", account.id)
                errors.append(
                    {"subject": "account", "subject_id": account.id, "error": str(exc)}
                )

        for s3_user in s3_users:
            uid = s3_user.rgw_user_uid
            if not uid:
                continue
            try:
                total_bytes, total_objects, by_bucket = self._collect_bucket_stats(
                    rgw_admin,
                    uid,
                )
                self._upsert_storage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=None,
                    s3_user_id=s3_user.id,
                    total_bytes=total_bytes,
                    total_objects=total_objects,
                    by_bucket=by_bucket,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning(
                    "Storage collection failed for s3 user %s: %s",
                    s3_user.id,
                    exc,
                )
                errors.append(
                    {
                        "subject": "s3_user",
                        "subject_id": s3_user.id,
                        "error": str(exc),
                    }
                )
            except Exception as exc:
                logger.exception("Storage collection error for s3 user %s", s3_user.id)
                errors.append(
                    {
                        "subject": "s3_user",
                        "subject_id": s3_user.id,
                        "error": str(exc),
                    }
                )
        return created, errors

    def _collect_bucket_stats(
        self,
        rgw_admin: RGWAdminClient,
        uid: str,
    ) -> tuple[int, int, Optional[dict[str, dict[str, int]]]]:
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        buckets = extract_bucket_list(payload)
        total_bytes = 0
        total_objects = 0
        by_bucket: dict[str, dict[str, int]] = {}
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            name = bucket.get("bucket") or bucket.get("name")
            if not name:
                continue
            used_bytes, object_count = extract_usage_stats(bucket.get("usage"))
            used_bytes = used_bytes or 0
            object_count = object_count or 0
            total_bytes += used_bytes
            total_objects += object_count
            if settings.billing_store_by_bucket:
                by_bucket[str(name)] = {
                    "used_bytes": int(used_bytes),
                    "object_count": int(object_count),
                }
        return (
            total_bytes,
            total_objects,
            by_bucket if settings.billing_store_by_bucket else None,
        )

    def _upsert_usage(
        self,
        *,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
        bytes_in: int,
        bytes_out: int,
        ops_total: int,
        ops_breakdown: Optional[dict[str, int]],
    ) -> None:
        existing = (
            self.db.query(BillingUsageDaily)
            .filter(
                BillingUsageDaily.day == day,
                BillingUsageDaily.storage_endpoint_id == endpoint_id,
                BillingUsageDaily.s3_account_id == s3_account_id,
                BillingUsageDaily.s3_user_id == s3_user_id,
                BillingUsageDaily.source == "rgw_admin_usage",
            )
            .first()
        )
        payload = json.dumps(ops_breakdown) if ops_breakdown else None
        now = utcnow()
        if existing:
            existing.bytes_in = bytes_in
            existing.bytes_out = bytes_out
            existing.ops_total = ops_total
            existing.ops_breakdown = payload
            existing.collected_at = now
        else:
            row = BillingUsageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                bytes_in=bytes_in,
                bytes_out=bytes_out,
                ops_total=ops_total,
                ops_breakdown=payload,
                source="rgw_admin_usage",
                collected_at=now,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                existing = (
                    self.db.query(BillingUsageDaily)
                    .filter(
                        BillingUsageDaily.day == day,
                        BillingUsageDaily.storage_endpoint_id == endpoint_id,
                        BillingUsageDaily.s3_account_id == s3_account_id,
                        BillingUsageDaily.s3_user_id == s3_user_id,
                        BillingUsageDaily.source == "rgw_admin_usage",
                    )
                    .first()
                )
                if existing is None:
                    raise
                existing.bytes_in = bytes_in
                existing.bytes_out = bytes_out
                existing.ops_total = ops_total
                existing.ops_breakdown = payload
                existing.collected_at = now
        self.db.commit()

    def _upsert_storage(
        self,
        *,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
        total_bytes: int,
        total_objects: int,
        by_bucket: Optional[dict[str, dict[str, int]]],
    ) -> None:
        existing = (
            self.db.query(BillingStorageDaily)
            .filter(
                BillingStorageDaily.day == day,
                BillingStorageDaily.storage_endpoint_id == endpoint_id,
                BillingStorageDaily.s3_account_id == s3_account_id,
                BillingStorageDaily.s3_user_id == s3_user_id,
                BillingStorageDaily.source == "rgw_admin_bucket_stats",
            )
            .first()
        )
        payload = json.dumps(by_bucket) if by_bucket else None
        now = utcnow()
        if existing:
            existing.total_bytes = total_bytes
            existing.total_objects = total_objects
            existing.by_bucket = payload
            existing.collected_at = now
        else:
            row = BillingStorageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                total_bytes=total_bytes,
                total_objects=total_objects,
                by_bucket=payload,
                source="rgw_admin_bucket_stats",
                collected_at=now,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                existing = (
                    self.db.query(BillingStorageDaily)
                    .filter(
                        BillingStorageDaily.day == day,
                        BillingStorageDaily.storage_endpoint_id == endpoint_id,
                        BillingStorageDaily.s3_account_id == s3_account_id,
                        BillingStorageDaily.s3_user_id == s3_user_id,
                        BillingStorageDaily.source == "rgw_admin_bucket_stats",
                    )
                    .first()
                )
                if existing is None:
                    raise
                existing.total_bytes = total_bytes
                existing.total_objects = total_objects
                existing.by_bucket = payload
                existing.collected_at = now
        self.db.commit()
