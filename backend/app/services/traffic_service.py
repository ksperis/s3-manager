# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.db_models import S3Account
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.rgw import resolve_admin_uid

logger = logging.getLogger(__name__)


class TrafficWindow(str, Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"


WINDOW_DELTAS: dict[TrafficWindow, timedelta] = {
    TrafficWindow.HOUR: timedelta(hours=1),
    TrafficWindow.DAY: timedelta(days=1),
    TrafficWindow.WEEK: timedelta(days=7),
}

WINDOW_RESOLUTION_LABELS: dict[TrafficWindow, str] = {
    TrafficWindow.HOUR: "per-entry",
    TrafficWindow.DAY: "hourly",
    TrafficWindow.WEEK: "daily",
}

REQUEST_GROUPS: list[tuple[str, tuple[str, ...]]] = [
    ("read", ("get", "read", "fetch", "download", "head")),
    ("write", ("put", "write", "upload", "post", "append", "copy")),
    ("delete", ("delete", "remove", "rm")),
    ("list", ("list", "ls", "bucket_list")),
    ("metadata", ("acl", "policy", "tag", "meta", "multipart")),
]


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


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


def aggregate_usage(
    entries: Iterable[dict],
    start: datetime,
    end: datetime,
    bucket_filter: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_filter = _normalize_bucket_name(bucket_filter) if bucket_filter else None
    timeline: dict[str, dict[str, int]] = defaultdict(
        lambda: {"bytes_in": 0, "bytes_out": 0, "ops": 0, "success_ops": 0}
    )
    bucket_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {"bytes_in": 0, "bytes_out": 0, "ops": 0, "success_ops": 0}
    )
    user_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {"bytes_in": 0, "bytes_out": 0, "ops": 0, "success_ops": 0}
    )
    category_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"bytes_in": 0, "bytes_out": 0, "ops": 0})
    request_groups: dict[str, dict[str, int]] = defaultdict(lambda: {"bytes_in": 0, "bytes_out": 0, "ops": 0})

    for entry in entries:
        timestamp = _parse_timestamp(entry.get("time") or entry.get("timestamp") or entry.get("date"))
        if timestamp is None or timestamp < start or timestamp > end:
            continue
        bucket_value = entry.get("bucket") or entry.get("bucket_name") or "unknown"
        if not isinstance(bucket_value, str):
            bucket_value = str(bucket_value)
        bucket = bucket_value
        bucket_normalized = _normalize_bucket_name(bucket_value)
        if normalized_filter and bucket_normalized != normalized_filter:
            continue
        user = entry.get("user") or entry.get("owner") or "unknown"
        categories = _normalize_categories(entry.get("categories"))
        for category_entry in categories:
            cat_name = category_entry.get("category") or category_entry.get("type")
            bytes_out = _safe_int(category_entry.get("bytes_sent") or category_entry.get("sent"))
            bytes_in = _safe_int(category_entry.get("bytes_received") or category_entry.get("received"))
            ops = _safe_int(category_entry.get("ops") or category_entry.get("operations"))
            success_ops = _safe_int(category_entry.get("successful_ops") or category_entry.get("success"))

            timeline_key = timestamp.isoformat()
            timeline[timeline_key]["bytes_in"] += bytes_in
            timeline[timeline_key]["bytes_out"] += bytes_out
            timeline[timeline_key]["ops"] += ops
            timeline[timeline_key]["success_ops"] += success_ops

            bucket_totals[bucket]["bytes_in"] += bytes_in
            bucket_totals[bucket]["bytes_out"] += bytes_out
            bucket_totals[bucket]["ops"] += ops
            bucket_totals[bucket]["success_ops"] += success_ops

            user_totals[user]["bytes_in"] += bytes_in
            user_totals[user]["bytes_out"] += bytes_out
            user_totals[user]["ops"] += ops
            user_totals[user]["success_ops"] += success_ops

            category_totals[cat_name or "unknown"]["bytes_in"] += bytes_in
            category_totals[cat_name or "unknown"]["bytes_out"] += bytes_out
            category_totals[cat_name or "unknown"]["ops"] += ops

            request_group = _group_category(cat_name)
            request_groups[request_group]["bytes_in"] += bytes_in
            request_groups[request_group]["bytes_out"] += bytes_out
            request_groups[request_group]["ops"] += ops

    sorted_timeline = [
        {"timestamp": key, **values} for key, values in sorted(timeline.items(), key=lambda item: item[0])
    ]

    bucket_rankings: list[dict[str, Any]] = []
    for bucket, values in bucket_totals.items():
        bytes_total = values["bytes_in"] + values["bytes_out"]
        success_ratio = (values["success_ops"] / values["ops"]) if values["ops"] else None
        bucket_rankings.append(
            {
                "bucket": bucket,
                "bytes_total": bytes_total,
                "bytes_in": values["bytes_in"],
                "bytes_out": values["bytes_out"],
                "ops": values["ops"],
                "success_ops": values["success_ops"],
                "success_ratio": success_ratio,
            }
        )
    bucket_rankings.sort(key=lambda entry: entry["bytes_total"], reverse=True)

    user_rankings: list[dict[str, Any]] = []
    for user, values in user_totals.items():
        bytes_total = values["bytes_in"] + values["bytes_out"]
        success_ratio = (values["success_ops"] / values["ops"]) if values["ops"] else None
        user_rankings.append(
            {
                "user": user,
                "bytes_total": bytes_total,
                "bytes_in": values["bytes_in"],
                "bytes_out": values["bytes_out"],
                "ops": values["ops"],
                "success_ops": values["success_ops"],
                "success_ratio": success_ratio,
            }
        )
    user_rankings.sort(key=lambda entry: entry["bytes_total"], reverse=True)

    request_breakdown = [
        {
            "group": group,
            "bytes_in": values["bytes_in"],
            "bytes_out": values["bytes_out"],
            "ops": values["ops"],
        }
        for group, values in request_groups.items()
    ]
    request_breakdown.sort(key=lambda entry: entry["ops"], reverse=True)

    category_breakdown = [
        {
            "category": name,
            "bytes_in": values["bytes_in"],
            "bytes_out": values["bytes_out"],
            "ops": values["ops"],
        }
        for name, values in category_totals.items()
    ]
    category_breakdown.sort(key=lambda entry: entry["bytes_in"] + entry["bytes_out"], reverse=True)

    totals = {
        "bytes_in": sum(point["bytes_in"] for point in sorted_timeline),
        "bytes_out": sum(point["bytes_out"] for point in sorted_timeline),
        "ops": sum(point["ops"] for point in sorted_timeline),
        "success_ops": sum(point["success_ops"] for point in sorted_timeline),
    }
    totals["success_rate"] = (totals["success_ops"] / totals["ops"]) if totals["ops"] else None

    return {
        "series": sorted_timeline,
        "totals": totals,
        "bucket_rankings": bucket_rankings[:10],
        "user_rankings": user_rankings[:10],
        "request_breakdown": request_breakdown,
        "category_breakdown": category_breakdown[:15],
    }


