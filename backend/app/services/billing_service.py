# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

import csv
import io
import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.models.billing import (
    BillingCost,
    BillingCoverage,
    BillingDailySeriesPoint,
    BillingStorageTotals,
    BillingSubjectDetail,
    BillingSubjectSummary,
    BillingSubjectsResponse,
    BillingSummary,
    BillingUsageTotals,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.traffic_service import aggregate_usage, flatten_usage_entries
from app.utils.rgw import extract_bucket_list, resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats
from app.utils.rgw import get_supervision_rgw_client

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class BillingPeriod:
    month: str
    start: date
    end: date
    days_in_month: int


@dataclass
class BillingTotals:
    bytes_in: int
    bytes_out: int
    ops_total: int
    ops_breakdown: Optional[dict[str, int]]
    avg_storage_bytes: Optional[int]
    avg_storage_gb_month: Optional[float]
    total_objects: Optional[int]
    days_with_data: int


def _parse_month(value: str) -> BillingPeriod:
    text = (value or "").strip()
    try:
        period_start = datetime.strptime(text, "%Y-%m").date()
    except ValueError as exc:
        raise ValueError("Invalid month format, expected YYYY-MM") from exc
    year = period_start.year
    month = period_start.month
    if month == 12:
        period_end = date(year + 1, 1, 1)
    else:
        period_end = date(year, month + 1, 1)
    days_in_month = (period_end - period_start).days
    return BillingPeriod(month=text, start=period_start, end=period_end, days_in_month=days_in_month)


def _coverage(days_collected: int, days_in_month: int) -> BillingCoverage:
    ratio = days_collected / days_in_month if days_in_month else 0
    return BillingCoverage(days_collected=days_collected, days_in_month=days_in_month, coverage_ratio=ratio)


def _bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    return float(value) / (1024 ** 3)


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _merge_ops_breakdown(rows: Iterable[BillingUsageDaily]) -> dict[str, int]:
    merged: dict[str, int] = defaultdict(int)
    for row in rows:
        if not row.ops_breakdown:
            continue
        try:
            data = json.loads(row.ops_breakdown)
        except (TypeError, ValueError):
            continue
        if isinstance(data, dict):
            for key, value in data.items():
                merged[str(key)] += _safe_int(value)
    return dict(merged)




def _compute_cost(rate_card: Optional[BillingRateCard], totals: BillingTotals) -> Optional[BillingCost]:
    if not rate_card:
        return None
    storage_gb_month = totals.avg_storage_gb_month
    egress_gb = _bytes_to_gb(totals.bytes_out)
    ingress_gb = _bytes_to_gb(totals.bytes_in)
    requests_k = totals.ops_total / 1000

    storage_cost = None
    if rate_card.storage_gb_month_price is not None and storage_gb_month is not None:
        storage_cost = float(rate_card.storage_gb_month_price) * storage_gb_month
    egress_cost = None
    if rate_card.egress_gb_price is not None and egress_gb is not None:
        egress_cost = float(rate_card.egress_gb_price) * egress_gb
    ingress_cost = None
    if rate_card.ingress_gb_price is not None and ingress_gb is not None:
        ingress_cost = float(rate_card.ingress_gb_price) * ingress_gb
    requests_cost = None
    if rate_card.requests_per_1000_price is not None:
        requests_cost = float(rate_card.requests_per_1000_price) * requests_k

    components = [storage_cost, egress_cost, ingress_cost, requests_cost]
    has_component = any(value is not None for value in components)
    total_cost = sum(value for value in components if value is not None) if has_component else None

    return BillingCost(
        currency=rate_card.currency,
        storage_cost=storage_cost,
        egress_cost=egress_cost,
        ingress_cost=ingress_cost,
        requests_cost=requests_cost,
        total_cost=total_cost,
        rate_card_name=rate_card.name,
    )


def _resolve_rate_card(
    db: Session,
    endpoint_id: Optional[int],
    period: BillingPeriod,
    subject_type: Optional[str] = None,
    subject_id: Optional[int] = None,
) -> Optional[BillingRateCard]:
    if endpoint_id is None:
        return None
    if subject_type and subject_id:
        assignment_query = db.query(BillingAssignment).filter(BillingAssignment.storage_endpoint_id == endpoint_id)
        if subject_type == "account":
            assignment_query = assignment_query.filter(BillingAssignment.s3_account_id == subject_id)
        elif subject_type == "s3_user":
            assignment_query = assignment_query.filter(BillingAssignment.s3_user_id == subject_id)
        assignment = assignment_query.order_by(BillingAssignment.created_at.desc()).first()
        if assignment:
            return assignment.rate_card

    name = settings.billing_default_rate_card_name
    candidates = db.query(BillingRateCard)
    if name:
        candidates = candidates.filter(BillingRateCard.name == name)
    candidates = candidates.filter(
        BillingRateCard.effective_from <= period.end,
        (BillingRateCard.effective_to.is_(None)) | (BillingRateCard.effective_to >= period.start),
    )
    endpoint_specific = candidates.filter(BillingRateCard.storage_endpoint_id == endpoint_id).order_by(
        BillingRateCard.effective_from.desc()
    )
    rate_card = endpoint_specific.first()
    if rate_card:
        return rate_card
    global_default = candidates.filter(BillingRateCard.storage_endpoint_id.is_(None)).order_by(
        BillingRateCard.effective_from.desc()
    )
    return global_default.first()


class BillingCollector:
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
                logger.warning("Billing collection skipped for endpoint %s: %s", endpoint.id, exc)
                summary["errors"].append({"endpoint_id": endpoint.id, "error": str(exc)})
                continue

            summary["endpoints"] += 1
            # Usage billing relies on RGW usage logs (traffic), gated by the usage feature.
            usage_enabled = bool(flags.usage_enabled)
            usage_records, usage_errors = (0, [])
            if usage_enabled:
                usage_records, usage_errors = self._collect_usage_for_endpoint(rgw_admin, endpoint, day)
                summary["usage_records"] += usage_records
                summary["errors"].extend(usage_errors)

            storage_records, storage_errors = self._collect_storage_for_endpoint(rgw_admin, endpoint, day)
            summary["storage_records"] += storage_records
            summary["errors"].extend(storage_errors)
        return summary

    def _collect_usage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
    ) -> tuple[int, list[dict[str, Any]]]:
        start = datetime.combine(day, datetime.min.time()).replace(tzinfo=timezone.utc)
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

        for acc in accounts:
            # RGW usage logs for accounts are keyed by account-id (not the -admin root uid).
            uid = acc.rgw_account_id or acc.rgw_user_uid
            if not uid:
                continue
            try:
                payload = rgw_admin.get_usage(uid=uid, start=start, end=end, show_entries=True, show_summary=False)
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
                    s3_account_id=acc.id,
                    s3_user_id=None,
                    bytes_in=_safe_int(totals.get("bytes_in")),
                    bytes_out=_safe_int(totals.get("bytes_out")),
                    ops_total=_safe_int(totals.get("ops")),
                    ops_breakdown=breakdown,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning("Usage collection failed for account %s: %s", acc.id, exc)
                errors.append({"subject": "account", "subject_id": acc.id, "error": str(exc)})
            except Exception as exc:
                logger.exception("Usage collection error for account %s", acc.id)
                errors.append({"subject": "account", "subject_id": acc.id, "error": str(exc)})

        for user in s3_users:
            uid = user.rgw_user_uid
            if not uid:
                continue
            try:
                payload = rgw_admin.get_usage(uid=uid, start=start, end=end, show_entries=True, show_summary=False)
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
                    s3_user_id=user.id,
                    bytes_in=_safe_int(totals.get("bytes_in")),
                    bytes_out=_safe_int(totals.get("bytes_out")),
                    ops_total=_safe_int(totals.get("ops")),
                    ops_breakdown=breakdown,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning("Usage collection failed for s3 user %s: %s", user.id, exc)
                errors.append({"subject": "s3_user", "subject_id": user.id, "error": str(exc)})
            except Exception as exc:
                logger.exception("Usage collection error for s3 user %s", user.id)
                errors.append({"subject": "s3_user", "subject_id": user.id, "error": str(exc)})
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
        for acc in accounts:
            uid = resolve_admin_uid(acc.rgw_account_id, acc.rgw_user_uid)
            if not uid:
                continue
            try:
                total_bytes, total_objects, by_bucket = self._collect_bucket_stats(rgw_admin, uid)
                self._upsert_storage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=acc.id,
                    s3_user_id=None,
                    total_bytes=total_bytes,
                    total_objects=total_objects,
                    by_bucket=by_bucket,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning("Storage collection failed for account %s: %s", acc.id, exc)
                errors.append({"subject": "account", "subject_id": acc.id, "error": str(exc)})
            except Exception as exc:
                logger.exception("Storage collection error for account %s", acc.id)
                errors.append({"subject": "account", "subject_id": acc.id, "error": str(exc)})

        for user in s3_users:
            uid = user.rgw_user_uid
            if not uid:
                continue
            try:
                total_bytes, total_objects, by_bucket = self._collect_bucket_stats(rgw_admin, uid)
                self._upsert_storage(
                    day=day,
                    endpoint_id=endpoint.id,
                    s3_account_id=None,
                    s3_user_id=user.id,
                    total_bytes=total_bytes,
                    total_objects=total_objects,
                    by_bucket=by_bucket,
                )
                created += 1
            except RGWAdminError as exc:
                logger.warning("Storage collection failed for s3 user %s: %s", user.id, exc)
                errors.append({"subject": "s3_user", "subject_id": user.id, "error": str(exc)})
            except Exception as exc:
                logger.exception("Storage collection error for s3 user %s", user.id)
                errors.append({"subject": "s3_user", "subject_id": user.id, "error": str(exc)})
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
        return total_bytes, total_objects, (by_bucket if settings.billing_store_by_bucket else None)

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
            self.db.add(
                BillingUsageDaily(
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
            )
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
            self.db.add(
                BillingStorageDaily(
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
            )
        self.db.commit()


class BillingService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def summary(self, month: str, endpoint_id: Optional[int]) -> BillingSummary:
        period = _parse_month(month)
        totals = self._aggregate_totals(period, endpoint_id=endpoint_id)
        rate_card = _resolve_rate_card(self.db, endpoint_id, period)
        cost = _compute_cost(rate_card, totals)
        return BillingSummary(
            month=period.month,
            storage_endpoint_id=endpoint_id,
            usage=BillingUsageTotals(
                bytes_in=totals.bytes_in,
                bytes_out=totals.bytes_out,
                ops_total=totals.ops_total,
                ops_breakdown=totals.ops_breakdown,
            ),
            storage=BillingStorageTotals(
                avg_bytes=totals.avg_storage_bytes,
                avg_gb_month=totals.avg_storage_gb_month,
                total_objects=totals.total_objects,
            ),
            coverage=_coverage(totals.days_with_data, period.days_in_month),
            cost=cost,
        )

    def list_subjects(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        page: int,
        page_size: int,
        sort_by: str,
        sort_dir: str,
    ) -> BillingSubjectsResponse:
        period = _parse_month(month)
        subject_type = subject_type.lower().strip()
        if subject_type not in {"account", "s3_user"}:
            raise ValueError("Invalid subject type")
        subjects = self._load_subjects(endpoint_id, subject_type)
        usage_totals = self._usage_totals_by_subject(period, endpoint_id, subject_type)
        storage_totals = self._storage_totals_by_subject(period, endpoint_id, subject_type)

        items: list[BillingSubjectSummary] = []
        for subject in subjects:
            subject_id = subject.id
            usage = usage_totals.get(subject_id, (0, 0, 0))
            storage = storage_totals.get(subject_id, (None, None, None))
            totals = BillingTotals(
                bytes_in=usage[0],
                bytes_out=usage[1],
                ops_total=usage[2],
                ops_breakdown=None,
                avg_storage_bytes=storage[0],
                avg_storage_gb_month=_bytes_to_gb(storage[0]) if storage[0] is not None else None,
                total_objects=storage[1],
                days_with_data=storage[2] or 0,
            )
            cost = _compute_cost(_resolve_rate_card(self.db, endpoint_id, period, subject_type, subject_id), totals)
            items.append(
                BillingSubjectSummary(
                    subject_type=subject_type,
                    subject_id=subject_id,
                    name=subject.name,
                    rgw_identifier=getattr(subject, "rgw_user_uid", None) or getattr(subject, "rgw_account_id", None),
                    storage=BillingStorageTotals(
                        avg_bytes=totals.avg_storage_bytes,
                        avg_gb_month=totals.avg_storage_gb_month,
                        total_objects=totals.total_objects,
                    ),
                    usage=BillingUsageTotals(bytes_in=usage[0], bytes_out=usage[1], ops_total=usage[2]),
                    cost=cost,
                )
            )

        def sort_key(entry: BillingSubjectSummary):
            if sort_by == "cost":
                return entry.cost.total_cost if entry.cost and entry.cost.total_cost is not None else -1
            if sort_by == "egress":
                return entry.usage.bytes_out
            if sort_by == "storage":
                return entry.storage.avg_bytes or 0
            if sort_by == "requests":
                return entry.usage.ops_total
            return entry.name.lower()

        items.sort(key=sort_key, reverse=sort_dir == "desc")
        total = len(items)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        sliced = items[start:end]
        has_next = end < total
        return BillingSubjectsResponse(
            items=sliced,
            total=total,
            page=page,
            page_size=page_size,
            has_next=has_next,
        )

    def subject_detail(self, month: str, endpoint_id: int, subject_type: str, subject_id: int) -> BillingSubjectDetail:
        period = _parse_month(month)
        subject_type = subject_type.lower().strip()
        if subject_type == "account":
            subject = (
                self.db.query(S3Account)
                .filter(S3Account.id == subject_id, S3Account.storage_endpoint_id == endpoint_id)
                .first()
            )
        elif subject_type == "s3_user":
            subject = (
                self.db.query(S3User)
                .filter(S3User.id == subject_id, S3User.storage_endpoint_id == endpoint_id)
                .first()
            )
        else:
            raise ValueError("Invalid subject type")
        if not subject:
            raise ValueError("Subject not found")

        usage_rows = self._usage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        storage_rows = self._storage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        usage_totals = BillingUsageTotals(
            bytes_in=sum(row.bytes_in for row in usage_rows),
            bytes_out=sum(row.bytes_out for row in usage_rows),
            ops_total=sum(row.ops_total for row in usage_rows),
            ops_breakdown=_merge_ops_breakdown(usage_rows) if usage_rows else None,
        )
        total_storage_bytes = sum(row.total_bytes for row in storage_rows)
        days_with_storage = len(storage_rows)
        avg_storage_bytes = int(total_storage_bytes / days_with_storage) if days_with_storage else None
        storage_totals = BillingStorageTotals(
            avg_bytes=avg_storage_bytes,
            avg_gb_month=_bytes_to_gb(avg_storage_bytes) if avg_storage_bytes is not None else None,
            total_objects=(sum(row.total_objects for row in storage_rows) if storage_rows else None),
        )

        daily_map: dict[str, BillingDailySeriesPoint] = {}
        for row in storage_rows:
            key = row.day.isoformat()
            daily_map[key] = BillingDailySeriesPoint(day=key, storage_bytes=row.total_bytes)
        for row in usage_rows:
            key = row.day.isoformat()
            entry = daily_map.get(key) or BillingDailySeriesPoint(day=key)
            entry.bytes_in = row.bytes_in
            entry.bytes_out = row.bytes_out
            entry.ops_total = row.ops_total
            daily_map[key] = entry

        daily = sorted(daily_map.values(), key=lambda entry: entry.day)
        coverage_days = days_with_storage or len(usage_rows)
        totals = BillingTotals(
            bytes_in=usage_totals.bytes_in,
            bytes_out=usage_totals.bytes_out,
            ops_total=usage_totals.ops_total,
            ops_breakdown=usage_totals.ops_breakdown,
            avg_storage_bytes=storage_totals.avg_bytes,
            avg_storage_gb_month=storage_totals.avg_gb_month,
            total_objects=storage_totals.total_objects,
            days_with_data=coverage_days,
        )
        cost = _compute_cost(_resolve_rate_card(self.db, endpoint_id, period, subject_type, subject_id), totals)

        return BillingSubjectDetail(
            month=period.month,
            subject_type=subject_type,
            subject_id=subject_id,
            name=subject.name,
            rgw_identifier=getattr(subject, "rgw_user_uid", None) or getattr(subject, "rgw_account_id", None),
            daily=daily,
            usage=usage_totals,
            storage=storage_totals,
            coverage=_coverage(coverage_days, period.days_in_month),
            cost=cost,
        )

    def export_csv(self, month: str, endpoint_id: int) -> tuple[str, str]:
        period = _parse_month(month)
        rows: list[BillingSubjectSummary] = []
        for subject_type in ("account", "s3_user"):
            subjects = self._load_subjects(endpoint_id, subject_type)
            usage_totals = self._usage_totals_by_subject(period, endpoint_id, subject_type)
            storage_totals = self._storage_totals_by_subject(period, endpoint_id, subject_type)
            for subject in subjects:
                subject_id = subject.id
                usage = usage_totals.get(subject_id, (0, 0, 0))
                storage = storage_totals.get(subject_id, (None, None, None))
                totals = BillingTotals(
                    bytes_in=usage[0],
                    bytes_out=usage[1],
                    ops_total=usage[2],
                    ops_breakdown=None,
                    avg_storage_bytes=storage[0],
                    avg_storage_gb_month=_bytes_to_gb(storage[0]) if storage[0] is not None else None,
                    total_objects=storage[1],
                    days_with_data=storage[2] or 0,
                )
                cost = _compute_cost(
                    _resolve_rate_card(self.db, endpoint_id, period, subject_type, subject_id),
                    totals,
                )
                rows.append(
                    BillingSubjectSummary(
                        subject_type=subject_type,
                        subject_id=subject_id,
                        name=subject.name,
                        rgw_identifier=getattr(subject, "rgw_user_uid", None) or getattr(subject, "rgw_account_id", None),
                        storage=BillingStorageTotals(
                            avg_bytes=totals.avg_storage_bytes,
                            avg_gb_month=totals.avg_storage_gb_month,
                            total_objects=totals.total_objects,
                        ),
                        usage=BillingUsageTotals(bytes_in=usage[0], bytes_out=usage[1], ops_total=usage[2]),
                        cost=cost,
                    )
                )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "subject_type",
                "subject_id",
                "name",
                "rgw_identifier",
                "avg_storage_gb_month",
                "egress_gb",
                "ingress_gb",
                "requests_k",
                "total_cost",
                "currency",
            ]
        )
        for item in rows:
            writer.writerow(
                [
                    item.subject_type,
                    item.subject_id,
                    item.name,
                    item.rgw_identifier or "",
                    f"{item.storage.avg_gb_month:.6f}" if item.storage.avg_gb_month is not None else "",
                    f"{_bytes_to_gb(item.usage.bytes_out):.6f}" if item.usage.bytes_out is not None else "",
                    f"{_bytes_to_gb(item.usage.bytes_in):.6f}" if item.usage.bytes_in is not None else "",
                    f"{item.usage.ops_total / 1000:.6f}" if item.usage.ops_total is not None else "",
                    f"{item.cost.total_cost:.6f}" if item.cost and item.cost.total_cost is not None else "",
                    item.cost.currency if item.cost and item.cost.currency else "",
                ]
            )
        filename = f"billing-{period.month}-endpoint-{endpoint_id}.csv"
        return filename, output.getvalue()

    def _load_subjects(self, endpoint_id: int, subject_type: str) -> list[Any]:
        if subject_type == "account":
            return (
                self.db.query(S3Account)
                .filter(S3Account.storage_endpoint_id == endpoint_id)
                .order_by(S3Account.name.asc())
                .all()
            )
        return (
            self.db.query(S3User)
            .filter(S3User.storage_endpoint_id == endpoint_id)
            .order_by(S3User.name.asc())
            .all()
        )

    def _aggregate_totals(self, period: BillingPeriod, endpoint_id: Optional[int]) -> BillingTotals:
        usage_query = self.db.query(
            func.sum(BillingUsageDaily.bytes_in),
            func.sum(BillingUsageDaily.bytes_out),
            func.sum(BillingUsageDaily.ops_total),
        ).filter(
            BillingUsageDaily.day >= period.start,
            BillingUsageDaily.day < period.end,
        )
        if endpoint_id is not None:
            usage_query = usage_query.filter(BillingUsageDaily.storage_endpoint_id == endpoint_id)
        usage_row = usage_query.first()
        bytes_in = int(usage_row[0] or 0)
        bytes_out = int(usage_row[1] or 0)
        ops_total = int(usage_row[2] or 0)

        storage_query = self.db.query(
            func.sum(BillingStorageDaily.total_bytes),
            func.sum(BillingStorageDaily.total_objects),
            func.count(func.distinct(BillingStorageDaily.day)),
        ).filter(
            BillingStorageDaily.day >= period.start,
            BillingStorageDaily.day < period.end,
        )
        if endpoint_id is not None:
            storage_query = storage_query.filter(BillingStorageDaily.storage_endpoint_id == endpoint_id)
        storage_row = storage_query.first()
        total_bytes = storage_row[0] or 0
        total_objects = storage_row[1]
        days_with_storage = int(storage_row[2] or 0)
        avg_storage_bytes = int(total_bytes / days_with_storage) if days_with_storage else None

        return BillingTotals(
            bytes_in=bytes_in,
            bytes_out=bytes_out,
            ops_total=ops_total,
            ops_breakdown=None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=_bytes_to_gb(avg_storage_bytes) if avg_storage_bytes is not None else None,
            total_objects=int(total_objects) if total_objects is not None else None,
            days_with_data=days_with_storage,
        )

    def _usage_totals_by_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[int, int, int]]:
        column = BillingUsageDaily.s3_account_id if subject_type == "account" else BillingUsageDaily.s3_user_id
        rows = (
            self.db.query(
                column,
                func.sum(BillingUsageDaily.bytes_in),
                func.sum(BillingUsageDaily.bytes_out),
                func.sum(BillingUsageDaily.ops_total),
            )
            .filter(
                BillingUsageDaily.storage_endpoint_id == endpoint_id,
                BillingUsageDaily.day >= period.start,
                BillingUsageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
            .all()
        )
        return {row[0]: (int(row[1] or 0), int(row[2] or 0), int(row[3] or 0)) for row in rows if row[0] is not None}

    def _storage_totals_by_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[Optional[int], Optional[int], int]]:
        column = BillingStorageDaily.s3_account_id if subject_type == "account" else BillingStorageDaily.s3_user_id
        rows = (
            self.db.query(
                column,
                func.sum(BillingStorageDaily.total_bytes),
                func.sum(BillingStorageDaily.total_objects),
                func.count(func.distinct(BillingStorageDaily.day)),
            )
            .filter(
                BillingStorageDaily.storage_endpoint_id == endpoint_id,
                BillingStorageDaily.day >= period.start,
                BillingStorageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
            .all()
        )
        results: dict[int, tuple[Optional[int], Optional[int], int]] = {}
        for row in rows:
            subject_id = row[0]
            if subject_id is None:
                continue
            total_bytes = row[1]
            total_objects = row[2]
            days = int(row[3] or 0)
            avg_bytes = int(total_bytes / days) if (total_bytes is not None and days) else None
            results[subject_id] = (
                avg_bytes,
                int(total_objects) if total_objects is not None else None,
                days,
            )
        return results

    def _usage_rows_for_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[BillingUsageDaily]:
        column = BillingUsageDaily.s3_account_id if subject_type == "account" else BillingUsageDaily.s3_user_id
        return (
            self.db.query(BillingUsageDaily)
            .filter(
                BillingUsageDaily.storage_endpoint_id == endpoint_id,
                BillingUsageDaily.day >= period.start,
                BillingUsageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(BillingUsageDaily.day.asc())
            .all()
        )

    def _storage_rows_for_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[BillingStorageDaily]:
        column = BillingStorageDaily.s3_account_id if subject_type == "account" else BillingStorageDaily.s3_user_id
        return (
            self.db.query(BillingStorageDaily)
            .filter(
                BillingStorageDaily.storage_endpoint_id == endpoint_id,
                BillingStorageDaily.day >= period.start,
                BillingStorageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(BillingStorageDaily.day.asc())
            .all()
        )
