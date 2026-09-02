# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import os
import re
import shlex
from datetime import date as date_cls
from datetime import datetime, time as time_cls, timedelta, timezone
from typing import Any, Optional
from urllib.parse import unquote

from app.models.portal_storage_spaces import PortalStorageSpaceSummary
from app.models.portal_access_logs import (
    PortalServerAccessLogEntry,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogFilterRule,
)


SERVER_ACCESS_LOG_RAW_MAX_DAYS = 31
_HTTP_REQUEST_RE = re.compile(r"^(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS) .+ HTTP/\d(?:\.\d)?$")


def dash_to_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return None if text == "-" else text


def _safe_int(value: Any) -> Optional[int]:
    normalized = dash_to_none(value)
    if normalized is None:
        return None
    try:
        return int(str(normalized))
    except (TypeError, ValueError):
        return None


def _classify_operation(operation: str) -> tuple[str, Optional[str]]:
    normalized = operation.upper()
    if normalized in {"REST.PUT.OBJECT", "REST.POST.OBJECT", "REST.POST.UPLOAD"} or normalized.startswith("REST.PUT.OBJECT"):
        return "upload", "Upload"
    if normalized.startswith("REST.GET.OBJECT"):
        return "download", "Download"
    if ".DELETE." in normalized:
        return "delete", None
    if "LIST" in normalized or normalized.startswith("REST.GET.BUCKET"):
        return "list", None
    if normalized.startswith("REST.HEAD.") or any(
        marker in normalized
        for marker in (
            ".ACL",
            ".TAGGING",
            ".RETENTION",
            ".LEGAL_HOLD",
            ".VERSIONING",
            ".LIFECYCLE",
            ".CORS",
            ".POLICY",
        )
    ):
        return "metadata", None
    return "other", None


def standard_access_log_bucket(line: str) -> Optional[str]:
    start = line.find("[")
    if start < 0:
        return None
    head = line[:start].strip().split()
    if len(head) < 2:
        return None
    return head[1]


def standard_access_log_timestamp(line: str) -> Optional[datetime]:
    start = line.find("[")
    end = line.find("]", start + 1)
    if start < 0 or end < 0:
        return None
    try:
        return datetime.strptime(line[start + 1 : end], "%d/%b/%Y:%H:%M:%S %z").astimezone(timezone.utc)
    except ValueError:
        return None


def parse_standard_access_log_line(
    line: str,
    *,
    log_object_key: str,
    space_by_bucket: dict[str, PortalStorageSpaceSummary],
) -> Optional[PortalServerAccessLogEntry]:
    bucket_name = standard_access_log_bucket(line)
    if bucket_name is None:
        return None
    storage_space = space_by_bucket.get(bucket_name)
    if storage_space is None:
        return None
    timestamp = standard_access_log_timestamp(line)
    if timestamp is None:
        return None
    end = line.find("]")
    try:
        tokens = shlex.split(line[end + 1 :].strip())
    except ValueError:
        return None
    op_index = next(
        (index for index, token in enumerate(tokens) if token.upper().startswith(("REST.", "WEBSITE."))),
        -1,
    )
    if op_index < 2 or op_index + 2 >= len(tokens):
        return None
    operation = tokens[op_index]
    category, direction = _classify_operation(operation)
    request_uri_index = next(
        (index for index in range(op_index + 1, len(tokens)) if _HTTP_REQUEST_RE.match(tokens[index])),
        op_index + 2,
    )
    object_tokens = [dash_to_none(token) for token in tokens[op_index + 1 : request_uri_index]]
    object_parts = [token.strip("/") for token in object_tokens if token]
    object_key = "/".join(part for part in object_parts if part) if object_parts else None
    if object_key is not None:
        object_key = unquote(object_key)
    tail = tokens[request_uri_index + 1 :]
    request_id = " ".join(tokens[2:op_index]).strip() or None
    digest = hashlib.sha1(f"{log_object_key}\n{line}".encode("utf-8")).hexdigest()[:16]
    return PortalServerAccessLogEntry(
        id=f"server-log-{digest}",
        timestamp=timestamp,
        storage_space_id=storage_space.id,
        storage_space_name=storage_space.name,
        bucket_name=bucket_name,
        operation=operation,
        operation_category=category,
        object_key=object_key,
        object_name=os.path.basename(object_key.rstrip("/")) if object_key else None,
        direction=direction,
        status_code=_safe_int(tail[0] if len(tail) > 0 else None),
        error_code=dash_to_none(tail[1] if len(tail) > 1 else None),
        bytes_sent=_safe_int(tail[2] if len(tail) > 2 else None),
        object_size=_safe_int(tail[3] if len(tail) > 3 else None),
        requester=dash_to_none(tokens[1] if len(tokens) > 1 else None),
        client_ip=dash_to_none(tokens[0] if tokens else None),
        auth_type=dash_to_none(tail[12] if len(tail) > 12 else None),
        request_id=request_id,
        request_uri=dash_to_none(tokens[request_uri_index] if request_uri_index < len(tokens) else None),
        user_agent=dash_to_none(tail[7] if len(tail) > 7 else None),
        log_object_key=log_object_key,
    )


