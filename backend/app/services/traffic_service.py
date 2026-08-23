# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.s3_execution_context import S3ExecutionTarget
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.utils.numbers import int_or_zero
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_feature_flags

logger = logging.getLogger(__name__)


class TrafficWindow(str, Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"


WINDOW_DELTAS: dict[TrafficWindow, timedelta] = {
    TrafficWindow.HOUR: timedelta(hours=1),
    TrafficWindow.DAY: timedelta(days=1),
    TrafficWindow.WEEK: timedelta(days=7),
    TrafficWindow.MONTH: timedelta(days=30),
}

WINDOW_RESOLUTION_LABELS: dict[TrafficWindow, str] = {
    TrafficWindow.HOUR: "per-entry",
    TrafficWindow.DAY: "hourly",
    TrafficWindow.WEEK: "daily",
    TrafficWindow.MONTH: "daily",
}

REQUEST_GROUPS: list[tuple[str, tuple[str, ...]]] = [
    ("read", ("get", "read", "fetch", "download", "head")),
    ("write", ("put", "write", "upload", "post", "append", "copy")),
    ("delete", ("delete", "remove", "rm")),
    ("list", ("list", "ls", "bucket_list")),
    ("metadata", ("acl", "policy", "tag", "meta", "multipart")),
]


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("T", " ")
    if text.endswith("Z"):
        text = text[:-1]
    if "." in text:
        text = text.split(".", 1)[0]
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _bucket_timestamp(timestamp: datetime, window: Optional[TrafficWindow]) -> datetime:
    if not window:
        return timestamp
    if window in {TrafficWindow.WEEK, TrafficWindow.MONTH}:
        return timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
    if window == TrafficWindow.DAY:
        return timestamp.replace(minute=0, second=0, microsecond=0)
    return timestamp.replace(microsecond=0)


def window_start(reference: datetime, window: TrafficWindow) -> datetime:
    """Compute the time boundary for a given window.

    Notes:
    - For the 'week' window (7d charts), we align to day buckets so the UI renders daily points (7 buckets incl. today).
    """
    if window == TrafficWindow.WEEK:
        today = reference.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return today - timedelta(days=6)
    if window == TrafficWindow.MONTH:
        today = reference.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return today - timedelta(days=29)
    return (reference - WINDOW_DELTAS[window]).astimezone(timezone.utc)


def flatten_usage_entries(payload: Any) -> list[dict]:
    if payload is None:
        return []
    raw_entries: list[dict] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("entries"), list):
            raw_entries.extend([entry for entry in payload.get("entries") if isinstance(entry, dict)])
        if isinstance(payload.get("usage"), list):
            for user_entry in payload.get("usage") or []:
                if not isinstance(user_entry, dict):
                    continue
                nested_entries = user_entry.get("entries")
                if isinstance(nested_entries, list):
                    raw_entries.extend([entry for entry in nested_entries if isinstance(entry, dict)])
    elif isinstance(payload, list):
        for entry in payload:
            if isinstance(entry, dict):
                if isinstance(entry.get("entries"), list):
                    raw_entries.extend([item for item in entry.get("entries") if isinstance(item, dict)])
                else:
                    raw_entries.append(entry)
    flattened: list[dict] = []
    for entry in raw_entries:
        buckets = entry.get("buckets")
        if isinstance(buckets, list) and buckets:
            for bucket in buckets:
                if not isinstance(bucket, dict):
                    continue
                flattened.append(
                    {
                        "user": entry.get("user") or entry.get("owner"),
                        "bucket": bucket.get("bucket") or bucket.get("bucket_name"),
                        "owner": bucket.get("owner") or entry.get("user"),
                        "time": bucket.get("time") or entry.get("time"),
                        "epoch": bucket.get("epoch") or entry.get("epoch"),
                        "categories": bucket.get("categories") or entry.get("categories"),
                    }
                )
        else:
            flattened.append(entry)
    return flattened


def _normalize_categories(raw_categories: Any) -> list[dict]:
    if raw_categories is None:
        return []
    if isinstance(raw_categories, list):
        return [entry for entry in raw_categories if isinstance(entry, dict)]
    if isinstance(raw_categories, dict) and "category" in raw_categories:
        return [raw_categories]
    return []


def _group_category(name: Optional[str]) -> str:
    if not name:
        return "other"
    slug = str(name).lower()
    for group, keywords in REQUEST_GROUPS:
        if any(keyword in slug for keyword in keywords):
            return group
    return "other"


def _normalize_bucket_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    slug = str(value).strip().lower()
    if not slug:
        return None
    for delimiter in (":", "/"):
        if delimiter in slug:
            slug = slug.split(delimiter, 1)[-1]
    return slug


