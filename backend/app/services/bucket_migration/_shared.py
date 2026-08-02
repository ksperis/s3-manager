# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import json
import logging
import os
import queue
import re
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from typing import Any, Callable, Optional

import requests
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db import (
    BucketMigration,
    BucketMigrationEvent,
    BucketMigrationItem,
    S3Account,
    S3Connection,
    S3User,
    User,
)
from app.models.bucket_migration import BucketMigrationCreateRequest
from app.services.app_settings_service import load_app_settings
from app.services.buckets_service import BucketsService
from app.services.bucket_migration.precheck import (
    BucketMigrationInspector,
    BucketMigrationPrecheckPlanner,
)
from app.services.object_diff_common import compare_object_entries
from app.services.effective_access_service import EffectiveAccessService
from app.services.s3_client import _delete_objects_count, get_s3_client, purge_bucket_contents
from app.utils.rgw import resolve_admin_uid
from app.utils.network_targets import validate_outbound_url
from app.utils.s3_connection_endpoint import resolve_connection_endpoint
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_client_options
from app.utils.time import utcnow

logger = logging.getLogger(__name__)
settings = get_settings()

_READ_ONLY_POLICY_SID = "S3ManagerMigrationReadOnlyDeny"
_TARGET_WRITE_LOCK_POLICY_SID = "S3ManagerMigrationTargetWriteLockDeny"
_SOURCE_COPY_GRANT_POLICY_SID = "S3ManagerMigrationSourceCopyGrantAllow"
_MIGRATION_USER_AGENT_MARKER = "s3-manager-migration-worker"
_WEBHOOK_TIMEOUT_SECONDS = max(0.1, float(settings.bucket_migration_webhook_timeout_seconds or 2.0))
_WEBHOOK_ALLOW_PRIVATE_TARGETS = bool(settings.bucket_migration_webhook_allow_private_targets)
_WEBHOOK_ALLOWED_HOSTS = {
    str(host or "").strip().lower()
    for host in (settings.bucket_migration_webhook_allowed_hosts or [])
    if str(host or "").strip()
}
_WEBHOOK_QUEUE_SIZE = max(1, min(int(settings.bucket_migration_webhook_queue_size or 500), 10_000))
_WEBHOOK_WORKERS = max(1, min(int(settings.bucket_migration_webhook_workers or 1), 8))
_SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD = 500
_SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS = 10.0
_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS = 5.0
_RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER = 32
_ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS = 10.0
_DIFF_CONTROL_CHECK_INTERVAL_OBJECTS = 5_000
_DB_ERROR_MESSAGE_MAX_CHARS = 16_384
_DB_EVENT_MESSAGE_MAX_CHARS = 4_096
_DB_EVENT_METADATA_MAX_CHARS = 65_536
_DB_EVENT_METADATA_MAX_DEPTH = 8
_DB_EVENT_METADATA_MAX_ITEMS = 100
_RUNNABLE_MIGRATION_STATUSES = ("queued", "running", "pause_requested", "cancel_requested")
_FINAL_MIGRATION_STATUSES = (
    "completed",
    "completed_with_errors",
    "failed",
    "canceled",
    "rolled_back",
)
class _WorkerLeaseLostError(RuntimeError):
    """Raised when a worker loses ownership of a migration lease."""


class _MigrationControlRequested(RuntimeError):
    """Raised when a long-running scan must stop for pause/cancel."""

    def __init__(self, state: str) -> None:
        super().__init__(state)
        self.state = state


@dataclass
class _ResolvedContext:
    context_id: str
    account: S3Account
    endpoint: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool


@dataclass
class _SyncDiff:
    copy_keys: list[str]
    delete_keys: list[str]
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]


@dataclass(frozen=True)
class _BucketObjectEntry:
    key: str
    size: int
    etag: Optional[str]


@dataclass(frozen=True)
class _BucketDiffEntry:
    kind: str
    key: str
    source_size: int
    target_size: int
    source_etag: Optional[str]
    target_etag: Optional[str]
    compare_by: str


@dataclass(frozen=True)
class _BucketVersionEntry:
    key: str
    version_id: str
    is_delete_marker: bool
    is_latest: bool
    last_modified: Optional[datetime]
    size: int
    etag: Optional[str]
    storage_class: Optional[str]
    order_index: int