def utc_dates_for_local_range(
    start_date: date_cls,
    end_date: date_cls,
    timezone_offset_minutes: int,
) -> tuple[datetime, datetime, list[date_cls]]:
    if end_date < start_date:
        raise ValueError("date_to must be greater than or equal to date_from")
    if (end_date - start_date).days + 1 > SERVER_ACCESS_LOG_RAW_MAX_DAYS:
        raise ValueError(f"date range cannot exceed {SERVER_ACCESS_LOG_RAW_MAX_DAYS} days")
    offset = max(-14 * 60, min(14 * 60, int(timezone_offset_minutes)))
    local_tz = timezone(timedelta(minutes=-offset))
    start_local = datetime.combine(start_date, time_cls.min, tzinfo=local_tz)
    end_local = datetime.combine(end_date + timedelta(days=1), time_cls.min, tzinfo=local_tz)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    dates: list[date_cls] = []
    current = start_utc.date()
    last = (end_utc - timedelta(microseconds=1)).date()
    while current <= last:
        dates.append(current)
        current = current + timedelta(days=1)
    return start_utc, end_utc, dates


def utc_dates_for_local_day(
    selected_date: date_cls,
    timezone_offset_minutes: int,
) -> tuple[datetime, datetime, list[date_cls]]:
    return utc_dates_for_local_range(selected_date, selected_date, timezone_offset_minutes)


def _normalize_filter_value(value: Any) -> str:
    return str(value if value is not None else "").strip().lower()


def _filter_value_texts(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    return [normalized for item in values if (normalized := _normalize_filter_value(item))]


def _filter_values(entry: PortalServerAccessLogEntry, field: str) -> list[str]:
    identity = entry.requester_identity
    if field == "action":
        return _filter_value_texts([entry.operation_category, entry.operation, entry.direction])
    if field == "space":
        return _filter_value_texts([entry.storage_space_id, entry.storage_space_name, entry.bucket_name])
    if field == "path":
        return _filter_value_texts([entry.object_key, entry.object_name, entry.request_uri])
    if field == "identity":
        return _filter_value_texts(
            [
                entry.requester,
                identity.label if identity else None,
                identity.kind if identity else None,
                identity.detail if identity else None,
                identity.access_key_id if identity else None,
                identity.iam_username if identity else None,
                identity.user_id if identity else None,
                identity.email if identity else None,
            ]
        )
    if field == "result":
        result_label = (
            "success"
            if entry.status_code is not None and entry.status_code < 400
            else "failure"
            if entry.status_code is not None
            else None
        )
        return _filter_value_texts([entry.status_code, entry.error_code, result_label])
    return []


def _matches_filter_rule(
    entry: PortalServerAccessLogEntry,
    rule: PortalServerAccessLogFilterRule,
) -> bool:
    values = _filter_values(entry, rule.field)
    op = rule.op
    if op == "is_null":
        return not values
    if op == "not_null":
        return bool(values)
    candidates = _filter_value_texts(rule.value)
    if not candidates:
        return False
    if op == "contains":
        return any(candidate in value for value in values for candidate in candidates)
    if op == "starts_with":
        return any(value.startswith(candidate) for value in values for candidate in candidates)
    if op == "ends_with":
        return any(value.endswith(candidate) for value in values for candidate in candidates)
    if op == "eq":
        return any(value == candidate for value in values for candidate in candidates)
    if op == "neq":
        return bool(values) and not any(value == candidate for value in values for candidate in candidates)
    if op == "in":
        return any(value in candidates for value in values)
    if op == "not_in":
        return bool(values) and not any(value in candidates for value in values)
    return False


def apply_server_access_log_filter(
    entries: list[PortalServerAccessLogEntry],
    advanced_filter: Optional[PortalServerAccessLogFilterQuery],
) -> list[PortalServerAccessLogEntry]:
    if not advanced_filter or not advanced_filter.rules:
        return entries
    matches = all if advanced_filter.match == "all" else any
    return [
        entry
        for entry in entries
        if matches(_matches_filter_rule(entry, rule) for rule in advanced_filter.rules)
    ]