def _normalize_bucket_filters(bucket_filter: Optional[str | Iterable[str]]) -> Optional[set[str]]:
    if bucket_filter is None:
        return None
    if isinstance(bucket_filter, str):
        normalized = _normalize_bucket_name(bucket_filter)
        return {normalized} if normalized else set()
    normalized_values = {
        normalized
        for value in bucket_filter
        if (normalized := _normalize_bucket_name(value))
    }
    return normalized_values


def _activity_totals() -> dict[str, int]:
    return {"bytes_in": 0, "bytes_out": 0, "ops": 0, "success_ops": 0}


def _transfer_totals() -> dict[str, int]:
    return {"bytes_in": 0, "bytes_out": 0, "ops": 0}


@dataclass
class _UsageAccumulator:
    start: datetime
    end: datetime
    bucket_filters: Optional[set[str]]
    window: Optional[TrafficWindow]
    timeline: dict[str, dict[str, int]] = field(
        default_factory=lambda: defaultdict(_activity_totals)
    )
    bucket_totals: dict[str, dict[str, int]] = field(
        default_factory=lambda: defaultdict(_activity_totals)
    )
    user_totals: dict[Any, dict[str, int]] = field(
        default_factory=lambda: defaultdict(_activity_totals)
    )
    category_totals: dict[Any, dict[str, int]] = field(
        default_factory=lambda: defaultdict(_transfer_totals)
    )
    request_groups: dict[str, dict[str, int]] = field(
        default_factory=lambda: defaultdict(_transfer_totals)
    )

    @staticmethod
    def _add_transfer(
        totals: dict[str, int],
        *,
        bytes_in: int,
        bytes_out: int,
        ops: int,
    ) -> None:
        totals["bytes_in"] += bytes_in
        totals["bytes_out"] += bytes_out
        totals["ops"] += ops

    @classmethod
    def _add_activity(
        cls,
        totals: dict[str, int],
        *,
        bytes_in: int,
        bytes_out: int,
        ops: int,
        success_ops: int,
    ) -> None:
        cls._add_transfer(
            totals,
            bytes_in=bytes_in,
            bytes_out=bytes_out,
            ops=ops,
        )
        totals["success_ops"] += success_ops

    def _add_category(
        self,
        timestamp: datetime,
        bucket: str,
        user: Any,
        category_entry: dict,
    ) -> None:
        category = category_entry.get("category") or category_entry.get("type")
        bytes_out = int_or_zero(category_entry.get("bytes_sent") or category_entry.get("sent"))
        bytes_in = int_or_zero(category_entry.get("bytes_received") or category_entry.get("received"))
        ops = int_or_zero(category_entry.get("ops") or category_entry.get("operations"))
        success_ops = int_or_zero(
            category_entry.get("successful_ops") or category_entry.get("success")
        )
        activity = {
            "bytes_in": bytes_in,
            "bytes_out": bytes_out,
            "ops": ops,
            "success_ops": success_ops,
        }
        self._add_activity(self.timeline[timestamp.isoformat()], **activity)
        self._add_activity(self.bucket_totals[bucket], **activity)
        self._add_activity(self.user_totals[user], **activity)
        transfer = {"bytes_in": bytes_in, "bytes_out": bytes_out, "ops": ops}
        self._add_transfer(self.category_totals[category or "unknown"], **transfer)
        self._add_transfer(self.request_groups[_group_category(category)], **transfer)

    def add_entry(self, entry: dict) -> None:
        timestamp = _parse_timestamp(
            entry.get("time") or entry.get("timestamp") or entry.get("date")
        )
        if timestamp is None or timestamp < self.start or timestamp > self.end:
            return
        bucket_value = entry.get("bucket") or entry.get("bucket_name") or "unknown"
        if not isinstance(bucket_value, str):
            bucket_value = str(bucket_value)
        normalized_bucket = _normalize_bucket_name(bucket_value)
        if self.bucket_filters is not None and normalized_bucket not in self.bucket_filters:
            return
        bucketed_timestamp = _bucket_timestamp(timestamp, self.window)
        user = entry.get("user") or entry.get("owner") or "unknown"
        for category in _normalize_categories(entry.get("categories")):
            self._add_category(bucketed_timestamp, bucket_value, user, category)

    @staticmethod
    def _rankings(
        totals: dict[Any, dict[str, int]],
        label: str,
    ) -> list[dict[str, Any]]:
        rankings = [
            {
                label: name,
                "bytes_total": values["bytes_in"] + values["bytes_out"],
                "bytes_in": values["bytes_in"],
                "bytes_out": values["bytes_out"],
                "ops": values["ops"],
                "success_ops": values["success_ops"],
                "success_ratio": (
                    values["success_ops"] / values["ops"]
                    if values["ops"]
                    else None
                ),
            }
            for name, values in totals.items()
        ]
        rankings.sort(key=lambda entry: entry["bytes_total"], reverse=True)
        return rankings[:10]

    @staticmethod
    def _breakdown(
        totals: dict[Any, dict[str, int]],
        label: str,
        *,
        sort_by_ops: bool,
        limit: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        breakdown = [
            {
                label: name,
                "bytes_in": values["bytes_in"],
                "bytes_out": values["bytes_out"],
                "ops": values["ops"],
            }
            for name, values in totals.items()
        ]
        if sort_by_ops:
            breakdown.sort(key=lambda entry: entry["ops"], reverse=True)
        else:
            breakdown.sort(
                key=lambda entry: entry["bytes_in"] + entry["bytes_out"],
                reverse=True,
            )
        return breakdown[:limit] if limit is not None else breakdown

    def result(self) -> Dict[str, Any]:
        series = [
            {"timestamp": key, **values}
            for key, values in sorted(self.timeline.items(), key=lambda item: item[0])
        ]
        totals = {
            "bytes_in": sum(point["bytes_in"] for point in series),
            "bytes_out": sum(point["bytes_out"] for point in series),
            "ops": sum(point["ops"] for point in series),
            "success_ops": sum(point["success_ops"] for point in series),
        }
        totals["success_rate"] = (
            totals["success_ops"] / totals["ops"] if totals["ops"] else None
        )
        return {
            "series": series,
            "totals": totals,
            "bucket_rankings": self._rankings(self.bucket_totals, "bucket"),
            "user_rankings": self._rankings(self.user_totals, "user"),
            "request_breakdown": self._breakdown(
                self.request_groups,
                "group",
                sort_by_ops=True,
            ),
            "category_breakdown": self._breakdown(
                self.category_totals,
                "category",
                sort_by_ops=False,
                limit=15,
            ),
        }


def aggregate_usage(
    entries: Iterable[dict],
    start: datetime,
    end: datetime,
    bucket_filter: Optional[str | Iterable[str]] = None,
    window: Optional[TrafficWindow] = None,
) -> Dict[str, Any]:
    accumulator = _UsageAccumulator(
        start=start,
        end=end,
        bucket_filters=_normalize_bucket_filters(bucket_filter),
        window=window,
    )
    for entry in entries:
        accumulator.add_entry(entry)
    return accumulator.result()


class TrafficService:
    def __init__(
        self,
        account: S3ExecutionTarget,
        rgw_client: Optional[RGWAdminClient] = None,
        admin_client: Optional[RGWAdminClient] = None,
    ) -> None:
        self.account = account
        _ = rgw_client
        self.admin_client = admin_client or self._admin_for_account(account)

    def _admin_for_account(self, account: S3ExecutionTarget) -> RGWAdminClient:
        endpoint = account.storage_endpoint
        if endpoint is None:
            raise ValueError("Supervision credentials are not configured for this endpoint")
        flags = resolve_feature_flags(endpoint)
        if not flags.usage_enabled:
            raise ValueError("Usage logs are disabled for this endpoint")
        try:
            return get_supervision_rgw_client(endpoint)
        except RGWAdminError as exc:
            raise ValueError(str(exc)) from exc

    def get_traffic(
        self,
        window: TrafficWindow,
        bucket: Optional[str] = None,
        bucket_filters: Optional[Iterable[str]] = None,
        now: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        if window not in WINDOW_DELTAS:
            raise ValueError(f"Unsupported window '{window}'.")
        reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
        start = window_start(reference, window)
        payload = self._fetch_usage(start=start, end=reference, bucket=bucket)
        entries = flatten_usage_entries(payload)
        aggregation = aggregate_usage(
            entries,
            start=start,
            end=reference,
            bucket_filter=bucket if bucket else bucket_filters,
            window=window,
        )
        aggregation.update(
            {
                "window": window.value if isinstance(window, TrafficWindow) else str(window),
                "start": start.isoformat(),
                "end": reference.isoformat(),
                "resolution": WINDOW_RESOLUTION_LABELS.get(window, "per-entry"),
                "bucket_filter": bucket,
            }
        )
        aggregation["data_points"] = len(aggregation.get("series") or [])
        return aggregation

    def _fetch_usage(
        self,
        start: datetime,
        end: datetime,
        bucket: Optional[str],
    ) -> Dict[str, Any]:
        account_uid = None
        if self.account.rgw_account_id:
            account_uid = self.account.rgw_account_id.strip()
        else:
            account_uid = resolve_admin_uid(self.account.rgw_account_id, self.account.rgw_user_uid)
        if not account_uid:
            return {}
        payload = self.admin_client.get_usage(
            uid=account_uid,
            tenant=None,
            start=start,
            end=end,
            show_entries=True,
            show_summary=False,
        )
        entries = flatten_usage_entries(payload)
        logger.debug(
            "S3 execution context %s fetched %s usage entries via RGW admin (uid=%s)",
            self.account.rgw_account_id or self.account.id,
            len(entries),
            account_uid,
        )
        return payload