@dataclass
class _VersionReplayWatermarkBuilder:
    latest_dt: Optional[datetime] = None
    tie_entries: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class _VersionedObjectDetails:
    size: int
    etag: Optional[str]
    compare_by: str
    checksums: dict[str, str]
    content_type: Optional[str]
    cache_control: Optional[str]
    content_disposition: Optional[str]
    content_encoding: Optional[str]
    content_language: Optional[str]
    expires: Optional[str]
    storage_class: Optional[str]
    metadata: dict[str, str]
    tags: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class _VersionTimelineDiffKey:
    key: str
    source_version_id: Optional[str]
    target_version_id: Optional[str]


@dataclass(frozen=True)
class _VersionTimelineDiffEntry:
    key: str
    kind: str
    compare_by: str
    source_version_id: Optional[str]
    target_version_id: Optional[str]
    source_size: int
    target_size: int
    source_etag: Optional[str]
    target_etag: Optional[str]
    reason: Optional[str] = None


@dataclass(frozen=True)
class _VersionAwareDiff:
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]
    size_only_pairs: tuple[_VersionTimelineDiffKey, ...] = ()


@dataclass(frozen=True)
class _VersionTimelineComparison:
    equal: bool
    first_difference: Optional[dict[str, Any]]
    size_only_pairs: tuple[_VersionTimelineDiffKey, ...] = ()


_VERSION_CHECKSUM_FIELDS = (
    "ChecksumSHA256",
    "ChecksumCRC32C",
    "ChecksumCRC32",
    "ChecksumSHA1",
)


@dataclass(frozen=True)
class _MigrationRuntimeLimits:
    parallelism_default: int
    parallelism_max: int
    max_active_per_endpoint: int


@dataclass(frozen=True)
class _WebhookDispatchTask:
    webhook_url: str
    payload: dict[str, Any]
    migration_id: int
    item_id: Optional[int]


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)


def _json_loads(value: Optional[str]) -> Any:
    if value is None:
        return None
    return json.loads(value)


def _truncate_db_text(value: Any, *, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    text = "" if value is None else str(value)
    if len(text) <= max_chars:
        return text
    omitted = len(text) - max_chars
    suffix = f"... [truncated {omitted} chars]"
    if len(suffix) >= max_chars:
        return suffix[:max_chars]
    return text[: max_chars - len(suffix)] + suffix


def _truncate_optional_db_text(value: Optional[str], *, max_chars: int) -> Optional[str]:
    if value is None:
        return None
    return _truncate_db_text(value, max_chars=max_chars)


def _sanitize_event_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth >= _DB_EVENT_METADATA_MAX_DEPTH:
        return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
    if isinstance(value, dict):
        safe_dict: dict[str, Any] = {}
        total_items = len(value)
        for index, (key, nested_value) in enumerate(value.items()):
            if index >= _DB_EVENT_METADATA_MAX_ITEMS:
                safe_dict["__truncated_items__"] = total_items - _DB_EVENT_METADATA_MAX_ITEMS
                break
            safe_key = _truncate_db_text(key, max_chars=256)
            safe_dict[safe_key] = _sanitize_event_metadata(nested_value, depth=depth + 1)
        return safe_dict
    if isinstance(value, (list, tuple, set)):
        entries = list(value)
        safe_entries = [
            _sanitize_event_metadata(entry, depth=depth + 1)
            for entry in entries[:_DB_EVENT_METADATA_MAX_ITEMS]
        ]
        if len(entries) > _DB_EVENT_METADATA_MAX_ITEMS:
            safe_entries.append(
                f"[truncated {len(entries) - _DB_EVENT_METADATA_MAX_ITEMS} additional item(s)]"
            )
        return safe_entries
    return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)


def _serialize_event_metadata(metadata: Optional[dict[str, Any]]) -> Optional[str]:
    if metadata is None:
        return None
    serialized = _json_dumps(metadata)
    if len(serialized) <= _DB_EVENT_METADATA_MAX_CHARS:
        return serialized
    fallback_payload = {
        "truncated": True,
        "original_length": len(serialized),
        "preview": _truncate_db_text(serialized, max_chars=1024),
    }
    return _json_dumps(fallback_payload)


def _validate_webhook_target_url(webhook_url: str) -> None:
    validate_outbound_url(
        webhook_url,
        field_name="webhook_url",
        allowed_schemes=("http", "https"),
        scheme_label="http(s)",
        allowed_hosts=_WEBHOOK_ALLOWED_HOSTS or None,
        allow_private_targets=_WEBHOOK_ALLOW_PRIVATE_TARGETS,
        private_target_hint="; set BUCKET_MIGRATION_WEBHOOK_ALLOW_PRIVATE_TARGETS=true to allow it",
    )


__all__ = [name for name in globals() if not name.startswith("__")]