class TrafficService:
    def __init__(
        self,
        account: S3Account,
        rgw_client: Optional[RGWAdminClient] = None,
        admin_client: Optional[RGWAdminClient] = None,
    ) -> None:
        self.account = account
        self.admin_client = admin_client or self._admin_for_account(account)

    def _admin_for_account(self, account: S3Account) -> RGWAdminClient:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint:
            if not endpoint.admin_access_key or not endpoint.admin_secret_key:
                raise ValueError("RGW admin credentials are not configured for this endpoint")
            try:
                return get_rgw_admin_client(
                    access_key=endpoint.admin_access_key,
                    secret_key=endpoint.admin_secret_key,
                    endpoint=endpoint.admin_endpoint or endpoint.endpoint_url,
                    region=endpoint.region,
                )
            except RGWAdminError as exc:
                raise ValueError(str(exc)) from exc
        try:
            return get_rgw_admin_client()
        except RGWAdminError as exc:
            raise ValueError(str(exc)) from exc

    def get_traffic(
        self,
        window: TrafficWindow,
        bucket: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        if window not in WINDOW_DELTAS:
            raise ValueError(f"Unsupported window '{window}'.")
        reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
        start = reference - WINDOW_DELTAS[window]
        payload = self._fetch_usage(start=start, end=reference, bucket=bucket)
        entries = flatten_usage_entries(payload)
        aggregation = aggregate_usage(entries, start=start, end=reference, bucket_filter=bucket)
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
            "S3Account %s fetched %s usage entries via RGW admin (uid=%s)",
            self.account.rgw_account_id or self.account.id,
            len(entries),
            account_uid,
        )
        return payload
