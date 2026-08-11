# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import json
import logging
from threading import Lock
from time import monotonic
import threading
import uuid
from typing import Any, Callable, TypeVar

from fastapi import HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from app.services.bucket_listing_shared import parse_includes as parse_bucket_listing_includes
from app.services.listing_progress import (
    ListingCancelled,
    ListingProgressSnapshot,
)
from app.utils.cache import prune_expired_lru_cache
from app.core.sensitive_data import sanitize_error_detail
from app.routers.sse_worker import (
    SseMessageSender,
    format_sse_event,
    stream_cancellable_worker,
)

_K = TypeVar("_K")
_T = TypeVar("_T")
_R = TypeVar("_R")
_ModelT = TypeVar("_ModelT", bound=BaseModel)

@dataclass(frozen=True)
class EndpointListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str


@dataclass(frozen=True)
class EndpointPayloadCacheKey:
    endpoint_id: int


@dataclass
class EndpointCacheEntry:
    endpoint_id: int
    expires_at: float
    value: Any


def normalize_http_error_detail(detail: object) -> object:
    return sanitize_error_detail(detail)


def stream_listing_response(
    request: Request,
    *,
    compute: Callable[
        [Callable[[ListingProgressSnapshot], None], Callable[[], None]],
        BaseModel,
    ],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        def progress_callback(snapshot: ListingProgressSnapshot) -> None:
            payload: dict[str, object] = {
                "request_id": request_id,
                "percent": snapshot.percent,
                "stage": snapshot.stage,
                "processed": snapshot.processed,
                "total": snapshot.total,
            }
            if snapshot.message:
                payload["message"] = snapshot.message
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise ListingCancelled()

        try:
            result = compute(progress_callback, cancel_check)
            payload = result.model_dump(mode="json")
            push_message(format_sse_event("result", payload))
            push_message(format_sse_event("done", {"request_id": request_id}))
        except ListingCancelled:
            return
        except HTTPException as exc:
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": normalize_http_error_detail(exc.detail),
                    },
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id}))
        except Exception as exc:  # pragma: no cover
            logger.exception("%s: %s", failure_message, exc)
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": failure_message,
                    },
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="listing_stream",
        request_id=request_id,
    )


def parse_includes(include: list[str]) -> set[str]:
    return parse_bucket_listing_includes(include)


def parse_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.isdigit() or (cleaned.startswith("-") and cleaned[1:].isdigit()):
            return int(cleaned)
    return None


def parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "enabled", "enable", "on", "suspended"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "disable", "off", "active"}:
            return False
    return None


def fields_set(model: BaseModel) -> set[str]:
    return set(model.model_fields_set)


def serialize_filter(query: BaseModel | None) -> str | None:
    if not query:
        return None
    payload = query.model_dump(mode="json")
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def parse_filter_query(
    raw: str | None,
    *,
    query_cls: type[_ModelT],
) -> _ModelT | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid advanced_filter JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="advanced_filter must be a JSON object")
    try:
        return query_cls.model_validate(parsed)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


def coerce_number(value: object) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def get_or_set_cache(
    cache: OrderedDict[_K, EndpointCacheEntry],
    lock: Lock,
    key: _K,
    *,
    ttl_seconds: float,
    max_entries: int,
    builder: Callable[[], Any],
) -> Any:
    now = monotonic()
    with lock:
        prune_expired_lru_cache(cache, now=now, max_entries=max_entries)
        cached = cache.get(key)
        if cached is not None:
            cache.move_to_end(key)
            return cached.value
    value = builder()
    expires_at = monotonic() + ttl_seconds
    with lock:
        prune_expired_lru_cache(cache, now=monotonic(), max_entries=max_entries)
        cache[key] = EndpointCacheEntry(endpoint_id=getattr(key, "endpoint_id", 0), expires_at=expires_at, value=value)
        cache.move_to_end(key)
        prune_expired_lru_cache(cache, now=monotonic(), max_entries=max_entries)
    return value


def invalidate_cache(
    cache: OrderedDict[_K, EndpointCacheEntry],
    lock: Lock,
    *,
    endpoint_id: int | None = None,
) -> None:
    with lock:
        if endpoint_id is None:
            cache.clear()
            return
        keys = [key for key in cache.keys() if getattr(key, "endpoint_id", None) == endpoint_id]
        for key in keys:
            cache.pop(key, None)


def collect_filter_fields(parsed_filter: Any | None) -> set[str]:
    if not parsed_filter:
        return set()
    rules = getattr(parsed_filter, "rules", None)
    if not rules:
        return set()
    return {rule.field for rule in rules if getattr(rule, "field", None)}


def sort_value(value: Any, tie_breaker: str) -> tuple[int, Any, str]:
    normalized_tie_breaker = str(tie_breaker or "").lower()
    if value is None:
        return (1, "", normalized_tie_breaker)
    if isinstance(value, str):
        return (0, value.lower(), normalized_tie_breaker)
    return (0, value, normalized_tie_breaker)


def apply_advanced_filter(
    items: list[_T],
    parsed_filter: Any | None,
    matcher: Callable[[_T, list[_R], str], bool],
) -> list[_T]:
    if not parsed_filter:
        return items
    rules = getattr(parsed_filter, "rules", None)
    if not rules:
        return items
    match_mode = getattr(parsed_filter, "match", "all")
    return [item for item in items if matcher(item, rules, match_mode)]


def apply_simple_search(
    items: list[_T],
    *,
    search: str | None,
    parsed_filter: Any | None,
    match_with_filter: Callable[[_T, str], bool],
    match_without_filter: Callable[[_T, str], bool],
) -> list[_T]:
    if not isinstance(search, str):
        return items
    normalized = search.strip().lower()
    if not normalized:
        return items
    if parsed_filter:
        return [item for item in items if match_with_filter(item, normalized)]
    return [item for item in items if match_without_filter(item, normalized)]


def paginate(
    items: list[_T],
    *,
    page: int,
    page_size: int,
    clone: Callable[[list[_T]], list[_T]],
) -> tuple[list[_T], int, bool]:
    total = len(items)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = clone(items[start:end])
    return page_items, total, end < total
