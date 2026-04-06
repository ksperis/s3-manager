# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import ipaddress
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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse
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
from app.services.bucket_migration_runtime import (
    BucketMigrationExecutor,
    BucketMigrationInspector,
    BucketMigrationPrecheckPlanner,
    BucketMigrationVerifier,
)
from app.services.object_diff_common import compare_object_entries
from app.services.s3_client import _delete_objects_count, get_s3_client
from app.utils.rgw import resolve_admin_uid
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
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


class _WorkerLeaseLostError(RuntimeError):
    """Raised when a worker loses ownership of a migration lease."""


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
    try:
        return json.loads(value)
    except Exception:
        return None


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


def _webhook_host_allowed(host: str) -> bool:
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return False
    if not _WEBHOOK_ALLOWED_HOSTS:
        return True
    for allowed in _WEBHOOK_ALLOWED_HOSTS:
        if normalized_host == allowed or normalized_host.endswith(f".{allowed}"):
            return True
    return False


def _resolve_webhook_host_ips(host: str) -> set[IPAddress]:
    resolved: set[IPAddress] = set()
    for family, _, _, _, sockaddr in socket.getaddrinfo(host, None):
        try:
            if family == socket.AF_INET6:
                addr = ipaddress.ip_address(sockaddr[0])
            else:
                addr = ipaddress.ip_address(sockaddr[0])
        except Exception:  # noqa: BLE001
            continue
        resolved.add(addr)
    return resolved


def _is_private_or_local_ip(address: IPAddress) -> bool:
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    )


def _validate_webhook_target_url(webhook_url: str) -> None:
    parsed = urlparse(webhook_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.hostname:
        raise ValueError("webhook_url must be a valid http(s) URL")
    if parsed.username or parsed.password:
        raise ValueError("webhook_url must not include user credentials")

    host = parsed.hostname.strip().lower().rstrip(".")
    if not _webhook_host_allowed(host):
        raise ValueError("webhook_url host is not allowed by webhook policy")

    try:
        resolved_ips = _resolve_webhook_host_ips(host)
    except socket.gaierror as exc:
        raise ValueError(f"webhook_url host cannot be resolved: {exc}") from exc
    if not resolved_ips:
        raise ValueError("webhook_url host cannot be resolved")

    if not _WEBHOOK_ALLOW_PRIVATE_TARGETS and any(_is_private_or_local_ip(ip_addr) for ip_addr in resolved_ips):
        raise ValueError(
            "webhook_url resolves to a private or local network address; "
            "set BUCKET_MIGRATION_WEBHOOK_ALLOW_PRIVATE_TARGETS=true to allow it"
        )


class BucketMigrationService:
    def __init__(
        self,
        db: Session,
        *,
        authorized_context_ids: Optional[set[str]] = None,
        admin_account_context_ids: Optional[set[str]] = None,
    ) -> None:
        self.db = db
        self._buckets = BucketsService()
        self._inspector = BucketMigrationInspector(self)
        self._precheck_planner = BucketMigrationPrecheckPlanner(self, self._inspector)
        self._verifier = BucketMigrationVerifier(self)
        self._executor = BucketMigrationExecutor(self)
        self._authorized_context_ids: Optional[set[str]]
        self._admin_account_context_ids: Optional[set[str]]
        if authorized_context_ids is None:
            self._authorized_context_ids = None
        else:
            self._authorized_context_ids = {str(value or "").strip() for value in authorized_context_ids if str(value or "").strip()}
        if admin_account_context_ids is None:
            self._admin_account_context_ids = None
        else:
            self._admin_account_context_ids = {
                str(value or "").strip() for value in admin_account_context_ids if str(value or "").strip()
            }

    def _commit(self) -> None:
        self.db.commit()

    def _json_dumps_safe(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        return _json_dumps(value)

    def _is_context_authorized(self, context_id: str) -> bool:
        if self._authorized_context_ids is None:
            return True
        return str(context_id or "").strip() in self._authorized_context_ids

    def _assert_context_authorized_for_mutation(self, context_id: str) -> None:
        if self._is_context_authorized(context_id):
            return
        raise PermissionError("Not authorized for this context")

    def _is_account_context_id(self, context_id: str) -> bool:
        return str(context_id or "").strip().isdigit()

    def _assert_cross_account_admin_contexts(self, source_context_id: str, target_context_id: str) -> None:
        if self._admin_account_context_ids is None:
            return

        source_value = str(source_context_id or "").strip()
        target_value = str(target_context_id or "").strip()
        if source_value == target_value:
            return
        if not self._is_account_context_id(source_value) or not self._is_account_context_id(target_value):
            return
        if source_value in self._admin_account_context_ids and target_value in self._admin_account_context_ids:
            return
        raise PermissionError(
            "Cross-account migrations require admin access on both source and target account contexts"
        )

    def _validate_configured_webhook_url(self, webhook_url: str) -> None:
        try:
            _validate_webhook_target_url(webhook_url)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    def _build_bucket_mappings(self, payload: BucketMigrationCreateRequest) -> list[tuple[str, str]]:
        mappings: list[tuple[str, str]] = []
        seen_targets: set[str] = set()
        for entry in payload.buckets:
            source_bucket = (entry.source_bucket or "").strip()
            target_bucket = ((entry.target_bucket or "").strip() or f"{payload.mapping_prefix}{source_bucket}").strip()
            if not source_bucket:
                raise ValueError("source bucket is required")
            if not target_bucket:
                raise ValueError(f"target bucket is required for source '{source_bucket}'")
            if target_bucket in seen_targets:
                raise ValueError(f"Duplicate target bucket mapping: {target_bucket}")
            seen_targets.add(target_bucket)
            mappings.append((source_bucket, target_bucket))
        return mappings

    def _resolve_same_endpoint_copy_options(
        self,
        payload: BucketMigrationCreateRequest,
        *,
        same_endpoint: bool,
    ) -> tuple[bool, bool]:
        use_same_endpoint_copy = bool(payload.use_same_endpoint_copy)
        explicit_auto_grant = payload.auto_grant_source_read_for_copy

        if use_same_endpoint_copy and not same_endpoint:
            raise ValueError(
                "x-amz-copy-source can only be enabled when source and target contexts use the same endpoint"
            )
        if not use_same_endpoint_copy and explicit_auto_grant is True:
            raise ValueError(
                "auto_grant_source_read_for_copy cannot be enabled when use_same_endpoint_copy is disabled"
            )

        if explicit_auto_grant is None:
            auto_grant_source_read_for_copy = use_same_endpoint_copy
        else:
            auto_grant_source_read_for_copy = bool(explicit_auto_grant)

        if not use_same_endpoint_copy:
            auto_grant_source_read_for_copy = False

        return use_same_endpoint_copy, auto_grant_source_read_for_copy

    def create_migration(self, payload: BucketMigrationCreateRequest, user: User) -> BucketMigration:
        mappings = self._build_bucket_mappings(payload)
        self._assert_context_authorized_for_mutation(payload.source_context_id)
        self._assert_context_authorized_for_mutation(payload.target_context_id)
        self._assert_cross_account_admin_contexts(payload.source_context_id, payload.target_context_id)

        webhook_url = (payload.webhook_url or "").strip() or None
        if webhook_url:
            self._validate_configured_webhook_url(webhook_url)

        source_ctx = self._resolve_context(payload.source_context_id)
        target_ctx = self._resolve_context(payload.target_context_id)
        if not source_ctx.endpoint:
            raise ValueError("Source context endpoint is not configured")
        if not target_ctx.endpoint:
            raise ValueError("Target context endpoint is not configured")
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        if same_endpoint:
            for source_bucket, target_bucket in mappings:
                if source_bucket == target_bucket:
                    raise ValueError(
                        "When source and target contexts use the same endpoint, "
                        "target bucket must differ from source bucket. "
                        "Use a prefix or explicit mapping override."
                    )
        use_same_endpoint_copy, auto_grant_source_read_for_copy = self._resolve_same_endpoint_copy_options(
            payload,
            same_endpoint=same_endpoint,
        )

        limits = self._load_runtime_limits()
        requested_parallelism = (
            int(payload.parallelism_max)
            if payload.parallelism_max is not None
            else int(limits.parallelism_default)
        )
        parallelism = max(1, min(requested_parallelism, int(limits.parallelism_max)))

        migration = BucketMigration(
            created_by_user_id=user.id,
            source_context_id=payload.source_context_id,
            target_context_id=payload.target_context_id,
            mode=payload.mode,
            copy_bucket_settings=bool(payload.copy_bucket_settings),
            delete_source=bool(payload.delete_source),
            strong_integrity_check=bool(payload.strong_integrity_check),
            lock_target_writes=bool(payload.lock_target_writes),
            use_same_endpoint_copy=use_same_endpoint_copy,
            auto_grant_source_read_for_copy=auto_grant_source_read_for_copy,
            webhook_url=webhook_url,
            mapping_prefix=payload.mapping_prefix or None,
            status="draft",
            precheck_status="pending",
            precheck_report_json=None,
            precheck_checked_at=None,
            parallelism_max=parallelism,
            total_items=len(mappings),
            completed_items=0,
            failed_items=0,
            skipped_items=0,
            awaiting_items=0,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(migration)
        self.db.flush()

        for source_bucket, target_bucket in mappings:
            self.db.add(
                BucketMigrationItem(
                    migration_id=migration.id,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    status="pending",
                    step="create_bucket",
                    source_snapshot_json=None,
                    target_snapshot_json=None,
                    execution_plan_json=None,
                    replication_state_json=None,
                    created_at=utcnow(),
                    updated_at=utcnow(),
                )
            )

        self._add_event(
            migration,
            level="info",
            message="Migration created.",
            metadata={
                "source_context_id": payload.source_context_id,
                "target_context_id": payload.target_context_id,
                "mode": payload.mode,
                "copy_bucket_settings": bool(payload.copy_bucket_settings),
                "delete_source": bool(payload.delete_source),
                "strong_integrity_check": bool(payload.strong_integrity_check),
                "lock_target_writes": bool(payload.lock_target_writes),
                "use_same_endpoint_copy": use_same_endpoint_copy,
                "auto_grant_source_read_for_copy": auto_grant_source_read_for_copy,
                "webhook_enabled": bool(payload.webhook_url),
                "parallelism_max": parallelism,
                "items": len(mappings),
            },
        )
        self._commit()
        self.db.refresh(migration)
        return migration

    def update_draft_migration(self, migration_id: int, payload: BucketMigrationCreateRequest) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status != "draft":
            raise ValueError("Only draft migrations can be updated")

        mappings = self._build_bucket_mappings(payload)
        self._assert_context_authorized_for_mutation(payload.source_context_id)
        self._assert_context_authorized_for_mutation(payload.target_context_id)
        self._assert_cross_account_admin_contexts(payload.source_context_id, payload.target_context_id)

        webhook_url = (payload.webhook_url or "").strip() or None
        if webhook_url:
            self._validate_configured_webhook_url(webhook_url)

        source_ctx = self._resolve_context(payload.source_context_id)
        target_ctx = self._resolve_context(payload.target_context_id)
        if not source_ctx.endpoint:
            raise ValueError("Source context endpoint is not configured")
        if not target_ctx.endpoint:
            raise ValueError("Target context endpoint is not configured")
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        if same_endpoint:
            for source_bucket, target_bucket in mappings:
                if source_bucket == target_bucket:
                    raise ValueError(
                        "When source and target contexts use the same endpoint, "
                        "target bucket must differ from source bucket. "
                        "Use a prefix or explicit mapping override."
                    )
        use_same_endpoint_copy, auto_grant_source_read_for_copy = self._resolve_same_endpoint_copy_options(
            payload,
            same_endpoint=same_endpoint,
        )

        limits = self._load_runtime_limits()
        requested_parallelism = (
            int(payload.parallelism_max)
            if payload.parallelism_max is not None
            else int(limits.parallelism_default)
        )
        parallelism = max(1, min(requested_parallelism, int(limits.parallelism_max)))

        migration.source_context_id = payload.source_context_id
        migration.target_context_id = payload.target_context_id
        migration.mode = payload.mode
        migration.copy_bucket_settings = bool(payload.copy_bucket_settings)
        migration.delete_source = bool(payload.delete_source)
        migration.strong_integrity_check = bool(payload.strong_integrity_check)
        migration.lock_target_writes = bool(payload.lock_target_writes)
        migration.use_same_endpoint_copy = use_same_endpoint_copy
        migration.auto_grant_source_read_for_copy = auto_grant_source_read_for_copy
        migration.webhook_url = webhook_url
        migration.mapping_prefix = payload.mapping_prefix or None
        migration.parallelism_max = parallelism
        migration.status = "draft"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.precheck_status = "pending"
        migration.precheck_report_json = None
        migration.precheck_checked_at = None
        migration.error_message = None
        migration.started_at = None
        migration.finished_at = None
        migration.last_heartbeat_at = None
        migration.updated_at = utcnow()

        item_by_source = {item.source_bucket: item for item in migration.items}
        mapping_by_source = {source_bucket: target_bucket for source_bucket, target_bucket in mappings}

        for source_bucket in list(item_by_source.keys()):
            if source_bucket not in mapping_by_source:
                self.db.delete(item_by_source[source_bucket])

        now = utcnow()
        for source_bucket, target_bucket in mappings:
            item = item_by_source.get(source_bucket)
            if item is None:
                self.db.add(
                    BucketMigrationItem(
                        migration_id=migration.id,
                        source_bucket=source_bucket,
                        target_bucket=target_bucket,
                        status="pending",
                        step="create_bucket",
                        source_snapshot_json=None,
                        target_snapshot_json=None,
                        execution_plan_json=None,
                        replication_state_json=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
                continue

            item.target_bucket = target_bucket
            item.status = "pending"
            item.step = "create_bucket"
            item.pre_sync_done = False
            item.read_only_applied = False
            item.target_lock_applied = False
            item.target_bucket_exists = False
            item.objects_copied = 0
            item.objects_deleted = 0
            item.source_count = None
            item.target_count = None
            item.matched_count = None
            item.different_count = None
            item.only_source_count = None
            item.only_target_count = None
            item.diff_sample_json = None
            item.source_snapshot_json = None
            item.target_snapshot_json = None
            item.execution_plan_json = None
            item.replication_state_json = None
            item.source_policy_backup_json = None
            item.target_policy_backup_json = None
            item.error_message = None
            item.started_at = None
            item.finished_at = None
            item.updated_at = now

        self.db.flush()
        self.db.refresh(migration)
        self._recompute_counters(migration)
        migration.updated_at = utcnow()

        self._add_event(
            migration,
            level="info",
            message="Migration configuration updated.",
            metadata={
                "source_context_id": payload.source_context_id,
                "target_context_id": payload.target_context_id,
                "mode": payload.mode,
                "copy_bucket_settings": bool(payload.copy_bucket_settings),
                "delete_source": bool(payload.delete_source),
                "strong_integrity_check": bool(payload.strong_integrity_check),
                "lock_target_writes": bool(payload.lock_target_writes),
                "use_same_endpoint_copy": use_same_endpoint_copy,
                "auto_grant_source_read_for_copy": auto_grant_source_read_for_copy,
                "webhook_enabled": bool(payload.webhook_url),
                "parallelism_max": parallelism,
                "items": len(mappings),
            },
        )
        self._commit()
        self.db.refresh(migration)
        return migration

    def list_migrations(self, limit: int = 100, *, context_id: Optional[str] = None) -> list[BucketMigration]:
        if self._authorized_context_ids is not None and not self._authorized_context_ids:
            return []
        query = self.db.query(BucketMigration)
        if self._authorized_context_ids is not None:
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        normalized_context_id = (context_id or "").strip()
        if normalized_context_id:
            if self._authorized_context_ids is not None and normalized_context_id not in self._authorized_context_ids:
                return []
            query = query.filter(
                or_(
                    BucketMigration.source_context_id == normalized_context_id,
                    BucketMigration.target_context_id == normalized_context_id,
                )
            )
        return query.order_by(BucketMigration.created_at.desc()).limit(max(1, min(int(limit), 500))).all()

    def get_migration(self, migration_id: int) -> BucketMigration:
        query = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id)
        if self._authorized_context_ids is not None:
            if not self._authorized_context_ids:
                raise ValueError("Migration not found")
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        migration = query.first()
        if not migration:
            raise ValueError("Migration not found")
        return migration

    def list_migration_items(self, migration_id: int) -> list[BucketMigrationItem]:
        migration = self.get_migration(migration_id)
        return (
            self.db.query(BucketMigrationItem)
            .filter(BucketMigrationItem.migration_id == migration.id)
            .order_by(BucketMigrationItem.id.asc())
            .all()
        )

    def list_recent_migration_events(self, migration_id: int, *, limit: int) -> list[BucketMigrationEvent]:
        migration = self.get_migration(migration_id)
        safe_limit = max(1, min(int(limit), 1000))
        return (
            self.db.query(BucketMigrationEvent)
            .filter(BucketMigrationEvent.migration_id == migration.id)
            .order_by(BucketMigrationEvent.created_at.desc(), BucketMigrationEvent.id.desc())
            .limit(safe_limit)
            .all()
        )

    def delete_migration(self, migration_id: int) -> None:
        migration = self.get_migration(migration_id)
        if migration.status not in {*_FINAL_MIGRATION_STATUSES, "draft"}:
            raise ValueError("Migration can only be deleted from a final status or from draft")
        self.db.delete(migration)
        self._commit()

    def run_precheck(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        self._assert_cross_account_admin_contexts(migration.source_context_id, migration.target_context_id)
        if migration.status in {"running", "queued", "pause_requested", "cancel_requested"}:
            raise ValueError("Precheck cannot run while migration is active")

        checked_at = utcnow()
        report = self._precheck_planner.run(migration, checked_at=checked_at)
        errors = int(report.get("errors") or 0)
        warnings = int(report.get("warnings") or 0)

        migration.precheck_status = "failed" if errors > 0 else "passed"
        migration.precheck_report_json = _json_dumps(report)
        migration.precheck_checked_at = checked_at
        migration.updated_at = checked_at
        if errors > 0:
            self._add_event(
                migration,
                level="warning",
                message="Precheck failed.",
                metadata={"errors": errors, "warnings": warnings},
            )
        else:
            self._add_event(
                migration,
                level="info",
                message="Precheck passed.",
                metadata={"errors": 0, "warnings": warnings},
            )
        self._commit()
        self.db.refresh(migration)
        return migration

    def start_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        self._assert_cross_account_admin_contexts(migration.source_context_id, migration.target_context_id)
        if migration.status not in {"draft", "paused"}:
            raise ValueError("Migration cannot be started from current status")
        if migration.precheck_status != "passed":
            raise ValueError("Precheck must pass before start. Run /precheck first.")
        for item in migration.items:
            try:
                self._assert_item_execution_plan_supported(item)
            except RuntimeError as exc:
                raise ValueError(
                    "Precheck must be re-run before start. "
                    f"Item '{item.source_bucket}' -> '{item.target_bucket}' is not runnable: {exc}"
                ) from exc
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
            if item.status == "awaiting_cutover" and migration.mode != "pre_sync":
                item.status = "pending"
                item.step = "apply_read_only"
            item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration queued.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def request_pause(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"queued", "running", "pause_requested"}:
            raise ValueError("Pause is only available while migration is queued or running")
        migration.pause_requested = True
        migration.status = "pause_requested"
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Pause requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def resume_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"paused"}:
            raise ValueError("Resume is only available from paused status")
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.status = "queued"
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration resumed.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def stop_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back"}:
            raise ValueError("Migration is already finished")
        if migration.status in {"paused", "awaiting_cutover", "draft"}:
            source_ctx: Optional[_ResolvedContext] = None
            target_ctx: Optional[_ResolvedContext] = None
            needs_source_cleanup = any(item.read_only_applied or item.source_policy_backup_json for item in migration.items)
            needs_target_cleanup = any(item.target_lock_applied or item.target_policy_backup_json for item in migration.items)
            if needs_source_cleanup:
                try:
                    source_ctx = self._resolve_context(migration.source_context_id)
                except Exception as exc:  # noqa: BLE001
                    self._add_event(
                        migration,
                        level="warning",
                        message="Unable to resolve source context while stopping migration; source policy cleanup was skipped.",
                        metadata={"error": str(exc)},
                    )
            if needs_target_cleanup:
                try:
                    target_ctx = self._resolve_context(migration.target_context_id)
                except Exception as exc:  # noqa: BLE001
                    self._add_event(
                        migration,
                        level="warning",
                        message="Unable to resolve target context while stopping migration; target lock cleanup was skipped.",
                        metadata={"error": str(exc)},
                    )
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
        else:
            migration.cancel_requested = True
            migration.status = "cancel_requested"
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Stop requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def continue_after_presync(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status != "awaiting_cutover":
            raise ValueError("Continue is only available when migration is awaiting cutover")
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "awaiting_cutover":
                item.status = "pending"
                item.step = "apply_read_only"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Cutover requested after pre-sync.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def retry_item(self, migration_id: int, item_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        item = self._find_migration_item(migration, item_id)
        self._ensure_manual_item_operation_allowed(migration)
        if item.status != "failed":
            raise ValueError("Retry is only available for failed bucket items")

        self._prepare_item_retry(migration, item)
        self._queue_migration_for_retry(migration, message=f"Retry requested for bucket '{item.source_bucket}'.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def retry_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to retry")

        for item in failed_items:
            self._prepare_item_retry(migration, item)

        self._queue_migration_for_retry(
            migration,
            message=f"Retry requested for {len(failed_items)} failed bucket item(s).",
        )
        self._commit()
        self.db.refresh(migration)
        return migration, len(failed_items)

    def rollback_item(self, migration_id: int, item_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        item = self._find_migration_item(migration, item_id)
        self._ensure_manual_item_operation_allowed(migration)
        if item.status != "failed":
            raise ValueError("Rollback is only available for failed bucket items")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        self._ensure_rollback_safe(migration, [item], source_ctx=source_ctx)
        self._rollback_single_item(migration, item, source_ctx, target_ctx)
        self._refresh_status_after_manual_item_operations(migration)
        self._commit()
        self.db.refresh(migration)
        return migration

    def rollback_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to rollback")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        self._ensure_rollback_safe(migration, failed_items, source_ctx=source_ctx)
        for item in failed_items:
            self._rollback_single_item(migration, item, source_ctx, target_ctx)

        self._refresh_status_after_manual_item_operations(migration)
        self._commit()
        self.db.refresh(migration)
        return migration, len(failed_items)

    def rollback_failed_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"failed", "completed_with_errors"}:
            raise ValueError("Rollback is only available for failed migrations")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        actionable_items = [item for item in migration.items if item.status != "skipped"]
        self._ensure_rollback_safe(migration, actionable_items, source_ctx=source_ctx)

        item_errors: list[str] = []
        total_purged_objects = 0
        rollback_started_at = utcnow()

        for item in migration.items:
            rollback_issues: list[str] = []

            if item.read_only_applied or item.source_policy_backup_json:
                try:
                    if item.source_policy_backup_json:
                        self._restore_source_policy(item.source_bucket, source_ctx.account, item)
                    else:
                        self._remove_managed_read_only_statement(item.source_bucket, source_ctx.account)
                    item.read_only_applied = False
                    item.source_policy_backup_json = None
                except Exception as exc:  # noqa: BLE001
                    rollback_issues.append(
                        _truncate_db_text(
                            f"source policy restore failed: {exc}",
                            max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                        )
                    )

            if item.target_lock_applied or item.target_policy_backup_json:
                try:
                    if item.target_policy_backup_json:
                        self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                    else:
                        self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                    item.target_lock_applied = False
                    item.target_policy_backup_json = None
                except Exception as exc:  # noqa: BLE001
                    rollback_issues.append(
                        _truncate_db_text(
                            f"target lock restore failed: {exc}",
                            max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                        )
                    )

            if item.status != "skipped":
                try:
                    purged_current, purged_versions = self._purge_target_bucket(target_ctx, item.target_bucket)
                    purged_count = purged_current + purged_versions
                    total_purged_objects += purged_count
                    item.objects_deleted = int(item.objects_deleted or 0) + purged_count
                    item.replication_state_json = None
                except Exception as exc:  # noqa: BLE001
                    rollback_issues.append(
                        _truncate_db_text(
                            f"destination cleanup failed: {exc}",
                            max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                        )
                    )

            if rollback_issues:
                item.status = "failed"
                item.step = "rollback_failed"
                item.error_message = _truncate_optional_db_text(
                    "Rollback failed: " + "; ".join(rollback_issues),
                    max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                )
                item.finished_at = utcnow()
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="error",
                    message="Rollback failed for item.",
                    metadata={"issues": rollback_issues},
                )
                item_errors.append(
                    _truncate_db_text(
                        f"{item.source_bucket}: {'; '.join(rollback_issues)}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )
                continue

            item.status = "rolled_back"
            item.step = "rolled_back"
            item.error_message = None
            item.finished_at = utcnow()
            item.updated_at = utcnow()
            self._add_event(
                migration,
                item=item,
                level="info",
                message="Rollback completed for item.",
                metadata={"target_bucket": item.target_bucket},
            )

        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        migration.finished_at = rollback_started_at

        if item_errors:
            migration.status = "completed_with_errors"
            migration.error_message = _truncate_optional_db_text(
                f"Rollback completed with {len(item_errors)} error(s): " + " | ".join(item_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            self._add_event(
                migration,
                level="warning",
                message="Rollback completed with errors.",
                metadata={
                    "errors": len(item_errors),
                    "purged_objects": total_purged_objects,
                    "sample": item_errors[:3],
                },
            )
        else:
            migration.status = "rolled_back"
            migration.error_message = None
            self._add_event(
                migration,
                level="info",
                message="Rollback completed successfully.",
                metadata={"purged_objects": total_purged_objects},
            )

        self._recompute_counters(migration)
        self._commit()
        self.db.refresh(migration)
        return migration

    def claim_next_runnable_migration_id(self, *, worker_id: str, lease_seconds: int) -> Optional[int]:
        if not worker_id:
            raise ValueError("worker_id is required to claim a migration lease")
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        limits = self._load_runtime_limits()
        max_active_per_endpoint = max(1, int(limits.max_active_per_endpoint))
        endpoint_usage = self._active_endpoint_usage(now=now)
        endpoint_cache: dict[str, str] = {}
        candidate_rows = [
            row
            for row in (
                self.db.query(
                    BucketMigration.id,
                    BucketMigration.source_context_id,
                    BucketMigration.target_context_id,
                )
                .filter(
                    BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .order_by(BucketMigration.created_at.asc())
                .limit(50)
                .all()
            )
        ]
        for row in candidate_rows:
            migration_id = int(row.id)
            endpoint_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=endpoint_cache,
            )
            if any(endpoint_usage.get(key, 0) >= max_active_per_endpoint for key in endpoint_keys):
                continue
            updated = (
                self.db.query(BucketMigration)
                .filter(
                    BucketMigration.id == migration_id,
                    BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .update(
                    {
                        BucketMigration.worker_lease_owner: worker_id,
                        BucketMigration.worker_lease_until: lease_until,
                        BucketMigration.updated_at: now,
                    },
                    synchronize_session=False,
                )
            )
            if updated == 1:
                self._commit()
                if self._claimed_migration_within_endpoint_limit(
                    migration_id,
                    endpoint_keys=endpoint_keys,
                    max_active_per_endpoint=max_active_per_endpoint,
                    now=utcnow(),
                    cache=endpoint_cache,
                ):
                    return migration_id
                logger.info(
                    "Bucket migration claim released after endpoint limit recheck: migration=%s worker=%s",
                    migration_id,
                    worker_id,
                )
                self._release_migration_lease(migration_id, worker_id=worker_id)
                self._commit()
                endpoint_usage = self._active_endpoint_usage(now=utcnow())
                continue
            self.db.rollback()
        return None

    def find_next_runnable_migration_id(self) -> Optional[int]:
        now = utcnow()
        row = (
            self.db.query(BucketMigration)
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                or_(
                    BucketMigration.worker_lease_until.is_(None),
                    BucketMigration.worker_lease_until < now,
                ),
            )
            .order_by(BucketMigration.created_at.asc())
            .first()
        )
        return int(row.id) if row else None

    def run_migration(
        self,
        migration_id: int,
        *,
        worker_id: Optional[str] = None,
        lease_seconds: Optional[int] = None,
    ) -> None:
        effective_lease_seconds = max(15, int(lease_seconds or settings.bucket_migration_worker_lease_seconds))
        migration = self.get_migration(migration_id)

        if worker_id:
            if migration.worker_lease_owner != worker_id:
                return
            if not self._renew_migration_lease(migration.id, worker_id=worker_id, lease_seconds=effective_lease_seconds):
                return
            migration = self.get_migration(migration_id)

        if migration.status in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back", "awaiting_cutover"}:
            if worker_id and migration.worker_lease_owner == worker_id:
                migration.worker_lease_owner = None
                migration.worker_lease_until = None
                self._commit()
            return

        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            migration.status = "running" if migration.status not in {"pause_requested", "cancel_requested"} else migration.status
            if migration.started_at is None:
                migration.started_at = utcnow()
            migration.updated_at = utcnow()
            migration.last_heartbeat_at = utcnow()
            self._commit()

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        control_check = lambda: self._control_state(
            migration.id,
            worker_id=worker_id,
            lease_seconds=effective_lease_seconds,
        )

        for item in migration.items:
            self.db.refresh(migration)
            state = control_check()
            if state == "lost_lease":
                return
            if state == "cancel":
                self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
                self._commit()
                return
            if state == "pause":
                self._mark_paused(migration)
                self._commit()
                return

            if item.status in {"completed", "rolled_back", "skipped", "failed", "canceled"}:
                continue
            if migration.mode == "pre_sync" and migration.status == "awaiting_cutover":
                if worker_id and migration.worker_lease_owner == worker_id:
                    migration.worker_lease_owner = None
                    migration.worker_lease_until = None
                    self._commit()
                return

            try:
                item.status = "running"
                if item.started_at is None:
                    item.started_at = utcnow()
                item.updated_at = utcnow()
                self._commit()
                self._run_item(migration, item, source_ctx, target_ctx, control_check=control_check)
            except _WorkerLeaseLostError:
                self.db.rollback()
                return
            except Exception as exc:  # noqa: BLE001
                logger.exception("Bucket migration item failed: migration=%s item=%s", migration.id, item.id)
                self.db.rollback()
                migration = self.get_migration(migration.id)
                failed_item = self.db.query(BucketMigrationItem).filter(BucketMigrationItem.id == item.id).first()
                if failed_item is None:
                    continue
                failed_item.status = "failed"
                failed_item.error_message = _truncate_optional_db_text(
                    str(exc),
                    max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                )
                failed_item.finished_at = utcnow()
                failed_item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=failed_item,
                    level="error",
                    message="Item failed.",
                    metadata={"error": str(exc), "step": failed_item.step},
                )
                self._commit()

        self.db.refresh(migration)
        self._finalize_or_wait_cutover(migration, source_ctx=source_ctx, target_ctx=target_ctx)
        if worker_id and migration.worker_lease_owner == worker_id and migration.status not in _RUNNABLE_MIGRATION_STATUSES:
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
        self._commit()

    def _run_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        control_check: Callable[[], str],
    ) -> None:
        self._executor.run_item(
            migration,
            item,
            source_ctx,
            target_ctx,
            control_check=control_check,
        )

    def _load_item_execution_plan(self, item: BucketMigrationItem) -> dict[str, Any]:
        parsed = _json_loads(getattr(item, "execution_plan_json", None))
        return parsed if isinstance(parsed, dict) else {}

    def _item_execution_strategy(self, item: BucketMigrationItem) -> str:
        plan = self._load_item_execution_plan(item)
        strategy = str(plan.get("strategy") or "current_only").strip() or "current_only"
        return strategy

    def _load_item_replication_state(self, item: BucketMigrationItem) -> dict[str, Any]:
        parsed = _json_loads(getattr(item, "replication_state_json", None))
        return parsed if isinstance(parsed, dict) else {}

    def _store_item_replication_state(self, item: BucketMigrationItem, state: dict[str, Any]) -> None:
        item.replication_state_json = self._json_dumps_safe(state)

    def _clear_item_replication_state(self, item: BucketMigrationItem) -> None:
        item.replication_state_json = None

    def _assert_item_execution_plan_supported(self, item: BucketMigrationItem) -> None:
        plan = self._load_item_execution_plan(item)
        strategy = self._item_execution_strategy(item)
        supported = bool(plan.get("supported")) if plan else False
        if not plan:
            raise RuntimeError(
                "Missing execution plan for migration item. Re-run precheck before starting the migration."
            )
        if strategy not in {"current_only", "version_aware", "skip_existing"}:
            raise RuntimeError(
                f"Execution strategy '{strategy}' is not implemented by the migration worker."
            )
        if not supported:
            blocking_codes = plan.get("blocking_codes")
            if isinstance(blocking_codes, list) and blocking_codes:
                codes = ", ".join(str(code) for code in blocking_codes[:5])
                raise RuntimeError(
                    "Migration item is blocked by precheck findings and cannot run. "
                    f"Blocking checks: {codes}"
                )
            raise RuntimeError("Migration item is blocked by precheck findings and cannot run.")

    def _run_item_impl(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        control_check: Callable[[], str],
    ) -> None:
        self._assert_item_execution_plan_supported(item)
        last_heartbeat_persist = 0.0
        while True:
            now_mono = time.monotonic()
            if (now_mono - last_heartbeat_persist) >= _ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS:
                heartbeat_at = utcnow()
                migration.last_heartbeat_at = heartbeat_at
                migration.updated_at = heartbeat_at
                item.updated_at = heartbeat_at
                self._commit()
                last_heartbeat_persist = now_mono

            state = control_check()
            if state == "lost_lease":
                raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
            if state == "cancel":
                item.status = "canceled"
                item.finished_at = utcnow()
                item.updated_at = utcnow()
                self._commit()
                return
            if state == "pause":
                item.status = "paused"
                item.updated_at = utcnow()
                self._commit()
                return

            strategy = self._item_execution_strategy(item)

            if item.step == "create_bucket":
                object_lock_enabled = False
                if migration.copy_bucket_settings:
                    object_lock = self._buckets.get_bucket_object_lock(item.source_bucket, source_ctx.account)
                    object_lock_enabled = bool(object_lock and object_lock.enabled)
                try:
                    self._buckets.create_bucket(
                        item.target_bucket,
                        target_ctx.account,
                        versioning=(strategy == "version_aware"),
                        location_constraint=target_ctx.region,
                        object_lock_enabled=object_lock_enabled,
                    )
                except RuntimeError as exc:
                    if self._is_bucket_already_exists_error(exc):
                        item.target_bucket_exists = True
                        item.status = "skipped"
                        item.step = "skipped"
                        item.error_message = "Target bucket already exists; item skipped."
                        item.finished_at = utcnow()
                        self._add_event(
                            migration,
                            item=item,
                            level="info",
                            message="Target bucket already exists; item skipped.",
                            metadata={"target_bucket": item.target_bucket},
                        )
                        self._commit()
                        return
                    raise
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Target bucket created.",
                    metadata={"target_bucket": item.target_bucket, "object_lock_enabled": object_lock_enabled},
                )
                if migration.copy_bucket_settings:
                    item.step = "copy_bucket_settings"
                else:
                    item.step = self._next_step_after_target_setup(migration, item)
                self._commit()
                continue

            if item.step == "copy_bucket_settings":
                self._copy_bucket_settings(source_ctx.account, item.source_bucket, target_ctx.account, item.target_bucket, migration, item)
                item.step = self._next_step_after_target_setup(migration, item)
                self._commit()
                continue

            if item.step == "apply_target_lock":
                try:
                    self._apply_target_write_lock_policy(target_ctx, item.target_bucket, item)
                    item.target_lock_applied = True
                except Exception as exc:  # noqa: BLE001
                    lock_error = str(exc)
                    try:
                        if item.target_policy_backup_json:
                            self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                        else:
                            self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                    except Exception as restore_exc:  # noqa: BLE001
                        lock_error = f"{lock_error}; restore attempt failed: {restore_exc}"
                    item.target_lock_applied = False
                    item.target_policy_backup_json = None
                    raise RuntimeError(
                        "Target write-lock policy could not be applied: "
                        f"{lock_error}"
                    ) from exc
                item.step = "pre_sync" if migration.mode == "pre_sync" and not item.pre_sync_done else "apply_read_only"
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Target write-lock policy applied.",
                )
                self._commit()
                continue

            if item.step == "pre_sync":
                copied, deleted, diff = self._sync_bucket(
                    source_ctx,
                    target_ctx,
                    source_bucket=item.source_bucket,
                    target_bucket=item.target_bucket,
                    allow_delete=False,
                    parallelism_max=migration.parallelism_max,
                    migration=migration,
                    item=item,
                    control_check=control_check,
                )
                if copied < 0 or deleted < 0:
                    state = control_check()
                    if state == "lost_lease":
                        raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
                    if state == "cancel":
                        item.status = "canceled"
                        item.finished_at = utcnow()
                    else:
                        item.status = "paused"
                    item.updated_at = utcnow()
                    self._commit()
                    return
                item.source_count = diff.source_count
                item.target_count = diff.target_count
                item.matched_count = diff.matched_count
                item.different_count = diff.different_count
                item.only_source_count = diff.only_source_count
                item.only_target_count = diff.only_target_count
                item.diff_sample_json = _json_dumps(diff.sample)
                item.pre_sync_done = True
                item.status = "awaiting_cutover"
                item.step = "awaiting_cutover"
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Pre-sync completed; waiting for cutover.",
                    metadata={"copied": copied},
                )
                self._commit()
                return

            if item.step == "awaiting_cutover":
                item.status = "awaiting_cutover"
                item.updated_at = utcnow()
                self._commit()
                return

            if item.step == "apply_read_only":
                self._apply_read_only_policy(source_ctx.account, item.source_bucket, item)
                item.read_only_applied = True
                item.step = "sync"
                item.updated_at = utcnow()
                self._add_event(migration, item=item, level="info", message="Read-only policy applied on source bucket.")
                self._commit()
                continue

            if item.step == "sync":
                copied, deleted, diff = self._sync_bucket(
                    source_ctx,
                    target_ctx,
                    source_bucket=item.source_bucket,
                    target_bucket=item.target_bucket,
                    allow_delete=True,
                    parallelism_max=migration.parallelism_max,
                    migration=migration,
                    item=item,
                    control_check=control_check,
                )
                if copied < 0 or deleted < 0:
                    state = control_check()
                    if state == "lost_lease":
                        raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
                    if state == "cancel":
                        item.status = "canceled"
                        item.finished_at = utcnow()
                    else:
                        item.status = "paused"
                    item.updated_at = utcnow()
                    self._commit()
                    return
                item.source_count = diff.source_count
                item.target_count = diff.target_count
                item.matched_count = diff.matched_count
                item.different_count = diff.different_count
                item.only_source_count = diff.only_source_count
                item.only_target_count = diff.only_target_count
                item.diff_sample_json = _json_dumps(diff.sample)
                item.step = "verify"
                item.updated_at = utcnow()
                self._commit()
                continue

            if item.step == "verify":
                diff = self._compare_buckets_streamed(
                    source_ctx,
                    target_ctx,
                    source_bucket=item.source_bucket,
                    target_bucket=item.target_bucket,
                    strategy=strategy,
                    control_check=control_check,
                )
                if diff is None:
                    state = control_check()
                    if state == "lost_lease":
                        raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
                    if state == "cancel":
                        item.status = "canceled"
                        item.finished_at = utcnow()
                    else:
                        item.status = "paused"
                    item.updated_at = utcnow()
                    self._commit()
                    return

                item.source_count = diff.source_count
                item.target_count = diff.target_count
                item.matched_count = diff.matched_count
                item.different_count = diff.different_count
                item.only_source_count = diff.only_source_count
                item.only_target_count = diff.only_target_count
                item.diff_sample_json = _json_dumps(diff.sample)

                has_diff = bool(
                    diff.different_count
                    or diff.only_source_count
                    or diff.only_target_count
                )
                if has_diff:
                    item.status = "failed"
                    item.error_message = "Final diff is not clean"
                    item.finished_at = utcnow()
                    item.updated_at = utcnow()
                    self._add_event(
                        migration,
                        item=item,
                        level="error",
                        message="Final diff detected differences.",
                        metadata={
                            "different_count": diff.different_count,
                            "only_source_count": diff.only_source_count,
                            "only_target_count": diff.only_target_count,
                        },
                    )
                    self._commit()
                    return

                if migration.delete_source:
                    if bool(getattr(migration, "strong_integrity_check", False)):
                        (
                            size_only_count,
                            verified_count,
                            failed_keys,
                            method_counts,
                        ) = self._strong_verify_size_only_candidates_streamed(
                            source_ctx,
                            target_ctx,
                            source_bucket=item.source_bucket,
                            target_bucket=item.target_bucket,
                            strategy=strategy,
                            parallelism_max=max(1, min(int(migration.parallelism_max), 4)),
                            control_check=control_check,
                        )
                        if size_only_count < 0:
                            state = control_check()
                            if state == "lost_lease":
                                raise _WorkerLeaseLostError(f"Worker lease lost for migration {migration.id}")
                            if state == "cancel":
                                item.status = "canceled"
                                item.finished_at = utcnow()
                            else:
                                item.status = "paused"
                            item.updated_at = utcnow()
                            self._commit()
                            return

                        if failed_keys:
                            failed_sample = failed_keys[:20]
                            item.status = "failed"
                            item.error_message = (
                                "Final strong verification failed for "
                                f"{len(failed_keys)} object(s) out of {size_only_count} size-only candidate(s); "
                                "automatic source deletion is blocked to prevent data loss."
                            )
                            item.finished_at = utcnow()
                            item.updated_at = utcnow()
                            self._add_event(
                                migration,
                                item=item,
                                level="error",
                                message="Source deletion blocked due to strong verification failures.",
                                metadata={
                                    "size_only_count": size_only_count,
                                    "verified_count": verified_count,
                                    "failed_count": len(failed_keys),
                                    "failed_sample": failed_sample,
                                    "method_counts": method_counts,
                                },
                            )
                            self._commit()
                            return

                        self._add_event(
                            migration,
                            item=item,
                            level="info",
                            message="Strong verification completed for size-only candidates.",
                            metadata={
                                "size_only_count": size_only_count,
                                "verified_count": verified_count,
                                "method_counts": method_counts,
                            },
                        )
                    else:
                        self._add_event(
                            migration,
                            item=item,
                            level="warning",
                            message="Strong integrity check is disabled; source deletion relies on md5/size diff only.",
                        )

                    item.step = "delete_source"
                    item.updated_at = utcnow()
                    self._commit()
                    continue

                self._finalize_target_versioning_state(
                    target_ctx.account,
                    item.target_bucket,
                    migration,
                    item,
                )
                item.status = "completed"
                item.step = "completed"
                item.finished_at = utcnow()
                item.updated_at = utcnow()
                self._add_event(migration, item=item, level="info", message="Item completed with clean diff.")
                self._commit()
                return

            if item.step == "delete_source":
                self._set_managed_block_policy(item.source_bucket, source_ctx.account, deny_delete=False)
                self._delete_source_bucket_with_retry(item.source_bucket, source_ctx.account)
                self._finalize_target_versioning_state(
                    target_ctx.account,
                    item.target_bucket,
                    migration,
                    item,
                )
                item.status = "completed"
                item.step = "completed"
                item.finished_at = utcnow()
                item.updated_at = utcnow()
                self._add_event(migration, item=item, level="info", message="Source bucket deleted after clean diff.")
                self._commit()
                return

            if item.step in {"completed", "skipped"}:
                if item.status == "running":
                    item.status = "completed"
                if item.finished_at is None:
                    item.finished_at = utcnow()
                item.updated_at = utcnow()
                self._commit()
                return

            raise RuntimeError(f"Unsupported item step: {item.step}")

    def _copy_bucket_settings(
        self,
        source_account: S3Account,
        source_bucket: str,
        target_account: S3Account,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> None:
        failures: list[str] = []
        strategy = self._item_execution_strategy(item)

        def run_copy_step(step_name: str, action: Callable[[], None], *, message: str) -> None:
            try:
                action()
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{step_name}: {exc}")
                self._add_event(
                    migration,
                    item=item,
                    level="error",
                    message=message,
                    metadata={"error": str(exc), "setting": step_name},
                )

        run_copy_step(
            "versioning",
            lambda: self._buckets.set_versioning(
                target_bucket,
                target_account,
                enabled=(
                    True
                    if strategy == "version_aware"
                    else str(
                        self._buckets.get_bucket_properties(source_bucket, source_account).versioning_status or ""
                    ).strip().lower()
                    == "enabled"
                ),
            ),
            message="Versioning copy failed.",
        )

        def _copy_object_lock() -> None:
            src_object_lock = self._buckets.get_bucket_object_lock(source_bucket, source_account)
            if src_object_lock and (
                src_object_lock.enabled is not None
                or src_object_lock.mode is not None
                or src_object_lock.days is not None
                or src_object_lock.years is not None
            ):
                self._buckets.set_object_lock(target_bucket, target_account, src_object_lock)

        run_copy_step("object_lock", _copy_object_lock, message="Object lock copy failed.")

        def _copy_encryption() -> None:
            encryption = self._buckets.get_bucket_encryption(source_bucket, source_account)
            rules = list(encryption.rules or [])
            if rules:
                self._buckets.set_bucket_encryption(target_bucket, target_account, rules)
            else:
                self._buckets.delete_bucket_encryption(target_bucket, target_account)

        run_copy_step("encryption", _copy_encryption, message="Default bucket encryption copy failed.")
        run_copy_step(
            "public_access_block",
            lambda: self._buckets.set_public_access_block(
                target_bucket,
                target_account,
                self._buckets.get_public_access_block(source_bucket, source_account),
            ),
            message="Public access block copy failed.",
        )

        def _copy_lifecycle() -> None:
            lifecycle = self._buckets.get_lifecycle(source_bucket, source_account)
            rules = lifecycle.rules or []
            if rules:
                self._buckets.set_lifecycle(target_bucket, target_account, rules)
            else:
                self._buckets.delete_lifecycle(target_bucket, target_account)

        run_copy_step("lifecycle", _copy_lifecycle, message="Lifecycle copy failed.")

        def _copy_cors() -> None:
            cors = self._buckets.get_bucket_cors(source_bucket, source_account)
            if cors:
                self._buckets.set_cors(target_bucket, target_account, cors)
            else:
                self._buckets.delete_cors(target_bucket, target_account)

        run_copy_step("cors", _copy_cors, message="CORS copy failed.")

        def _copy_policy() -> None:
            policy = self._buckets.get_policy(source_bucket, source_account)
            if policy:
                self._buckets.put_policy(target_bucket, target_account, policy)
            else:
                self._buckets.delete_policy(target_bucket, target_account)

        run_copy_step("bucket_policy", _copy_policy, message="Policy copy failed.")

        def _copy_tags() -> None:
            tags = self._buckets.get_bucket_tags(source_bucket, source_account)
            if tags:
                self._buckets.set_bucket_tags(
                    target_bucket,
                    target_account,
                    [{"key": tag.key, "value": tag.value} for tag in tags],
                )
            else:
                self._buckets.delete_bucket_tags(target_bucket, target_account)

        run_copy_step("tags", _copy_tags, message="Tags copy failed.")
        run_copy_step(
            "access_logging",
            lambda: self._buckets.set_bucket_logging(
                target_bucket,
                target_account,
                self._buckets.get_bucket_logging(source_bucket, source_account),
            ),
            message="Access logging copy failed.",
        )

        if failures:
            raise RuntimeError(
                "Bucket settings copy failed for supported settings: "
                + "; ".join(failures[:8])
            )

        self._add_event(migration, item=item, level="info", message="Bucket settings copied.")

    def _precheck_can_list_bucket(self, source_ctx: _ResolvedContext, source_bucket: str) -> None:
        client = self._context_client(source_ctx)
        try:
            page = client.list_objects_v2(Bucket=source_bucket, MaxKeys=1)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list source bucket '{source_bucket}': {exc}") from exc

        contents = page.get("Contents", []) or []
        sample_key = contents[0].get("Key") if contents and isinstance(contents[0], dict) else None
        if not isinstance(sample_key, str) or not sample_key:
            return
        try:
            client.head_object(Bucket=source_bucket, Key=sample_key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read sample object '{sample_key}' in source bucket '{source_bucket}': {exc}"
            ) from exc

    def _sample_version_probe_candidate(
        self,
        source_bucket: str,
        *,
        source_profile: Optional[dict[str, Any]] = None,
    ) -> Optional[tuple[str, str]]:
        if not isinstance(source_profile, dict):
            return None
        version_scan = source_profile.get("version_scan")
        if not isinstance(version_scan, dict):
            return None
        sample_version = version_scan.get("sample_version")
        if not isinstance(sample_version, dict):
            return None
        key = str(sample_version.get("key") or "").strip()
        version_id = str(sample_version.get("version_id") or "").strip()
        if not key or not version_id:
            return None
        return key, version_id

    def _precheck_version_aware_source_access(
        self,
        source_ctx: _ResolvedContext,
        source_bucket: str,
        source_profile: Optional[dict[str, Any]],
    ) -> None:
        candidate = self._sample_version_probe_candidate(
            source_bucket,
            source_profile=source_profile,
        )
        if candidate is None:
            return
        sample_key, sample_version_id = candidate
        client = self._context_client(source_ctx)
        try:
            client.head_object(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read sample version '{sample_version_id}' for '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc

        body = None
        try:
            response = client.get_object(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
            body = response.get("Body")
            if body is not None:
                body.read(1)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to stream sample version '{sample_version_id}' for '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

        try:
            client.get_object_tagging(Bucket=source_bucket, Key=sample_key, VersionId=sample_version_id)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read tags for sample version '{sample_version_id}' of '{sample_key}' in source bucket "
                f"'{source_bucket}': {exc}"
            ) from exc

    def _count_bucket_objects(self, ctx: _ResolvedContext, bucket_name: str) -> int:
        client = self._context_client(ctx)
        continuation_token: Optional[str] = None
        total = 0
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to count objects in bucket '{bucket_name}': {exc}") from exc
            contents = page.get("Contents", []) if isinstance(page, dict) else []
            if isinstance(contents, list):
                total += len(contents)
            continuation_token = page.get("NextContinuationToken") if isinstance(page, dict) else None
            if not continuation_token:
                break
        return total

    def _precheck_same_endpoint_copy_source_access(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        *,
        auto_grant: bool,
        strategy: str = "current_only",
        source_profile: Optional[dict[str, Any]] = None,
    ) -> str:
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)

        sample_key: Optional[str] = None
        sample_version_id: Optional[str] = None
        if strategy == "version_aware":
            candidate = self._sample_version_probe_candidate(source_bucket, source_profile=source_profile)
            if candidate is not None:
                sample_key, sample_version_id = candidate

        if not sample_key:
            try:
                page = source_client.list_objects_v2(Bucket=source_bucket, MaxKeys=1)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(
                    f"Unable to list source bucket '{source_bucket}' to validate x-amz-copy-source access: {exc}"
                ) from exc

            contents = page.get("Contents", []) if isinstance(page, dict) else []
            sample_key = contents[0].get("Key") if contents and isinstance(contents[0], dict) else None
            if not isinstance(sample_key, str) or not sample_key:
                version_scan = source_profile.get("version_scan") if isinstance(source_profile, dict) else None
                if (
                    strategy == "version_aware"
                    and isinstance(version_scan, dict)
                    and int(version_scan.get("current_version_count") or 0) == 0
                    and int(version_scan.get("noncurrent_version_count") or 0) == 0
                    and int(version_scan.get("delete_marker_count") or 0) > 0
                ):
                    return "validated"
                return "source_empty"

        head_kwargs: dict[str, Any] = {"Bucket": source_bucket, "Key": sample_key}
        if sample_version_id:
            head_kwargs["VersionId"] = sample_version_id

        try:
            target_client.head_object(**head_kwargs)
            return "validated"
        except (ClientError, BotoCoreError) as exc:
            if self._is_access_denied_error(exc):
                if not auto_grant:
                    permission_hint = "s3:GetObjectVersion" if sample_version_id else "s3:GetObject"
                    raise RuntimeError(
                        "Target context cannot read source objects required for x-amz-copy-source. "
                        f"Grant {permission_hint} on source bucket '{source_bucket}'."
                    ) from exc
                try:
                    with self._temporary_source_copy_grant(
                        source_ctx,
                        target_ctx,
                        source_bucket=source_bucket,
                        sample_key=sample_key,
                        sample_version_id=sample_version_id,
                    ):
                        target_client.head_object(**head_kwargs)
                except Exception as grant_exc:  # noqa: BLE001
                    raise RuntimeError(
                        "Unable to validate temporary same-endpoint source-read grant for x-amz-copy-source: "
                        f"{grant_exc}"
                    ) from grant_exc
                return "validated_with_temporary_grant"
            raise RuntimeError(
                f"Unable to validate target access to sample source object '{sample_key}' in bucket "
                f"'{source_bucket}' for x-amz-copy-source: {exc}"
            ) from exc

    def _source_copy_grant_principal_candidates(self, target_ctx: _ResolvedContext) -> list[str]:
        context_id = (target_ctx.context_id or "").strip()
        if context_id.startswith("conn-"):
            return []

        account = target_ctx.account
        account_id = (getattr(account, "rgw_account_id", None) or "").strip()
        explicit_uid = (getattr(account, "rgw_user_uid", None) or "").strip()
        resolved_uid = (resolve_admin_uid(account_id or None, explicit_uid or None) or "").strip()

        candidates: list[str] = []
        seen: set[str] = set()

        def push(value: Optional[str]) -> None:
            normalized = (value or "").strip()
            if not normalized or normalized in seen:
                return
            seen.add(normalized)
            candidates.append(normalized)

        for uid in (explicit_uid, resolved_uid):
            if not uid:
                continue
            push(uid)
            push(f"arn:aws:iam:::user/{uid}")
            if account_id:
                push(f"arn:aws:iam::{account_id}:user/{uid}")

        if account_id:
            push(account_id)
            push(f"arn:aws:iam::{account_id}:root")

        return candidates

    def _without_managed_source_copy_grant_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        if not isinstance(policy, dict):
            return None

        policy_doc: dict[str, Any] = deepcopy(policy)
        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _SOURCE_COPY_GRANT_POLICY_SID)
        ]
        if not filtered_statements:
            return None

        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _build_source_copy_grant_policy(
        self,
        source_bucket: str,
        existing_policy: Optional[dict[str, Any]],
        *,
        principal: str,
    ) -> dict[str, Any]:
        base_policy = self._without_managed_source_copy_grant_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        statements.append(
            {
                "Sid": _SOURCE_COPY_GRANT_POLICY_SID,
                "Effect": "Allow",
                "Principal": {"AWS": principal},
                "Action": [
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                ],
                "Resource": [f"arn:aws:s3:::{source_bucket}/*"],
            }
        )
        policy_doc["Statement"] = statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _restore_source_copy_grant_policy(
        self,
        source_bucket: str,
        source_account: S3Account,
        backup_policy: Optional[dict[str, Any]],
    ) -> None:
        restored = self._without_managed_source_copy_grant_statement(backup_policy)
        if isinstance(restored, dict):
            self._buckets.put_policy(source_bucket, source_account, restored)
            return
        self._buckets.delete_policy(source_bucket, source_account)

    @contextmanager
    def _temporary_source_copy_grant(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        sample_key: Optional[str] = None,
        sample_version_id: Optional[str] = None,
    ):
        source_account = source_ctx.account
        target_client = self._context_client(target_ctx)
        try:
            backup_policy = self._buckets.get_policy(source_bucket, source_account)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to read source bucket policy for temporary source-read grant. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise
        candidates = self._source_copy_grant_principal_candidates(target_ctx)
        if not candidates:
            raise RuntimeError(
                "Target context identity is not supported for temporary source-read grant. "
                "Use an account/s3_user target context or grant source read permissions manually."
            )

        selected_principal: Optional[str] = None
        last_access_error: Optional[Exception] = None
        for candidate in candidates:
            policy_doc = self._build_source_copy_grant_policy(
                source_bucket,
                backup_policy if isinstance(backup_policy, dict) else None,
                principal=candidate,
            )
            try:
                self._buckets.put_policy(source_bucket, source_account, policy_doc)
            except RuntimeError as exc:
                if self._is_access_denied_error(exc):
                    raise RuntimeError(
                        "Unable to apply temporary source-read grant: access denied on source bucket policy update. "
                        f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                    ) from exc
                raise
            if not sample_key:
                selected_principal = candidate
                break
            try:
                head_kwargs: dict[str, Any] = {"Bucket": source_bucket, "Key": sample_key}
                if sample_version_id:
                    head_kwargs["VersionId"] = sample_version_id
                target_client.head_object(**head_kwargs)
                selected_principal = candidate
                break
            except (ClientError, BotoCoreError) as exc:
                if self._is_access_denied_error(exc):
                    last_access_error = exc
                    continue
                raise RuntimeError(
                    f"Unable to validate temporary source-read grant on sample object '{sample_key}': {exc}"
                ) from exc

        if selected_principal is None:
            try:
                self._restore_source_copy_grant_policy(source_bucket, source_account, backup_policy)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Unable to restore source policy after unsuccessful temporary source-read grant attempts: bucket=%s",
                    source_bucket,
                )
            if last_access_error is not None:
                raise RuntimeError(
                    f"Temporary source-read grant could not be validated for bucket '{source_bucket}': {last_access_error}"
                ) from last_access_error
            raise RuntimeError(
                "Unable to determine a compatible target principal for temporary source-read grant."
            )

        try:
            yield selected_principal
        finally:
            try:
                self._restore_source_copy_grant_policy(source_bucket, source_account, backup_policy)
            except RuntimeError as exc:
                if self._is_access_denied_error(exc):
                    raise RuntimeError(
                        "Unable to restore source bucket policy after temporary source-read grant. "
                        f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                    ) from exc
                raise

    def _precheck_bucket_exists(self, target_ctx: _ResolvedContext, target_bucket: str) -> Optional[bool]:
        client = self._context_client(target_ctx)
        try:
            client.head_bucket(Bucket=target_bucket)
            return True
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
            status_code = (
                int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
                if hasattr(exc, "response")
                else 0
            )
            if code in {"nosuchbucket", "notfound"} or status_code == 404:
                return False
            if code in {"forbidden", "accessdenied"} or status_code == 403:
                # Some S3 implementations deny HeadBucket even for owned buckets.
                try:
                    listing = client.list_buckets()
                    buckets = listing.get("Buckets", []) or []
                    names = {entry.get("Name") for entry in buckets if isinstance(entry, dict)}
                    if target_bucket in names:
                        return True
                except (ClientError, BotoCoreError):
                    return None
                return False
            raise RuntimeError(f"Unable to check bucket '{target_bucket}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to check bucket '{target_bucket}': {exc}") from exc

    def _next_step_after_target_setup(self, migration: BucketMigration, item: BucketMigrationItem) -> str:
        if migration.lock_target_writes and not item.target_lock_applied:
            return "apply_target_lock"
        if migration.mode == "pre_sync" and not item.pre_sync_done:
            return "pre_sync"
        return "apply_read_only"

    def _precheck_target_lock_roundtrip(self, target_ctx: _ResolvedContext, target_bucket: str) -> None:
        try:
            existing_policy = self._buckets.get_policy(target_bucket, target_ctx.account)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to read destination bucket policy during precheck. "
                    f"Required permissions on '{target_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

        lock_policy_doc = self._build_target_write_lock_policy(
            target_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._buckets.put_policy(target_bucket, target_ctx.account, lock_policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to apply destination write-lock policy during precheck. "
                    f"Required permissions on '{target_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

        lock_test_error: Optional[Exception] = None
        try:
            self._validate_target_lock_worker_access(target_ctx, target_bucket)
        except Exception as exc:  # noqa: BLE001
            lock_test_error = exc

        restore_error: Optional[Exception] = None
        try:
            restored = self._without_managed_target_write_lock_statement(existing_policy)
            if isinstance(restored, dict):
                self._buckets.put_policy(target_bucket, target_ctx.account, restored)
            else:
                self._buckets.delete_policy(target_bucket, target_ctx.account)
        except Exception as exc:  # noqa: BLE001
            restore_error = exc

        if lock_test_error is not None:
            raise RuntimeError(
                "Destination write-lock policy denied migration write/delete operations. "
                "Use a dedicated migration context or disable destination lock. "
                f"Underlying error: {lock_test_error}"
            ) from lock_test_error
        if restore_error is not None:
            raise RuntimeError(
                f"Unable to restore destination bucket policy after write-lock precheck on '{target_bucket}': {restore_error}"
            ) from restore_error

    def _precheck_target_lock_with_probe_bucket(self, target_ctx: _ResolvedContext, *, migration_id: int) -> None:
        probe_bucket = f"s3-manager-mig-precheck-{migration_id}-{uuid.uuid4().hex[:12]}"
        try:
            self._buckets.create_bucket(
                probe_bucket,
                target_ctx.account,
                versioning=False,
                location_constraint=target_ctx.region,
                object_lock_enabled=False,
            )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "Unable to create temporary destination bucket for target write-lock precheck: "
                f"{exc}"
            ) from exc

        roundtrip_error: Optional[Exception] = None
        try:
            self._precheck_target_lock_roundtrip(target_ctx, probe_bucket)
        except Exception as exc:  # noqa: BLE001
            roundtrip_error = exc

        cleanup_error: Optional[Exception] = None
        try:
            self._buckets.delete_bucket(probe_bucket, target_ctx.account, force=True)
        except Exception as exc:  # noqa: BLE001
            cleanup_error = exc

        if roundtrip_error is not None and cleanup_error is not None:
            raise RuntimeError(
                "Target write-lock precheck failed and temporary probe cleanup also failed: "
                f"precheck={roundtrip_error}; cleanup={cleanup_error}"
            ) from roundtrip_error
        if cleanup_error is not None:
            raise RuntimeError(
                "Target write-lock precheck cleanup failed on temporary probe bucket: "
                f"{cleanup_error}"
            ) from cleanup_error
        if roundtrip_error is not None:
            raise RuntimeError(f"{roundtrip_error}") from roundtrip_error

    def _build_read_only_policy(
        self,
        source_bucket: str,
        existing_policy: Optional[dict[str, Any]],
        *,
        deny_delete: bool = True,
    ) -> dict[str, Any]:
        base_policy = self._without_managed_read_only_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _READ_ONLY_POLICY_SID)
        ]
        actions = [
            # Object write operations that can introduce source/target drift.
            "s3:PutObject",
            "s3:PutObjectAcl",
            "s3:PutObjectTagging",
            "s3:PutObjectVersionAcl",
            "s3:PutObjectVersionTagging",
            "s3:PutObjectLegalHold",
            "s3:PutObjectRetention",
            "s3:AbortMultipartUpload",
            "s3:RestoreObject",
        ]
        resources: list[str] = [f"arn:aws:s3:::{source_bucket}/*"]

        if deny_delete:
            actions.extend(
                [
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:DeleteObjectTagging",
                    "s3:DeleteObjectVersionTagging",
                    "s3:DeleteBucket",
                ]
            )
            resources.append(f"arn:aws:s3:::{source_bucket}")

        filtered_statements.append(
            {
                "Sid": _READ_ONLY_POLICY_SID,
                "Effect": "Deny",
                "Principal": "*",
                "Action": actions,
                "Resource": resources,
            }
        )
        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _build_target_write_lock_policy(
        self,
        target_bucket: str,
        existing_policy: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        base_policy = self._without_managed_target_write_lock_statement(existing_policy)
        if isinstance(base_policy, dict):
            policy_doc: dict[str, Any] = deepcopy(base_policy)
        else:
            policy_doc = {"Version": "2012-10-17", "Statement": []}

        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _TARGET_WRITE_LOCK_POLICY_SID)
        ]
        filtered_statements.append(
            {
                "Sid": _TARGET_WRITE_LOCK_POLICY_SID,
                "Effect": "Deny",
                "Principal": "*",
                "Action": [
                    "s3:PutObject",
                    "s3:PutObjectAcl",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionAcl",
                    "s3:PutObjectVersionTagging",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:AbortMultipartUpload",
                    "s3:RestoreObject",
                    "s3:DeleteObject",
                    "s3:DeleteObjectVersion",
                    "s3:DeleteObjectTagging",
                    "s3:DeleteObjectVersionTagging",
                    "s3:DeleteBucket",
                ],
                "Resource": [
                    f"arn:aws:s3:::{target_bucket}/*",
                    f"arn:aws:s3:::{target_bucket}",
                ],
                "Condition": {
                    "StringNotLike": {
                        "aws:UserAgent": f"*{_MIGRATION_USER_AGENT_MARKER}*",
                    }
                },
            }
        )
        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _size_only_common_keys(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
        *,
        limit: int = 20,
    ) -> tuple[int, list[str]]:
        keys = self._size_only_common_key_list(source_objects, target_objects)
        return len(keys), keys[:limit]

    def _size_only_common_key_list(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
    ) -> list[str]:
        keys: list[str] = []
        for key in sorted(set(source_objects.keys()) & set(target_objects.keys())):
            comparison = compare_object_entries(source_objects[key], target_objects[key], md5_resolver=self._etag_md5)
            if comparison.compare_by == "md5":
                continue
            if not comparison.equal:
                continue
            keys.append(key)
        return keys

    def _strong_verify_size_only_objects(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        keys: list[str],
        parallelism_max: int,
        control_check: Callable[[], str],
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> tuple[int, list[str], dict[str, int]]:
        if not keys:
            return 0, [], {"head_checksum": 0, "stream_sha256": 0}

        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        thread_local = threading.local()

        def _verify_worker(key: str) -> tuple[bool, str]:
            resolved_source_client = getattr(thread_local, "source_client", None)
            if resolved_source_client is None:
                resolved_source_client = source_client or self._context_client(source_ctx)
                thread_local.source_client = resolved_source_client
            resolved_target_client = getattr(thread_local, "target_client", None)
            if resolved_target_client is None:
                resolved_target_client = target_client or self._context_client(target_ctx)
                thread_local.target_client = resolved_target_client
            return self._strong_verify_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                key,
                source_client=resolved_source_client,
                target_client=resolved_target_client,
            )

        for chunk in _chunked(keys, worker_count):
            state = control_check()
            if state == "lost_lease":
                raise _WorkerLeaseLostError("Worker lease lost while strong-verifying objects")
            if state in {"pause", "cancel"}:
                return -1, [], method_counts

            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-strong-verify") as executor:
                futures = {
                    executor.submit(_verify_worker, key): key
                    for key in chunk
                }
                interrupted_state: Optional[str] = None
                pending = set(futures.keys())
                while pending:
                    done, pending = wait(pending, timeout=1.0)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state

                    for future in done:
                        key = futures[future]
                        try:
                            verified, method = future.result()
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("Strong verification failed for '%s': %s", key, exc)
                            failed_keys.append(key)
                            continue
                        method_counts[method] = method_counts.get(method, 0) + 1
                        if verified:
                            verified_count += 1
                        else:
                            failed_keys.append(key)

                if interrupted_state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while strong-verifying objects")
                if interrupted_state in {"pause", "cancel"}:
                    return -1, [], method_counts
        return verified_count, failed_keys, method_counts

    def _strong_verify_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        key: str,
        *,
        source_version_id: Optional[str] = None,
        target_version_id: Optional[str] = None,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> tuple[bool, str]:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)

        source_checksums = self._head_object_checksums(
            resolved_source_client,
            source_bucket,
            key,
            version_id=source_version_id,
        )
        target_checksums = self._head_object_checksums(
            resolved_target_client,
            target_bucket,
            key,
            version_id=target_version_id,
        )
        shared_checksum_fields = (
            "ChecksumSHA256",
            "ChecksumCRC32C",
            "ChecksumCRC32",
            "ChecksumSHA1",
        )
        for field in shared_checksum_fields:
            source_value = source_checksums.get(field)
            target_value = target_checksums.get(field)
            if source_value and target_value:
                return source_value == target_value, "head_checksum"

        source_sha256 = self._stream_object_sha256(
            resolved_source_client,
            source_bucket,
            key,
            version_id=source_version_id,
        )
        target_sha256 = self._stream_object_sha256(
            resolved_target_client,
            target_bucket,
            key,
            version_id=target_version_id,
        )
        return source_sha256 == target_sha256, "stream_sha256"

    def _head_object_checksums(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> dict[str, str]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to read object metadata for '{key}' in bucket '{bucket_name}': {exc}") from exc

        result: dict[str, str] = {}
        for field in ("ChecksumSHA256", "ChecksumCRC32C", "ChecksumCRC32", "ChecksumSHA1"):
            value = response.get(field) if isinstance(response, dict) else None
            if isinstance(value, str) and value.strip():
                result[field] = value.strip()
        return result

    def _stream_object_sha256(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> str:
        body = None
        hasher = hashlib.sha256()
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.get_object(**kwargs)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("response body is empty")
            while True:
                chunk = body.read(8 * 1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(f"Unable to compute SHA-256 for '{key}' in bucket '{bucket_name}': {exc}") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass
        return hasher.hexdigest()

    def _without_managed_read_only_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        if not isinstance(policy, dict):
            return None

        policy_doc: dict[str, Any] = deepcopy(policy)
        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _READ_ONLY_POLICY_SID)
        ]
        if not filtered_statements:
            return None

        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _without_managed_target_write_lock_statement(self, policy: Any) -> Optional[dict[str, Any]]:
        if not isinstance(policy, dict):
            return None

        policy_doc: dict[str, Any] = deepcopy(policy)
        statements = policy_doc.get("Statement")
        if isinstance(statements, dict):
            statements = [statements]
        if not isinstance(statements, list):
            statements = []

        filtered_statements = [
            statement
            for statement in statements
            if not (isinstance(statement, dict) and statement.get("Sid") == _TARGET_WRITE_LOCK_POLICY_SID)
        ]
        if not filtered_statements:
            return None

        policy_doc["Statement"] = filtered_statements
        if "Version" not in policy_doc:
            policy_doc["Version"] = "2012-10-17"
        return policy_doc

    def _remove_managed_read_only_statement(self, source_bucket: str, source_account: S3Account) -> None:
        existing_policy = self._buckets.get_policy(source_bucket, source_account)
        cleaned = self._without_managed_read_only_statement(existing_policy)
        if isinstance(cleaned, dict):
            self._buckets.put_policy(source_bucket, source_account, cleaned)
            return
        self._buckets.delete_policy(source_bucket, source_account)

    def _remove_managed_target_write_lock_statement(self, target_bucket: str, target_account: S3Account) -> None:
        existing_policy = self._buckets.get_policy(target_bucket, target_account)
        cleaned = self._without_managed_target_write_lock_statement(existing_policy)
        if isinstance(cleaned, dict):
            self._buckets.put_policy(target_bucket, target_account, cleaned)
            return
        self._buckets.delete_policy(target_bucket, target_account)

    def _set_managed_block_policy(self, source_bucket: str, source_account: S3Account, *, deny_delete: bool) -> None:
        try:
            existing_policy = self._buckets.get_policy(source_bucket, source_account)
            policy_doc = self._build_read_only_policy(
                source_bucket,
                existing_policy if isinstance(existing_policy, dict) else None,
                deny_delete=deny_delete,
            )
            self._buckets.put_policy(source_bucket, source_account, policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                mode = "read-only" if deny_delete else "write-block"
                raise RuntimeError(
                    f"Unable to set source bucket to {mode}: access denied on bucket policy update. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

    def _delete_source_bucket_with_retry(self, source_bucket: str, source_account: S3Account) -> None:
        last_exc: Optional[RuntimeError] = None
        for attempt in range(1, 4):
            try:
                self._buckets.delete_bucket(source_bucket, source_account, force=True)
                return
            except RuntimeError as exc:
                last_exc = exc
                if not self._is_access_denied_error(exc) or attempt == 3:
                    raise
                logger.warning(
                    "Delete source bucket got AccessDenied (bucket=%s, attempt=%s/3), retrying.",
                    source_bucket,
                    attempt,
                )
                # Policy propagation may lag briefly on some S3 implementations.
                time.sleep(0.8 * attempt)
        if last_exc is not None:
            raise last_exc

    def _precheck_policy_roundtrip(self, source_account: S3Account, source_bucket: str) -> None:
        try:
            existing_policy = self._buckets.get_policy(source_bucket, source_account)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to read source bucket policy during precheck. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

        policy_doc = self._build_read_only_policy(
            source_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )

        try:
            self._buckets.put_policy(source_bucket, source_account, policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to apply read-only policy during precheck. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

        try:
            restored = self._without_managed_read_only_statement(existing_policy)
            if isinstance(restored, dict):
                self._buckets.put_policy(source_bucket, source_account, restored)
            else:
                self._buckets.delete_policy(source_bucket, source_account)
        except RuntimeError as exc:
            raise RuntimeError(
                f"Unable to restore source bucket policy after precheck on '{source_bucket}': {exc}"
            ) from exc

    def _apply_read_only_policy(self, source_account: S3Account, source_bucket: str, item: BucketMigrationItem) -> None:
        existing_policy = self._buckets.get_policy(source_bucket, source_account)
        item.source_policy_backup_json = _json_dumps(existing_policy)
        policy_doc = self._build_read_only_policy(
            source_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._buckets.put_policy(source_bucket, source_account, policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to set source bucket to read-only: access denied on PutBucketPolicy. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

    def _validate_target_lock_worker_access(self, target_ctx: _ResolvedContext, target_bucket: str) -> None:
        client = self._context_client(target_ctx)
        test_key = f"__s3-manager-migration-lock-check/{uuid.uuid4().hex}"
        try:
            client.put_object(Bucket=target_bucket, Key=test_key, Body=b"lock-check")
            client.delete_object(Bucket=target_bucket, Key=test_key)
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                "Destination write-lock blocks migration worker write/delete operations. "
                "Use a dedicated migration context or disable destination lock."
            ) from exc

    def _apply_target_write_lock_policy(self, target_ctx: _ResolvedContext, target_bucket: str, item: BucketMigrationItem) -> None:
        existing_policy = self._buckets.get_policy(target_bucket, target_ctx.account)
        item.target_policy_backup_json = _json_dumps(existing_policy)
        lock_policy_doc = self._build_target_write_lock_policy(
            target_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._buckets.put_policy(target_bucket, target_ctx.account, lock_policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to set destination bucket write-lock: access denied on PutBucketPolicy. "
                    f"Required permissions on '{target_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise
        self._validate_target_lock_worker_access(target_ctx, target_bucket)

    def _restore_target_write_lock_policy(self, target_account: S3Account, target_bucket: str, item: BucketMigrationItem) -> None:
        backup = _json_loads(item.target_policy_backup_json)
        if isinstance(backup, dict):
            self._buckets.put_policy(target_bucket, target_account, backup)
            return
        self._buckets.delete_policy(target_bucket, target_account)

    def _restore_source_policy(self, source_bucket: str, source_account: S3Account, item: BucketMigrationItem) -> None:
        backup = _json_loads(item.source_policy_backup_json)
        if isinstance(backup, dict):
            self._buckets.put_policy(source_bucket, source_account, backup)
            return
        self._buckets.delete_policy(source_bucket, source_account)

    def _sync_bucket(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        allow_delete: bool,
        parallelism_max: int,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> tuple[int, int, _SyncDiff]:
        if self._item_execution_strategy(item) == "version_aware":
            return self._sync_bucket_version_aware(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                allow_delete=allow_delete,
                parallelism_max=parallelism_max,
                migration=migration,
                item=item,
                control_check=control_check,
            )

        diff = self._new_empty_sync_diff()
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        same_endpoint_copy = bool(same_endpoint and migration.use_same_endpoint_copy)
        pending_copied = 0
        pending_deleted = 0
        last_progress_flush = time.monotonic()
        copied = 0
        deleted = 0
        copy_batch: list[str] = []
        delete_batch: list[str] = []
        scan_count_since_control = 0
        worker_count = max(1, int(parallelism_max))
        action_batch_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)

        def flush_progress(*, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted, last_progress_flush
            now = time.monotonic()
            total_pending = pending_copied + pending_deleted
            if total_pending <= 0:
                return

            should_flush = force
            if not should_flush:
                if total_pending >= _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD:
                    should_flush = True
                elif (now - last_progress_flush) >= _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS:
                    should_flush = True
            if not should_flush:
                return

            item.objects_copied = int(item.objects_copied or 0) + int(pending_copied)
            item.objects_deleted = int(item.objects_deleted or 0) + int(pending_deleted)
            heartbeat_at = utcnow()
            item.updated_at = heartbeat_at
            migration.updated_at = heartbeat_at
            migration.last_heartbeat_at = heartbeat_at
            self._commit()
            pending_copied = 0
            pending_deleted = 0
            last_progress_flush = now

        def on_object_progress(*, copied_inc: int = 0, deleted_inc: int = 0, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted
            if copied_inc > 0:
                pending_copied += int(copied_inc)
            if deleted_inc > 0:
                pending_deleted += int(deleted_inc)
            flush_progress(force=force)

        def check_control_state(*, force_flush: bool) -> str:
            state = control_check()
            if state == "lost_lease":
                if force_flush:
                    on_object_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while processing bucket diff")
            if state in {"pause", "cancel"} and force_flush:
                on_object_progress(force=True)
            return state

        def flush_copy_batch() -> bool:
            nonlocal copied, copy_batch
            if not copy_batch:
                return True
            copied_now = self._run_copy_actions(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                copy_batch,
                parallelism_max=parallelism_max,
                same_endpoint=same_endpoint_copy,
                control_check=control_check,
                on_progress=on_object_progress,
            )
            copy_batch = []
            if copied_now < 0:
                return False
            copied += copied_now
            return True

        def flush_delete_batch() -> bool:
            nonlocal deleted, delete_batch
            if not delete_batch:
                return True
            deleted_now = self._run_delete_actions(
                target_ctx,
                target_bucket,
                delete_batch,
                parallelism_max=parallelism_max,
                control_check=control_check,
                on_progress=on_object_progress,
            )
            delete_batch = []
            if deleted_now < 0:
                return False
            deleted += deleted_now
            return True

        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)

        with ExitStack() as copy_grant_stack:
            copy_grant_enabled = False
            for entry in self._iter_bucket_diff_entries(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                source_client=source_client,
                target_client=target_client,
            ):
                scan_count_since_control += 1
                if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                    state = check_control_state(force_flush=True)
                    if state in {"pause", "cancel"}:
                        return -1, -1, diff
                    scan_count_since_control = 0

                copy_required = False
                delete_required = False
                if entry.kind == "only_source":
                    diff.source_count += 1
                    diff.only_source_count += 1
                    if len(diff.sample["only_source_sample"]) < 200:
                        diff.sample["only_source_sample"].append(entry.key)
                    copy_required = True
                elif entry.kind == "only_target":
                    diff.target_count += 1
                    diff.only_target_count += 1
                    if len(diff.sample["only_target_sample"]) < 200:
                        diff.sample["only_target_sample"].append(entry.key)
                    delete_required = allow_delete
                elif entry.kind == "matched":
                    diff.source_count += 1
                    diff.target_count += 1
                    diff.matched_count += 1
                elif entry.kind == "different":
                    diff.source_count += 1
                    diff.target_count += 1
                    diff.different_count += 1
                    if len(diff.sample["different_sample"]) < 200:
                        diff.sample["different_sample"].append(
                            {
                                "key": entry.key,
                                "source_size": entry.source_size,
                                "target_size": entry.target_size,
                                "source_etag": entry.source_etag,
                                "target_etag": entry.target_etag,
                                "compare_by": entry.compare_by,
                            }
                        )
                    copy_required = True

                if copy_required:
                    if same_endpoint_copy and bool(migration.auto_grant_source_read_for_copy) and not copy_grant_enabled:
                        copy_grant_stack.enter_context(
                            self._temporary_source_copy_grant(
                                source_ctx,
                                target_ctx,
                                source_bucket=source_bucket,
                                sample_key=entry.key,
                            )
                        )
                        copy_grant_enabled = True
                    copy_batch.append(entry.key)
                    if len(copy_batch) >= action_batch_size:
                        state = check_control_state(force_flush=True)
                        if state in {"pause", "cancel"}:
                            return -1, -1, diff
                        if not flush_copy_batch():
                            return -1, -1, diff

                if delete_required:
                    delete_batch.append(entry.key)
                    if len(delete_batch) >= action_batch_size:
                        state = check_control_state(force_flush=True)
                        if state in {"pause", "cancel"}:
                            return -1, -1, diff
                        if not flush_delete_batch():
                            return -1, -1, diff

            state = check_control_state(force_flush=True)
            if state in {"pause", "cancel"}:
                return -1, -1, diff
            if not flush_copy_batch():
                return -1, -1, diff
            if not flush_delete_batch():
                return -1, -1, diff

        if copied == 0 and deleted == 0:
            return 0, 0, diff

        on_object_progress(force=True)
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": copied,
                "deleted": deleted,
                "allow_delete": allow_delete,
                "same_endpoint_copy": same_endpoint_copy,
            },
        )
        self._commit()
        return copied, deleted, diff

    def _sync_bucket_version_aware(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        allow_delete: bool,
        parallelism_max: int,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> tuple[int, int, _SyncDiff]:
        del allow_delete, parallelism_max
        same_endpoint_copy = bool(self._is_same_endpoint(source_ctx, target_ctx) and migration.use_same_endpoint_copy)
        pending_copied = 0
        pending_deleted = 0
        last_progress_flush = time.monotonic()

        def flush_progress(*, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted, last_progress_flush
            now = time.monotonic()
            total_pending = pending_copied + pending_deleted
            if total_pending <= 0:
                return
            should_flush = force
            if not should_flush:
                if total_pending >= _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD:
                    should_flush = True
                elif (now - last_progress_flush) >= _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS:
                    should_flush = True
            if not should_flush:
                return
            item.objects_copied = int(item.objects_copied or 0) + int(pending_copied)
            item.objects_deleted = int(item.objects_deleted or 0) + int(pending_deleted)
            heartbeat_at = utcnow()
            item.updated_at = heartbeat_at
            migration.updated_at = heartbeat_at
            migration.last_heartbeat_at = heartbeat_at
            self._commit()
            pending_copied = 0
            pending_deleted = 0
            last_progress_flush = now

        def on_object_progress(*, copied_inc: int = 0, deleted_inc: int = 0, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted
            if copied_inc > 0:
                pending_copied += int(copied_inc)
            if deleted_inc > 0:
                pending_deleted += int(deleted_inc)
            flush_progress(force=force)

        replication_state = self._load_item_replication_state(item)
        watermark = replication_state.get("pre_sync_watermark") if isinstance(replication_state.get("pre_sync_watermark"), dict) else None
        purge_before_replay = False
        replay_mode = "one_shot_full"

        if migration.mode == "pre_sync" and not item.pre_sync_done:
            purge_before_replay = True
            replay_mode = "pre_sync_full"
            replication_state.pop("cutover_attempted", None)
        elif migration.mode == "pre_sync" and item.pre_sync_done and item.read_only_applied:
            if not isinstance(watermark, dict):
                purge_before_replay = True
                replay_mode = "cutover_full_missing_watermark"
            elif bool(replication_state.get("cutover_attempted")):
                purge_before_replay = True
                replay_mode = "cutover_full_retry"
                watermark = None
            else:
                replay_mode = "cutover_delta"
                replication_state["cutover_attempted"] = True
                self._store_item_replication_state(item, replication_state)
                item.updated_at = utcnow()
                self._commit()
        else:
            purge_before_replay = True
            replay_mode = "one_shot_full"

        self._buckets.set_versioning(target_bucket, target_ctx.account, enabled=True)

        deleted = 0
        if purge_before_replay:
            purged_current, purged_versions = self._purge_target_bucket(target_ctx, target_bucket)
            deleted = purged_current + purged_versions
            if deleted > 0:
                on_object_progress(deleted_inc=deleted, force=True)

        source_profile = _json_loads(item.source_snapshot_json)
        copied = 0
        replayed_entries: list[_BucketVersionEntry] = []

        with ExitStack() as copy_grant_stack:
            if same_endpoint_copy and bool(migration.auto_grant_source_read_for_copy):
                candidate = self._sample_version_probe_candidate(
                    source_bucket,
                    source_profile=source_profile if isinstance(source_profile, dict) else None,
                )
                if candidate is not None:
                    sample_key, sample_version_id = candidate
                    copy_grant_stack.enter_context(
                        self._temporary_source_copy_grant(
                            source_ctx,
                            target_ctx,
                            source_bucket=source_bucket,
                            sample_key=sample_key,
                            sample_version_id=sample_version_id,
                        )
                    )

            copied, replayed_entries = self._replay_bucket_versions(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                same_endpoint_copy=same_endpoint_copy,
                watermark=watermark,
                control_check=control_check,
                on_progress=on_object_progress,
            )
        if copied < 0:
            return -1, -1, self._new_empty_sync_diff()

        if replay_mode == "pre_sync_full":
            replication_state["pre_sync_watermark"] = self._build_version_replay_watermark(replayed_entries)
            replication_state["cutover_attempted"] = False
            self._store_item_replication_state(item, replication_state)
        on_object_progress(force=True)

        compared = self._compare_versioned_timelines(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            control_check=control_check,
        )
        if compared is None:
            return -1, -1, self._new_empty_sync_diff()
        diff = self._version_aware_diff_to_sync_diff(compared)

        self._add_event(
            migration,
            item=item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": copied,
                "deleted": deleted,
                "same_endpoint_copy": same_endpoint_copy,
                "replay_mode": replay_mode,
                "version_aware": True,
            },
        )
        self._commit()
        return copied, deleted, diff

    def _replay_bucket_versions(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        same_endpoint_copy: bool,
        watermark: Optional[dict[str, Any]],
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> tuple[int, list[_BucketVersionEntry]]:
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        copied = 0
        replayed_entries: list[_BucketVersionEntry] = []
        scan_count_since_control = 0

        for _key, timeline in self._iter_bucket_version_timelines(source_ctx, source_bucket, client=source_client):
            for entry in timeline:
                scan_count_since_control += 1
                if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                    state = control_check()
                    if state == "lost_lease":
                        if on_progress is not None:
                            on_progress(force=True)
                        raise _WorkerLeaseLostError("Worker lease lost while replaying bucket versions")
                    if state in {"pause", "cancel"}:
                        if on_progress is not None:
                            on_progress(force=True)
                        return -1, []
                    scan_count_since_control = 0

                if watermark is not None and not self._entry_is_after_watermark(entry, watermark):
                    continue

                if entry.is_delete_marker:
                    self._replay_delete_marker(target_client, target_bucket, entry.key)
                else:
                    self._copy_single_object_version(
                        source_ctx,
                        target_ctx,
                        source_bucket=source_bucket,
                        target_bucket=target_bucket,
                        key=entry.key,
                        version_id=entry.version_id,
                        same_endpoint=same_endpoint_copy,
                        source_client=source_client,
                        target_client=target_client,
                    )
                copied += 1
                replayed_entries.append(entry)
                if on_progress is not None:
                    on_progress(copied_inc=1)

        if on_progress is not None:
            on_progress(force=True)
        return copied, replayed_entries

    def _replay_delete_marker(self, target_client: Any, target_bucket: str, key: str) -> None:
        try:
            target_client.delete_object(Bucket=target_bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to recreate delete marker for '{key}' in bucket '{target_bucket}': {exc}"
            ) from exc

    def _version_aware_diff_to_sync_diff(self, diff: _VersionAwareDiff) -> _SyncDiff:
        return _SyncDiff(
            copy_keys=[],
            delete_keys=[],
            source_count=diff.source_count,
            target_count=diff.target_count,
            matched_count=diff.matched_count,
            different_count=diff.different_count,
            only_source_count=diff.only_source_count,
            only_target_count=diff.only_target_count,
            sample=diff.sample,
        )

    def _new_empty_sync_diff(self) -> _SyncDiff:
        return _SyncDiff(
            copy_keys=[],
            delete_keys=[],
            source_count=0,
            target_count=0,
            matched_count=0,
            different_count=0,
            only_source_count=0,
            only_target_count=0,
            sample={
                "only_source_sample": [],
                "only_target_sample": [],
                "different_sample": [],
            },
        )

    def _load_version_timeline_map(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        control_check: Callable[[], str],
        client: Optional[Any] = None,
    ) -> Optional[dict[str, list[_BucketVersionEntry]]]:
        resolved_client = client or self._context_client(ctx)
        timelines: dict[str, list[_BucketVersionEntry]] = {}
        scanned_keys = 0
        for key, timeline in self._iter_bucket_version_timelines(ctx, bucket_name, client=resolved_client):
            scanned_keys += 1
            if scanned_keys % 200 == 0:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while loading version timelines")
                if state in {"pause", "cancel"}:
                    return None
            timelines[key] = list(timeline)
        return timelines

    def _timeline_has_current_object(self, timeline: list[_BucketVersionEntry]) -> bool:
        return bool(timeline) and not bool(timeline[-1].is_delete_marker)

    def _compare_versioned_timelines(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        control_check: Callable[[], str],
    ) -> Optional[_VersionAwareDiff]:
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        source_timelines = self._load_version_timeline_map(
            source_ctx,
            source_bucket,
            control_check=control_check,
            client=source_client,
        )
        if source_timelines is None:
            return None
        target_timelines = self._load_version_timeline_map(
            target_ctx,
            target_bucket,
            control_check=control_check,
            client=target_client,
        )
        if target_timelines is None:
            return None

        source_count = sum(1 for timeline in source_timelines.values() if self._timeline_has_current_object(timeline))
        target_count = sum(1 for timeline in target_timelines.values() if self._timeline_has_current_object(timeline))
        matched_count = 0
        different_count = 0
        only_source_count = 0
        only_target_count = 0
        size_only_pairs: list[_VersionTimelineDiffKey] = []
        sample = {
            "only_source_sample": [],
            "only_target_sample": [],
            "different_sample": [],
        }
        source_details_cache: dict[tuple[str, str], _VersionedObjectDetails] = {}
        target_details_cache: dict[tuple[str, str], _VersionedObjectDetails] = {}

        for index, key in enumerate(sorted(set(source_timelines.keys()) | set(target_timelines.keys())), start=1):
            if index % 200 == 0:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while comparing version-aware timelines")
                if state in {"pause", "cancel"}:
                    return None

            source_timeline = source_timelines.get(key)
            target_timeline = target_timelines.get(key)
            if source_timeline is None:
                only_target_count += 1
                if len(sample["only_target_sample"]) < 200:
                    sample["only_target_sample"].append(key)
                continue
            if target_timeline is None:
                only_source_count += 1
                if len(sample["only_source_sample"]) < 200:
                    sample["only_source_sample"].append(key)
                continue

            equal_timeline = True
            first_difference: Optional[dict[str, Any]] = None
            local_size_only_pairs: list[_VersionTimelineDiffKey] = []

            if len(source_timeline) != len(target_timeline):
                equal_timeline = False
                first_difference = {
                    "key": key,
                    "reason": "timeline_length_mismatch",
                    "source_entries": len(source_timeline),
                    "target_entries": len(target_timeline),
                }
            else:
                for source_entry, target_entry in zip(source_timeline, target_timeline):
                    if bool(source_entry.is_delete_marker) != bool(target_entry.is_delete_marker):
                        equal_timeline = False
                        first_difference = {
                            "key": key,
                            "reason": "entry_kind_mismatch",
                            "source_kind": "delete_marker" if source_entry.is_delete_marker else "object",
                            "target_kind": "delete_marker" if target_entry.is_delete_marker else "object",
                        }
                        break
                    if source_entry.is_delete_marker:
                        continue

                    source_cache_key = (key, source_entry.version_id)
                    target_cache_key = (key, target_entry.version_id)
                    source_details = source_details_cache.get(source_cache_key)
                    if source_details is None:
                        source_details = self._versioned_object_details(
                            source_client,
                            source_bucket,
                            key,
                            version_id=source_entry.version_id,
                        )
                        source_details_cache[source_cache_key] = source_details
                    target_details = target_details_cache.get(target_cache_key)
                    if target_details is None:
                        target_details = self._versioned_object_details(
                            target_client,
                            target_bucket,
                            key,
                            version_id=target_entry.version_id,
                        )
                        target_details_cache[target_cache_key] = target_details

                    equal, compare_by, reason = self._compare_versioned_object_details(source_details, target_details)
                    if not equal:
                        equal_timeline = False
                        first_difference = {
                            "key": key,
                            "reason": reason or "object_mismatch",
                            "compare_by": compare_by,
                            "source_size": source_details.size,
                            "target_size": target_details.size,
                            "source_etag": source_details.etag,
                            "target_etag": target_details.etag,
                        }
                        break
                    if compare_by == "size":
                        local_size_only_pairs.append(
                            _VersionTimelineDiffKey(
                                key=key,
                                source_version_id=source_entry.version_id,
                                target_version_id=target_entry.version_id,
                            )
                        )

            if equal_timeline:
                matched_count += 1
                size_only_pairs.extend(local_size_only_pairs)
                continue

            different_count += 1
            if first_difference is not None and len(sample["different_sample"]) < 200:
                sample["different_sample"].append(first_difference)

        return _VersionAwareDiff(
            source_count=source_count,
            target_count=target_count,
            matched_count=matched_count,
            different_count=different_count,
            only_source_count=only_source_count,
            only_target_count=only_target_count,
            sample=sample,
            size_only_pairs=tuple(size_only_pairs),
        )

    def _compare_buckets_version_aware(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        control_check: Callable[[], str],
    ) -> Optional[_SyncDiff]:
        compared = self._compare_versioned_timelines(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            control_check=control_check,
        )
        if compared is None:
            return None
        return self._version_aware_diff_to_sync_diff(compared)

    def _compare_buckets_streamed(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        control_check: Callable[[], str],
    ) -> Optional[_SyncDiff]:
        return self._verifier.compare_buckets_streamed(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            strategy=strategy,
            control_check=control_check,
        )

    def _compare_buckets_streamed_impl(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        control_check: Callable[[], str],
    ) -> Optional[_SyncDiff]:
        if strategy == "version_aware":
            return self._compare_buckets_version_aware(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                control_check=control_check,
            )
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        diff = self._new_empty_sync_diff()
        scan_count_since_control = 0

        for entry in self._iter_bucket_diff_entries(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            source_client=source_client,
            target_client=target_client,
        ):
            scan_count_since_control += 1
            if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while comparing bucket content")
                if state in {"pause", "cancel"}:
                    return None
                scan_count_since_control = 0

            if entry.kind == "only_source":
                diff.source_count += 1
                diff.only_source_count += 1
                if len(diff.sample["only_source_sample"]) < 200:
                    diff.sample["only_source_sample"].append(entry.key)
                continue
            if entry.kind == "only_target":
                diff.target_count += 1
                diff.only_target_count += 1
                if len(diff.sample["only_target_sample"]) < 200:
                    diff.sample["only_target_sample"].append(entry.key)
                continue
            if entry.kind == "matched":
                diff.source_count += 1
                diff.target_count += 1
                diff.matched_count += 1
                continue
            if entry.kind == "different":
                diff.source_count += 1
                diff.target_count += 1
                diff.different_count += 1
                if len(diff.sample["different_sample"]) < 200:
                    diff.sample["different_sample"].append(
                        {
                            "key": entry.key,
                            "source_size": entry.source_size,
                            "target_size": entry.target_size,
                            "source_etag": entry.source_etag,
                            "target_etag": entry.target_etag,
                            "compare_by": entry.compare_by,
                        }
                    )

        return diff

    def _strong_verify_size_only_candidates_streamed(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        parallelism_max: int,
        control_check: Callable[[], str],
    ) -> tuple[int, int, list[str], dict[str, int]]:
        return self._verifier.strong_verify_size_only_candidates_streamed(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            strategy=strategy,
            parallelism_max=parallelism_max,
            control_check=control_check,
        )

    def _strong_verify_size_only_candidates_streamed_impl(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        parallelism_max: int,
        control_check: Callable[[], str],
    ) -> tuple[int, int, list[str], dict[str, int]]:
        if strategy == "version_aware":
            return self._strong_verify_version_aware_candidates(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                parallelism_max=parallelism_max,
                control_check=control_check,
            )
        worker_count = max(1, int(parallelism_max))
        batch_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        size_only_count = 0
        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        size_only_batch: list[str] = []
        scan_count_since_control = 0
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)

        def merge_method_counts(local_counts: dict[str, int]) -> None:
            for method, count in local_counts.items():
                method_counts[method] = method_counts.get(method, 0) + int(count or 0)

        def flush_batch() -> bool:
            nonlocal verified_count, size_only_batch
            if not size_only_batch:
                return True
            verified_now, failed_now, method_counts_now = self._strong_verify_size_only_objects(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                keys=size_only_batch,
                parallelism_max=worker_count,
                control_check=control_check,
                source_client=source_client,
                target_client=target_client,
            )
            size_only_batch = []
            if verified_now < 0:
                return False
            verified_count += verified_now
            failed_keys.extend(failed_now)
            merge_method_counts(method_counts_now)
            return True

        for entry in self._iter_bucket_diff_entries(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            source_client=source_client,
            target_client=target_client,
        ):
            scan_count_since_control += 1
            if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while collecting strong-verification candidates")
                if state in {"pause", "cancel"}:
                    return -1, 0, [], method_counts
                scan_count_since_control = 0

            if entry.kind != "matched" or entry.compare_by != "size":
                continue
            size_only_count += 1
            size_only_batch.append(entry.key)
            if len(size_only_batch) < batch_size:
                continue
            if not flush_batch():
                return -1, 0, [], method_counts

        if not flush_batch():
            return -1, 0, [], method_counts
        return size_only_count, verified_count, failed_keys, method_counts

    def _strong_verify_version_aware_candidates(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        parallelism_max: int,
        control_check: Callable[[], str],
    ) -> tuple[int, int, list[str], dict[str, int]]:
        compared = self._compare_versioned_timelines(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            control_check=control_check,
        )
        if compared is None:
            return -1, 0, [], {"head_checksum": 0, "stream_sha256": 0}

        pairs = list(compared.size_only_pairs)
        if not pairs:
            return 0, 0, [], {"head_checksum": 0, "stream_sha256": 0}

        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        worker_count = max(1, min(int(parallelism_max), len(pairs)))
        thread_local = threading.local()

        def _verify_worker(pair: _VersionTimelineDiffKey) -> tuple[str, bool, str]:
            resolved_source_client = getattr(thread_local, "source_client", None)
            if resolved_source_client is None:
                resolved_source_client = self._context_client(source_ctx)
                thread_local.source_client = resolved_source_client
            resolved_target_client = getattr(thread_local, "target_client", None)
            if resolved_target_client is None:
                resolved_target_client = self._context_client(target_ctx)
                thread_local.target_client = resolved_target_client
            verified, method = self._strong_verify_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                pair.key,
                source_version_id=pair.source_version_id,
                target_version_id=pair.target_version_id,
                source_client=resolved_source_client,
                target_client=resolved_target_client,
            )
            return pair.key, verified, method

        for chunk in _chunked(pairs, worker_count):
            state = control_check()
            if state == "lost_lease":
                raise _WorkerLeaseLostError("Worker lease lost while strong-verifying version-aware objects")
            if state in {"pause", "cancel"}:
                return -1, 0, [], method_counts

            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-version-verify") as executor:
                futures = {
                    executor.submit(_verify_worker, pair): pair
                    for pair in chunk
                }
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=1.0)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state

                    for future in done:
                        pair = futures[future]
                        try:
                            key, verified, method = future.result()
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("Version-aware strong verification failed: %s", exc)
                            failed_keys.append(pair.key)
                            continue
                        method_counts[method] = method_counts.get(method, 0) + 1
                        if verified:
                            verified_count += 1
                        else:
                            failed_keys.append(key)

                if interrupted_state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while strong-verifying version-aware objects")
                if interrupted_state in {"pause", "cancel"}:
                    return -1, 0, [], method_counts

        return len(pairs), verified_count, failed_keys, method_counts

    def _iter_bucket_diff_entries(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        source_client: Optional[Any] = None,
        target_client: Optional[Any] = None,
    ):
        source_iter = iter(self._iter_bucket_objects(source_ctx, source_bucket, client=source_client))
        target_iter = iter(self._iter_bucket_objects(target_ctx, target_bucket, client=target_client))
        source_entry = next(source_iter, None)
        target_entry = next(target_iter, None)

        while source_entry is not None or target_entry is not None:
            if source_entry is not None and (
                target_entry is None or source_entry.key < target_entry.key
            ):
                yield _BucketDiffEntry(
                    kind="only_source",
                    key=source_entry.key,
                    source_size=source_entry.size,
                    target_size=0,
                    source_etag=source_entry.etag,
                    target_etag=None,
                    compare_by="presence",
                )
                source_entry = next(source_iter, None)
                continue

            if target_entry is not None and (
                source_entry is None or target_entry.key < source_entry.key
            ):
                yield _BucketDiffEntry(
                    kind="only_target",
                    key=target_entry.key,
                    source_size=0,
                    target_size=target_entry.size,
                    source_etag=None,
                    target_etag=target_entry.etag,
                    compare_by="presence",
                )
                target_entry = next(target_iter, None)
                continue

            if source_entry is None or target_entry is None:
                break
            key = source_entry.key
            source_size = source_entry.size
            target_size = target_entry.size
            source_etag = source_entry.etag
            target_etag = target_entry.etag
            source_md5 = self._etag_md5(source_etag)
            target_md5 = self._etag_md5(target_etag)
            if source_md5 and target_md5:
                compare_by = "md5"
                equal = source_md5 == target_md5
            else:
                compare_by = "size"
                equal = source_size == target_size
            yield _BucketDiffEntry(
                kind="matched" if equal else "different",
                key=key,
                source_size=source_size,
                target_size=target_size,
                source_etag=source_etag,
                target_etag=target_etag,
                compare_by=compare_by,
            )
            source_entry = next(source_iter, None)
            target_entry = next(target_iter, None)

    def _run_copy_actions(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        same_endpoint: bool,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        copied = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _copy_worker(key: str) -> None:
            source_client = getattr(thread_local, "source_client", None)
            if source_client is None:
                source_client = self._context_client(source_ctx)
                thread_local.source_client = source_client
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._copy_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                key,
                same_endpoint,
                source_client=source_client,
                target_client=target_client,
            )

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while copying objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-copy") as executor:
                futures = {executor.submit(_copy_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        copied += 1
                        if on_progress is not None:
                            on_progress(copied_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while copying objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return copied

    def _run_delete_actions(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        deleted = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _delete_worker(key: str) -> None:
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._delete_single_object(target_ctx, target_bucket, key, target_client=target_client)

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-delete") as executor:
                futures = {executor.submit(_delete_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        deleted += 1
                        if on_progress is not None:
                            on_progress(deleted_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return deleted

    def _copy_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        key: str,
        same_endpoint: bool,
        *,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        if same_endpoint:
            copy_source = {"Bucket": source_bucket, "Key": key}
            try:
                head = self._head_object_with_version(
                    resolved_source_client,
                    source_bucket,
                    key,
                    version_id=None,
                )
                kwargs: dict[str, Any] = {
                    "Bucket": target_bucket,
                    "Key": key,
                    "CopySource": copy_source,
                    "MetadataDirective": "COPY",
                    "TaggingDirective": "COPY",
                }
                storage_class = head.get("StorageClass")
                if isinstance(storage_class, str) and storage_class.strip():
                    kwargs["StorageClass"] = storage_class.strip()
                resolved_target_client.copy_object(**kwargs)
                return
            except (ClientError, BotoCoreError) as exc:
                if not self._is_access_denied_error(exc):
                    raise RuntimeError(f"Unable to copy object '{key}' with x-amz-copy-source: {exc}") from exc
                logger.warning(
                    "CopyObject with x-amz-copy-source denied for '%s' (%s), falling back to stream-copy.",
                    key,
                    exc,
                )
                self._stream_copy_single_object(
                    source_ctx,
                    target_ctx,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    key=key,
                    source_client=resolved_source_client,
                    target_client=resolved_target_client,
                )
                return

        self._stream_copy_single_object(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            key=key,
            source_client=resolved_source_client,
            target_client=resolved_target_client,
        )

    def _copy_single_object_version(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        version_id: str,
        same_endpoint: bool,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        if same_endpoint:
            copy_source = {"Bucket": source_bucket, "Key": key, "VersionId": version_id}
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            kwargs: dict[str, Any] = {
                "Bucket": target_bucket,
                "Key": key,
                "CopySource": copy_source,
                "MetadataDirective": "COPY",
                "TaggingDirective": "COPY",
            }
            storage_class = head.get("StorageClass")
            if isinstance(storage_class, str) and storage_class.strip():
                kwargs["StorageClass"] = storage_class.strip()
            try:
                resolved_target_client.copy_object(**kwargs)
                return
            except (ClientError, BotoCoreError) as exc:
                if not self._is_access_denied_error(exc):
                    raise RuntimeError(
                        f"Unable to copy object version '{version_id}' for '{key}' with x-amz-copy-source: {exc}"
                    ) from exc
                logger.warning(
                    "CopyObject with x-amz-copy-source denied for version '%s' of '%s' (%s), "
                    "falling back to stream-copy.",
                    version_id,
                    key,
                    exc,
                )

        self._stream_copy_single_object_version(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            key=key,
            version_id=version_id,
            source_client=resolved_source_client,
            target_client=resolved_target_client,
        )

    def _build_upload_extra_args(
        self,
        *,
        head: dict[str, Any],
        tags: tuple[tuple[str, str], ...],
    ) -> dict[str, Any]:
        extra_args: dict[str, Any] = {}
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        if metadata:
            extra_args["Metadata"] = {
                str(meta_key): str(meta_value)
                for meta_key, meta_value in metadata.items()
                if meta_key is not None and meta_value is not None
            }
        for head_field, extra_arg_field in (
            ("ContentType", "ContentType"),
            ("CacheControl", "CacheControl"),
            ("ContentDisposition", "ContentDisposition"),
            ("ContentEncoding", "ContentEncoding"),
            ("ContentLanguage", "ContentLanguage"),
            ("Expires", "Expires"),
            ("StorageClass", "StorageClass"),
        ):
            value = head.get(head_field)
            if value is not None:
                extra_args[extra_arg_field] = value
        if tags:
            extra_args["Tagging"] = urlencode({tag_key: tag_value for tag_key, tag_value in tags})
        return extra_args

    def _stream_copy_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        body = None
        try:
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=None,
            )
            tags = self._get_object_tags_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=None,
            )
            response = resolved_source_client.get_object(Bucket=source_bucket, Key=key)
            body = response.get("Body")
            extra_args = self._build_upload_extra_args(head=head, tags=tags)
            if extra_args:
                resolved_target_client.upload_fileobj(body, target_bucket, key, ExtraArgs=extra_args)
            else:
                resolved_target_client.upload_fileobj(body, target_bucket, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to stream-copy object '{key}': {exc}") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

    def _stream_copy_single_object_version(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        version_id: str,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        body = None
        try:
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            tags = self._get_object_tags_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            response = resolved_source_client.get_object(
                Bucket=source_bucket,
                Key=key,
                VersionId=version_id,
            )
            body = response.get("Body")
            extra_args = self._build_upload_extra_args(head=head, tags=tags)
            if extra_args:
                resolved_target_client.upload_fileobj(body, target_bucket, key, ExtraArgs=extra_args)
            else:
                resolved_target_client.upload_fileobj(body, target_bucket, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to stream-copy object version '{version_id}' for '{key}': {exc}"
            ) from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

    def _delete_single_object(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        key: str,
        *,
        target_client: Any | None = None,
    ) -> None:
        client = target_client or self._context_client(target_ctx)
        try:
            client.delete_object(Bucket=target_bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete target object '{key}': {exc}") from exc

    def _delete_objects_batch(self, client: Any, bucket_name: str, objects: list[dict[str, str]]) -> int:
        if not objects:
            return 0
        try:
            return _delete_objects_count(client, bucket_name, objects)
        except RuntimeError:
            raise
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc

    def _purge_target_bucket(self, target_ctx: _ResolvedContext, target_bucket: str) -> tuple[int, int]:
        client = self._context_client(target_ctx)
        deleted_current = 0
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": target_bucket, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**kwargs)
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
                if code in {"nosuchbucket", "notfound"}:
                    return deleted_current, 0
                raise RuntimeError(f"Unable to list target bucket '{target_bucket}' for rollback: {exc}") from exc
            except BotoCoreError as exc:
                raise RuntimeError(f"Unable to list target bucket '{target_bucket}' for rollback: {exc}") from exc
            objects = [{"Key": entry.get("Key")} for entry in (page.get("Contents", []) or []) if entry.get("Key")]
            deleted_current += self._delete_objects_batch(client, target_bucket, objects)
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

        deleted_versions = 0
        key_marker: Optional[str] = None
        version_marker: Optional[str] = None
        while True:
            list_kwargs: dict[str, Any] = {"Bucket": target_bucket}
            if key_marker:
                list_kwargs["KeyMarker"] = key_marker
            if version_marker:
                list_kwargs["VersionIdMarker"] = version_marker
            try:
                page = client.list_object_versions(**list_kwargs)
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
                if code in {"nosuchbucket", "nosuchversion", "notfound"}:
                    break
                raise RuntimeError(f"Unable to list target versions in bucket '{target_bucket}' for rollback: {exc}") from exc
            except BotoCoreError as exc:
                raise RuntimeError(f"Unable to list target versions in bucket '{target_bucket}' for rollback: {exc}") from exc
            version_objects: list[dict[str, str]] = []
            for entry in page.get("Versions", []) or []:
                key = entry.get("Key")
                version_id = entry.get("VersionId")
                if key and version_id:
                    version_objects.append({"Key": key, "VersionId": version_id})
            for entry in page.get("DeleteMarkers", []) or []:
                key = entry.get("Key")
                version_id = entry.get("VersionId")
                if key and version_id:
                    version_objects.append({"Key": key, "VersionId": version_id})
            deleted_versions += self._delete_objects_batch(client, target_bucket, version_objects)
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

        return deleted_current, deleted_versions

    def _is_bucket_already_exists_error(self, exc: Exception) -> bool:
        text = str(exc).strip().lower()
        return any(
            marker in text
            for marker in (
                "bucketalreadyexists",
                "bucketalreadyownedbyyou",
                "bucket already exists",
                "already owned by you",
            )
        )

    def _is_access_denied_error(self, exc: Exception) -> bool:
        text = str(exc).strip().lower()
        return "accessdenied" in text or "access denied" in text or "403" in text

    def _context_client(self, ctx: _ResolvedContext):
        access_key, secret_key = ctx.account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError(f"Context '{ctx.context_id}' has no credentials")
        token = ctx.account.session_token()
        return get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=ctx.endpoint,
            session_token=token,
            region=ctx.region,
            force_path_style=ctx.force_path_style,
            verify_tls=ctx.verify_tls,
            user_agent_extra=_MIGRATION_USER_AGENT_MARKER,
        )

    def _load_runtime_limits(self) -> _MigrationRuntimeLimits:
        env_parallelism_max = max(1, min(int(settings.bucket_migration_parallelism_max or 1), 128))
        env_parallelism_default = env_parallelism_max
        env_max_active = max(1, min(int(settings.bucket_migration_max_active_per_endpoint or 1), 64))

        try:
            manager = load_app_settings().manager
            parallelism_max = max(
                1,
                min(int(manager.bucket_migration_parallelism_max or env_parallelism_max), 128),
            )
            parallelism_default = max(
                1,
                min(int(manager.bucket_migration_parallelism_default or parallelism_max), parallelism_max),
            )
            max_active = max(
                1,
                min(int(manager.bucket_migration_max_active_per_endpoint or env_max_active), 64),
            )
            return _MigrationRuntimeLimits(
                parallelism_default=parallelism_default,
                parallelism_max=parallelism_max,
                max_active_per_endpoint=max_active,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Unable to load app settings for bucket migration runtime limits, falling back to environment values."
            )
            return _MigrationRuntimeLimits(
                parallelism_default=env_parallelism_default,
                parallelism_max=env_parallelism_max,
                max_active_per_endpoint=env_max_active,
            )

    def _resolve_context(self, context_id: str) -> _ResolvedContext:
        account = self._context_to_account(context_id)
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        endpoint = normalize_s3_endpoint(endpoint)
        return _ResolvedContext(
            context_id=context_id,
            account=account,
            endpoint=endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
        )

    def _context_to_account(self, context_id: str) -> S3Account:
        value = (context_id or "").strip()
        if not value:
            raise ValueError("Invalid context id")

        if value.startswith("conn-"):
            suffix = value.split("conn-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid connection context id")
            conn = self.db.query(S3Connection).filter(S3Connection.id == int(suffix)).first()
            if not conn:
                raise ValueError("S3Connection not found")
            account = S3Account(
                name=conn.name,
                rgw_account_id=None,
                email=None,
                rgw_user_uid=None,
            )
            account.id = -(1_000_000 + conn.id)
            account.rgw_access_key = conn.access_key_id
            account.rgw_secret_key = conn.secret_access_key
            account.storage_endpoint_id = conn.storage_endpoint_id
            endpoint_url, region, force_path_style, verify_tls = resolve_connection_endpoint(conn)
            account.storage_endpoint_url = endpoint_url  # type: ignore[attr-defined]
            account._session_region = region  # type: ignore[attr-defined]
            account._session_force_path_style = force_path_style  # type: ignore[attr-defined]
            account._session_verify_tls = verify_tls  # type: ignore[attr-defined]
            account._session_token = conn.session_token  # type: ignore[attr-defined]
            if conn.storage_endpoint is not None:
                account.storage_endpoint = conn.storage_endpoint
            return account

        if value.startswith("s3u-"):
            suffix = value.split("s3u-", 1)[1]
            if not suffix.isdigit():
                raise ValueError("Invalid S3 user context id")
            s3_user = self.db.query(S3User).filter(S3User.id == int(suffix)).first()
            if not s3_user:
                raise ValueError("S3 user not found")
            account = S3Account(
                name=s3_user.name,
                rgw_account_id=None,
                email=s3_user.email,
                rgw_user_uid=s3_user.rgw_user_uid,
            )
            account.id = -(100_000 + s3_user.id)
            account.rgw_access_key = s3_user.rgw_access_key
            account.rgw_secret_key = s3_user.rgw_secret_key
            account.storage_endpoint_id = s3_user.storage_endpoint_id
            account.storage_endpoint = s3_user.storage_endpoint
            account.set_session_credentials(s3_user.rgw_access_key, s3_user.rgw_secret_key)
            return account

        if not value.isdigit():
            raise ValueError("Invalid account context id")
        account = self.db.query(S3Account).filter(S3Account.id == int(value)).first()
        if not account:
            raise ValueError("S3 account not found")
        return account

    def _iter_bucket_objects(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = resolved_client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list objects in bucket '{bucket_name}': {exc}") from exc
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                etag_raw = entry.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                yield _BucketObjectEntry(
                    key=key,
                    size=int(entry.get("Size") or 0),
                    etag=etag or None,
                )
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

    def _normalize_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return datetime.fromtimestamp(0, tz=timezone.utc)

    def _stable_datetime_string(self, value: Any) -> Optional[str]:
        if not isinstance(value, datetime):
            return None
        return self._normalize_datetime(value).isoformat()

    def _version_group_sort_key(self, entry: _BucketVersionEntry) -> tuple[str, float, int]:
        return (
            entry.key,
            -self._normalize_datetime(entry.last_modified).timestamp(),
            entry.order_index,
        )

    def _version_replay_sort_key(self, entry: _BucketVersionEntry) -> tuple[float, int, int]:
        # list_object_versions returns reverse-chronological entries within a key,
        # while replay/verification needs oldest -> newest. When a backend rounds
        # several recreated entries to the same second, keep objects before delete
        # markers and reverse the order_index tie-breaker so versions replay in
        # their original logical order within the timestamp group.
        return (
            self._normalize_datetime(entry.last_modified).timestamp(),
            1 if entry.is_delete_marker else 0,
            -entry.order_index,
        )

    def _iter_bucket_version_timelines(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        key_marker: Optional[str] = None
        version_marker: Optional[str] = None
        order_index = 0
        buffered_key: Optional[str] = None
        buffered_entries: list[_BucketVersionEntry] = []

        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name}
            if key_marker:
                kwargs["KeyMarker"] = key_marker
            if version_marker:
                kwargs["VersionIdMarker"] = version_marker
            try:
                page = resolved_client.list_object_versions(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list object versions in bucket '{bucket_name}': {exc}") from exc

            page_entries: list[_BucketVersionEntry] = []
            for raw in page.get("Versions", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                etag_raw = raw.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=False,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=int(raw.get("Size") or 0),
                        etag=etag or None,
                        storage_class=raw.get("StorageClass"),
                        order_index=order_index,
                    )
                )
                order_index += 1
            for raw in page.get("DeleteMarkers", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=True,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=0,
                        etag=None,
                        storage_class=None,
                        order_index=order_index,
                    )
                )
                order_index += 1

            for entry in sorted(page_entries, key=self._version_group_sort_key):
                if buffered_key is None:
                    buffered_key = entry.key
                if entry.key != buffered_key:
                    yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)
                    buffered_key = entry.key
                    buffered_entries = []
                buffered_entries.append(entry)

            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

        if buffered_key is not None:
            yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)

    def _version_watermark_signature(self, entry: _BucketVersionEntry) -> tuple[str, str, bool]:
        return (entry.key, entry.version_id, bool(entry.is_delete_marker))

    def _build_version_replay_watermark(self, entries: list[_BucketVersionEntry]) -> Optional[dict[str, Any]]:
        if not entries:
            return None
        latest_dt = max(self._normalize_datetime(entry.last_modified) for entry in entries)
        tie_entries = [
            {
                "key": entry.key,
                "version_id": entry.version_id,
                "is_delete_marker": bool(entry.is_delete_marker),
            }
            for entry in entries
            if self._normalize_datetime(entry.last_modified) == latest_dt
        ]
        return {
            "last_modified": latest_dt.isoformat(),
            "tie_entries": tie_entries,
        }

    def _entry_is_after_watermark(self, entry: _BucketVersionEntry, watermark: Optional[dict[str, Any]]) -> bool:
        if not isinstance(watermark, dict):
            return True
        raw_last_modified = watermark.get("last_modified")
        if not isinstance(raw_last_modified, str) or not raw_last_modified.strip():
            return True
        try:
            normalized_watermark = self._normalize_datetime(datetime.fromisoformat(raw_last_modified))
        except ValueError:
            return True
        entry_dt = self._normalize_datetime(entry.last_modified)
        if entry_dt > normalized_watermark:
            return True
        if entry_dt < normalized_watermark:
            return False
        tie_entries = watermark.get("tie_entries") if isinstance(watermark.get("tie_entries"), list) else []
        tie_set = {
            (
                str(raw.get("key") or ""),
                str(raw.get("version_id") or ""),
                bool(raw.get("is_delete_marker")),
            )
            for raw in tie_entries
            if isinstance(raw, dict)
        }
        return self._version_watermark_signature(entry) not in tie_set

    def _head_object_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read metadata for '{key}' in bucket '{bucket_name}': {exc}"
            ) from exc
        return response if isinstance(response, dict) else {}

    def _get_object_tags_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> tuple[tuple[str, str], ...]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.get_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch tags for '{key}' in bucket '{bucket_name}': {exc}") from exc
        tagset = response.get("TagSet") if isinstance(response, dict) else []
        tags: list[tuple[str, str]] = []
        for raw in tagset or []:
            key_value = str(raw.get("Key") or "").strip()
            if not key_value:
                continue
            tags.append((key_value, str(raw.get("Value") or "")))
        return tuple(sorted(tags))

    def _checksums_from_head_response(self, response: dict[str, Any]) -> dict[str, str]:
        checksums: dict[str, str] = {}
        for field in _VERSION_CHECKSUM_FIELDS:
            value = response.get(field)
            if isinstance(value, str) and value.strip():
                checksums[field] = value.strip()
        return checksums

    def _versioned_object_details(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str],
    ) -> _VersionedObjectDetails:
        head = self._head_object_with_version(client, bucket_name, key, version_id=version_id)
        checksums = self._checksums_from_head_response(head)
        etag_raw = head.get("ETag")
        etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
        shared_checksum_compare = next((field for field in _VERSION_CHECKSUM_FIELDS if field in checksums), None)
        compare_by = shared_checksum_compare.lower() if shared_checksum_compare else (
            "md5" if self._etag_md5(etag) else "size"
        )
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        return _VersionedObjectDetails(
            size=int(head.get("ContentLength") or 0),
            etag=etag or None,
            compare_by=compare_by,
            checksums=checksums,
            content_type=head.get("ContentType"),
            cache_control=head.get("CacheControl"),
            content_disposition=head.get("ContentDisposition"),
            content_encoding=head.get("ContentEncoding"),
            content_language=head.get("ContentLanguage"),
            expires=self._stable_datetime_string(head.get("Expires")),
            storage_class=head.get("StorageClass"),
            metadata={str(key): str(value) for key, value in metadata.items() if key is not None and value is not None},
            tags=self._get_object_tags_with_version(client, bucket_name, key, version_id=version_id),
        )

    def _compare_versioned_object_details(
        self,
        source_details: _VersionedObjectDetails,
        target_details: _VersionedObjectDetails,
    ) -> tuple[bool, str, Optional[str]]:
        for field in _VERSION_CHECKSUM_FIELDS:
            source_value = source_details.checksums.get(field)
            target_value = target_details.checksums.get(field)
            if source_value and target_value:
                if source_value != target_value:
                    return False, field.lower(), f"{field.lower()}_mismatch"
                compare_by = field.lower()
                break
        else:
            source_md5 = self._etag_md5(source_details.etag)
            target_md5 = self._etag_md5(target_details.etag)
            if source_md5 and target_md5:
                compare_by = "md5"
                if source_md5 != target_md5:
                    return False, compare_by, "md5_mismatch"
            else:
                compare_by = "size"
                if source_details.size != target_details.size:
                    return False, compare_by, "size_mismatch"

        comparisons = (
            ("content_type", source_details.content_type, target_details.content_type),
            ("cache_control", source_details.cache_control, target_details.cache_control),
            ("content_disposition", source_details.content_disposition, target_details.content_disposition),
            ("content_encoding", source_details.content_encoding, target_details.content_encoding),
            ("content_language", source_details.content_language, target_details.content_language),
            ("expires", source_details.expires, target_details.expires),
            ("storage_class", source_details.storage_class, target_details.storage_class),
            ("metadata", source_details.metadata, target_details.metadata),
            ("tags", source_details.tags, target_details.tags),
        )
        for field_name, source_value, target_value in comparisons:
            if source_value != target_value:
                return False, compare_by, f"{field_name}_mismatch"
        return True, compare_by, None

    def _source_versioning_status_from_item(self, item: BucketMigrationItem) -> Optional[str]:
        source_snapshot = _json_loads(item.source_snapshot_json)
        if not isinstance(source_snapshot, dict):
            return None
        versioning = source_snapshot.get("versioning")
        if not isinstance(versioning, dict):
            return None
        status = str(versioning.get("status") or "").strip()
        return status or None

    def _needs_target_versioning_finalization(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> bool:
        if self._item_execution_strategy(item) != "version_aware":
            return False
        if not bool(migration.copy_bucket_settings):
            return False
        return str(self._source_versioning_status_from_item(item) or "").strip().lower() == "suspended"

    def _finalize_target_versioning_state(
        self,
        target_account: S3Account,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> None:
        if not self._needs_target_versioning_finalization(migration, item):
            return
        replication_state = self._load_item_replication_state(item)
        if replication_state.get("target_versioning_finalized") == "suspended":
            return
        self._buckets.set_versioning(target_bucket, target_account, enabled=False)
        replication_state["target_versioning_finalized"] = "suspended"
        self._store_item_replication_state(item, replication_state)
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target bucket versioning finalized to match suspended source state.",
        )

    def _list_current_objects(self, ctx: _ResolvedContext, bucket_name: str) -> dict[str, dict[str, Any]]:
        objects_by_key: dict[str, dict[str, Any]] = {}
        for entry in self._iter_bucket_objects(ctx, bucket_name):
            objects_by_key[entry.key] = {"size": entry.size, "etag": entry.etag}
        return objects_by_key

    def _compute_sync_diff(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
        *,
        allow_delete: bool,
    ) -> _SyncDiff:
        source_keys = set(source_objects.keys())
        target_keys = set(target_objects.keys())
        only_source = sorted(source_keys - target_keys)
        only_target = sorted(target_keys - source_keys)
        common_keys = sorted(source_keys & target_keys)

        copy_keys: list[str] = list(only_source)
        matched_count = 0
        different_count = 0

        different_sample: list[dict[str, Any]] = []
        for key in common_keys:
            comparison = compare_object_entries(source_objects[key], target_objects[key], md5_resolver=self._etag_md5)
            if comparison.equal:
                matched_count += 1
                continue

            different_count += 1
            copy_keys.append(key)
            if len(different_sample) < 200:
                different_sample.append(
                    {
                        "key": key,
                        "source_size": comparison.source_size,
                        "target_size": comparison.target_size,
                        "source_etag": comparison.source_etag,
                        "target_etag": comparison.target_etag,
                        "compare_by": comparison.compare_by,
                    }
                )

        delete_keys = sorted(only_target) if allow_delete else []
        sample = {
            "only_source_sample": only_source[:200],
            "only_target_sample": only_target[:200],
            "different_sample": different_sample,
        }

        return _SyncDiff(
            copy_keys=sorted(copy_keys),
            delete_keys=delete_keys,
            source_count=len(source_keys),
            target_count=len(target_keys),
            matched_count=matched_count,
            different_count=different_count,
            only_source_count=len(only_source),
            only_target_count=len(only_target),
            sample=sample,
        )

    def _etag_md5(self, etag: Optional[str]) -> Optional[str]:
        if not etag:
            return None
        value = etag.strip().strip('"')
        if not value:
            return None
        if re.fullmatch(r"[0-9a-fA-F]{32}", value):
            return value.lower()
        return None

    def _is_same_endpoint(self, source_ctx: _ResolvedContext, target_ctx: _ResolvedContext) -> bool:
        source_endpoint = normalize_s3_endpoint(source_ctx.endpoint)
        target_endpoint = normalize_s3_endpoint(target_ctx.endpoint)
        return bool(source_endpoint and target_endpoint and source_endpoint == target_endpoint)

    def _active_endpoint_usage(self, *, now) -> dict[str, int]:
        usage: dict[str, int] = {}
        cache: dict[str, str] = {}
        rows = (
            self.db.query(BucketMigration.source_context_id, BucketMigration.target_context_id)
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .all()
        )
        for row in rows:
            for key in self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            ):
                usage[key] = usage.get(key, 0) + 1
        return usage

    def _claimed_migration_within_endpoint_limit(
        self,
        migration_id: int,
        *,
        endpoint_keys: set[str],
        max_active_per_endpoint: int,
        now,
        cache: dict[str, str],
    ) -> bool:
        if not endpoint_keys:
            return True
        allowed_per_endpoint = max(1, int(max_active_per_endpoint))
        rows = (
            self.db.query(
                BucketMigration.id,
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            )
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .order_by(BucketMigration.created_at.asc(), BucketMigration.id.asc())
            .all()
        )
        ranked_by_endpoint: dict[str, list[int]] = {}
        for row in rows:
            row_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            )
            for key in row_keys:
                ranked_by_endpoint.setdefault(key, []).append(int(row.id))
        for key in endpoint_keys:
            ranked_ids = ranked_by_endpoint.get(key, [])
            if migration_id not in ranked_ids:
                return False
            if ranked_ids.index(migration_id) >= allowed_per_endpoint:
                return False
        return True

    def _endpoint_keys_for_contexts(
        self,
        source_context_id: str,
        target_context_id: str,
        *,
        cache: dict[str, str],
    ) -> set[str]:
        source_key = self._context_endpoint_capacity_key(source_context_id, cache=cache)
        target_key = self._context_endpoint_capacity_key(target_context_id, cache=cache)
        keys = {source_key, target_key}
        return {key for key in keys if key}

    def _context_endpoint_capacity_key(self, context_id: str, *, cache: dict[str, str]) -> str:
        normalized_context_id = (context_id or "").strip()
        if not normalized_context_id:
            return "context:unknown"
        cached = cache.get(normalized_context_id)
        if cached is not None:
            return cached
        endpoint_key = f"context:{normalized_context_id}"
        try:
            ctx = self._resolve_context(normalized_context_id)
            endpoint = normalize_s3_endpoint(ctx.endpoint)
            if endpoint:
                endpoint_key = f"endpoint:{endpoint}"
        except Exception:
            logger.debug(
                "Unable to resolve endpoint for migration context '%s' while evaluating endpoint limits.",
                normalized_context_id,
                exc_info=True,
            )
        cache[normalized_context_id] = endpoint_key
        return endpoint_key

    def _find_migration_item(self, migration: BucketMigration, item_id: int) -> BucketMigrationItem:
        for item in migration.items:
            if item.id == item_id:
                return item
        raise ValueError("Migration item not found")

    def _ensure_manual_item_operation_allowed(self, migration: BucketMigration) -> None:
        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            raise ValueError("Bucket-level actions are not available while migration is active")

    def _retry_step_for_failed_item(self, item: BucketMigrationItem) -> str:
        if item.step in {"verify", "rollback_failed"}:
            return "sync"
        return item.step or "create_bucket"

    def _prepare_item_retry(self, migration: BucketMigration, item: BucketMigrationItem) -> None:
        item.status = "pending"
        item.step = self._retry_step_for_failed_item(item)
        item.error_message = None
        item.finished_at = None
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Retry requested for bucket item.",
            metadata={"retry_step": item.step},
        )

    def _queue_migration_for_retry(self, migration: BucketMigration, *, message: str) -> None:
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.finished_at = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        self._recompute_counters(migration)
        self._add_event(
            migration,
            level="info",
            message=message,
        )

    def _rollback_single_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
    ) -> None:
        rollback_issues: list[str] = []

        if item.read_only_applied or item.source_policy_backup_json:
            try:
                if item.source_policy_backup_json:
                    self._restore_source_policy(item.source_bucket, source_ctx.account, item)
                else:
                    self._remove_managed_read_only_statement(item.source_bucket, source_ctx.account)
                item.read_only_applied = False
                item.source_policy_backup_json = None
            except Exception as exc:  # noqa: BLE001
                rollback_issues.append(
                    _truncate_db_text(
                        f"source policy restore failed: {exc}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )

        if item.target_lock_applied or item.target_policy_backup_json:
            try:
                if item.target_policy_backup_json:
                    self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                else:
                    self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                item.target_lock_applied = False
                item.target_policy_backup_json = None
            except Exception as exc:  # noqa: BLE001
                rollback_issues.append(
                    _truncate_db_text(
                        f"target lock restore failed: {exc}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )

        try:
            purged_current, purged_versions = self._purge_target_bucket(target_ctx, item.target_bucket)
            purged_count = purged_current + purged_versions
            item.objects_deleted = int(item.objects_deleted or 0) + purged_count
            item.replication_state_json = None
        except Exception as exc:  # noqa: BLE001
            rollback_issues.append(
                _truncate_db_text(
                    f"destination cleanup failed: {exc}",
                    max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                )
            )

        if rollback_issues:
            item.status = "failed"
            item.step = "rollback_failed"
            item.error_message = _truncate_optional_db_text(
                "Rollback failed: " + "; ".join(rollback_issues),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            item.finished_at = utcnow()
            item.updated_at = utcnow()
            self._add_event(
                migration,
                item=item,
                level="error",
                message="Rollback failed for bucket item.",
                metadata={"issues": rollback_issues},
            )
            return

        item.status = "rolled_back"
        item.step = "rolled_back"
        item.error_message = None
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Rollback completed for bucket item.",
            metadata={"target_bucket": item.target_bucket},
        )

    def _refresh_status_after_manual_item_operations(self, migration: BucketMigration) -> None:
        self._recompute_counters(migration)
        pending_count = len([item for item in migration.items if item.status in {"pending", "running", "paused"}])
        awaiting_count = len([item for item in migration.items if item.status == "awaiting_cutover"])

        if pending_count > 0:
            migration.status = "queued"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = None
            migration.finished_at = None
            migration.updated_at = utcnow()
            return

        if migration.failed_items > 0:
            migration.status = "completed_with_errors"
            migration.updated_at = utcnow()
            return

        if migration.mode == "pre_sync" and awaiting_count > 0:
            migration.status = "awaiting_cutover"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = None
            migration.finished_at = None
            migration.updated_at = utcnow()
            return

        if migration.status == "canceled":
            migration.error_message = None
            migration.updated_at = utcnow()
            return

        migration.status = "completed"
        migration.error_message = None
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()

    def _rollback_source_data_risk_reason(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> Optional[str]:
        if item.status == "skipped":
            return None
        if bool(getattr(item, "source_deleted", False)):
            return "source deletion already completed"
        if not migration.delete_source:
            return None
        if item.status == "completed":
            return "item completed with delete-source enabled"
        if item.step in {"delete_source", "completed"}:
            return f"item is at step '{item.step}' with delete-source enabled"
        return None

    def _ensure_source_accessible_for_rollback(
        self,
        source_ctx: _ResolvedContext,
        items: list[BucketMigrationItem],
    ) -> None:
        errors: list[str] = []
        checked_buckets: set[str] = set()
        for item in items:
            if item.status == "skipped":
                continue
            bucket_name = (item.source_bucket or "").strip()
            if not bucket_name or bucket_name in checked_buckets:
                continue
            checked_buckets.add(bucket_name)
            try:
                self._precheck_can_list_bucket(source_ctx, bucket_name)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{bucket_name}: {exc}")

        if errors:
            sample = "; ".join(errors[:3])
            suffix = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
            raise ValueError(
                "Rollback blocked to prevent data loss: unable to verify source bucket accessibility for "
                f"{len(errors)} bucket(s): {sample}{suffix}"
            )

    def _ensure_rollback_safe(
        self,
        migration: BucketMigration,
        items: list[BucketMigrationItem],
        *,
        source_ctx: _ResolvedContext,
    ) -> None:
        risks: list[str] = []
        for item in items:
            reason = self._rollback_source_data_risk_reason(migration, item)
            if reason:
                risks.append(f"{item.source_bucket}: {reason}")
        if risks:
            sample = "; ".join(risks[:3])
            suffix = f" (+{len(risks) - 3} more)" if len(risks) > 3 else ""
            raise ValueError(
                "Rollback blocked to prevent data loss: source data may have been deleted for "
                f"{len(risks)} bucket(s): {sample}{suffix}"
            )
        self._ensure_source_accessible_for_rollback(source_ctx, items)

    def _renew_migration_lease(self, migration_id: int, *, worker_id: str, lease_seconds: int) -> bool:
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        updated = (
            self.db.query(BucketMigration)
            .filter(
                BucketMigration.id == migration_id,
                BucketMigration.worker_lease_owner == worker_id,
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
            )
            .update(
                {
                    BucketMigration.worker_lease_until: lease_until,
                    BucketMigration.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        if updated == 1:
            self._commit()
            return True
        self.db.rollback()
        return False

    def _release_migration_lease(self, migration_id: int, *, worker_id: Optional[str] = None) -> None:
        query = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id)
        if worker_id:
            query = query.filter(BucketMigration.worker_lease_owner == worker_id)
        query.update(
            {
                BucketMigration.worker_lease_owner: None,
                BucketMigration.worker_lease_until: None,
            },
            synchronize_session=False,
        )

    def fail_migration_fatal(
        self,
        migration_id: int,
        *,
        error: Exception,
        worker_id: Optional[str] = None,
    ) -> None:
        try:
            migration = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id).first()
            if not migration:
                return

            now = utcnow()
            if migration.status in _FINAL_MIGRATION_STATUSES:
                if worker_id and migration.worker_lease_owner == worker_id:
                    migration.worker_lease_owner = None
                    migration.worker_lease_until = None
                    migration.updated_at = now
                    self._commit()
                return

            error_text = str(error or "unknown fatal error").strip() or "unknown fatal error"
            migration.status = "failed"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = _truncate_optional_db_text(
                f"Fatal migration worker error: {error_text}",
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            migration.finished_at = now
            migration.updated_at = now
            for item in migration.items:
                if item.status == "running":
                    item.status = "failed"
                    item.step = item.step or "unknown"
                    if not item.error_message:
                        item.error_message = "Migration stopped due to fatal worker error."
                    item.finished_at = now
                    item.updated_at = now

            self._add_event(
                migration,
                level="error",
                message="Migration failed due to fatal worker error.",
                metadata={"error": error_text},
            )
            self._recompute_counters(migration)
            self._commit()
        except Exception:  # noqa: BLE001
            self.db.rollback()
            logger.exception(
                "Unable to persist fatal migration failure state: migration=%s worker=%s",
                migration_id,
                worker_id,
            )

    def _control_state(
        self,
        migration_id: int,
        *,
        worker_id: Optional[str] = None,
        lease_seconds: Optional[int] = None,
    ) -> str:
        migration = self.get_migration(migration_id)
        if worker_id:
            if migration.worker_lease_owner != worker_id:
                return "lost_lease"
            effective_lease_seconds = max(15, int(lease_seconds or settings.bucket_migration_worker_lease_seconds))
            lease_until = migration.worker_lease_until
            refresh_window_seconds = max(5, effective_lease_seconds // 3)
            should_refresh = (
                lease_until is None
                or (lease_until - utcnow()).total_seconds() <= refresh_window_seconds
            )
            if should_refresh:
                if not self._renew_migration_lease(migration_id, worker_id=worker_id, lease_seconds=effective_lease_seconds):
                    return "lost_lease"
                migration = self.get_migration(migration_id)
        if migration.cancel_requested or migration.status == "cancel_requested":
            return "cancel"
        if migration.pause_requested or migration.status == "pause_requested":
            return "pause"
        return "run"

    def _mark_paused(self, migration: BucketMigration) -> None:
        migration.status = "paused"
        migration.pause_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "running":
                item.status = "paused"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration paused.")
        self._recompute_counters(migration)

    def _release_target_write_locks(
        self,
        migration: BucketMigration,
        target_ctx: Optional[_ResolvedContext],
        *,
        verify_restored: bool = False,
    ) -> list[str]:
        if not any(item.target_lock_applied or item.target_policy_backup_json for item in migration.items):
            return []
        if target_ctx is None:
            return ["target context is not available"]

        errors: list[str] = []
        for item in migration.items:
            if not (item.target_lock_applied or item.target_policy_backup_json):
                continue
            try:
                expected_policy = _json_loads(item.target_policy_backup_json)
                if item.target_policy_backup_json:
                    self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                else:
                    self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                if verify_restored:
                    self._verify_restored_bucket_policy(
                        target_ctx.account,
                        item.target_bucket,
                        expected_policy,
                    )
                item.target_lock_applied = False
                item.target_policy_backup_json = None
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Target write-lock policy released.",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{item.target_bucket}: {exc}")
                self._add_event(
                    migration,
                    item=item,
                    level="warning",
                    message="Unable to release target write-lock policy.",
                    metadata={"error": str(exc)},
                )
        return errors

    def _release_source_read_only_policies(
        self,
        migration: BucketMigration,
        source_ctx: Optional[_ResolvedContext],
        *,
        verify_restored: bool = False,
    ) -> list[str]:
        if not any(item.read_only_applied or item.source_policy_backup_json for item in migration.items):
            return []
        if source_ctx is None:
            return ["source context is not available"]

        errors: list[str] = []
        for item in migration.items:
            if not (item.read_only_applied or item.source_policy_backup_json):
                continue
            try:
                expected_policy = _json_loads(item.source_policy_backup_json)
                if item.source_policy_backup_json:
                    self._restore_source_policy(item.source_bucket, source_ctx.account, item)
                else:
                    self._remove_managed_read_only_statement(item.source_bucket, source_ctx.account)
                if verify_restored:
                    self._verify_restored_bucket_policy(
                        source_ctx.account,
                        item.source_bucket,
                        expected_policy,
                    )
                item.read_only_applied = False
                item.source_policy_backup_json = None
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Source read-only policy restored.",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{item.source_bucket}: {exc}")
                self._add_event(
                    migration,
                    item=item,
                    level="warning",
                    message="Unable to restore source read-only policy.",
                    metadata={"error": str(exc)},
                )
        return errors

    def _verify_restored_bucket_policy(
        self,
        account: S3Account,
        bucket_name: str,
        expected_policy: Any,
    ) -> None:
        current_policy = self._buckets.get_policy(bucket_name, account)
        expected = expected_policy if isinstance(expected_policy, dict) else None
        current = current_policy if isinstance(current_policy, dict) else None
        if _json_dumps(expected) == _json_dumps(current):
            return
        expected_state = "present" if isinstance(expected, dict) else "absent"
        current_state = "present" if isinstance(current, dict) else "absent"
        raise RuntimeError(
            f"Policy verification mismatch after restore on bucket '{bucket_name}' "
            f"(expected={expected_state}, current={current_state})"
        )

    def _mark_canceled(
        self,
        migration: BucketMigration,
        *,
        source_ctx: Optional[_ResolvedContext] = None,
        target_ctx: Optional[_ResolvedContext] = None,
    ) -> None:
        migration.status = "canceled"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status in {"pending", "running", "paused", "awaiting_cutover"}:
                item.status = "canceled"
                item.finished_at = utcnow()
                item.updated_at = utcnow()
        source_release_errors = self._release_source_read_only_policies(migration, source_ctx, verify_restored=True)
        target_release_errors = self._release_target_write_locks(migration, target_ctx, verify_restored=True)
        release_errors = source_release_errors + target_release_errors
        if release_errors:
            migration.error_message = _truncate_optional_db_text(
                f"Migration canceled, but {len(release_errors)} authorization restore error(s): "
                + " | ".join(release_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
        else:
            migration.error_message = None
        self._add_event(migration, level="info", message="Migration canceled.")
        self._recompute_counters(migration)

    def _finalize_or_wait_cutover(
        self,
        migration: BucketMigration,
        *,
        source_ctx: Optional[_ResolvedContext] = None,
        target_ctx: Optional[_ResolvedContext] = None,
    ) -> None:
        self._recompute_counters(migration)
        if migration.cancel_requested or migration.status == "cancel_requested":
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
            return

        total_actionable = len([item for item in migration.items if item.status not in {"skipped"}])
        awaiting_count = len([item for item in migration.items if item.status == "awaiting_cutover"])
        pending_count = len([item for item in migration.items if item.status in {"pending", "running", "paused"}])

        if migration.mode == "pre_sync" and total_actionable > 0 and awaiting_count == total_actionable:
            migration.status = "awaiting_cutover"
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.updated_at = utcnow()
            self._add_event(migration, level="info", message="All items pre-synced; waiting for cutover.")
            return

        if pending_count > 0:
            migration.status = "running"
            migration.updated_at = utcnow()
            return

        if migration.failed_items > 0:
            migration.status = "completed_with_errors"
        else:
            migration.status = "completed"
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()
        release_errors = self._release_target_write_locks(migration, target_ctx)
        if release_errors:
            if migration.status == "completed":
                migration.status = "completed_with_errors"
            migration.error_message = _truncate_optional_db_text(
                f"Migration finished with {len(release_errors)} target lock cleanup error(s): "
                + " | ".join(release_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
        self._add_event(migration, level="info", message=f"Migration finished with status '{migration.status}'.")

    def _recompute_counters(self, migration: BucketMigration) -> None:
        completed = 0
        failed = 0
        skipped = 0
        awaiting = 0
        for item in migration.items:
            if item.status in {"completed", "rolled_back"}:
                completed += 1
            elif item.status == "failed":
                failed += 1
            elif item.status == "skipped":
                skipped += 1
            elif item.status == "awaiting_cutover":
                awaiting += 1
        migration.total_items = len(migration.items)
        migration.completed_items = completed
        migration.failed_items = failed
        migration.skipped_items = skipped
        migration.awaiting_items = awaiting

    def _add_event(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem] = None,
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        safe_message = _truncate_db_text(message, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
        safe_metadata: Optional[dict[str, Any]] = None
        if metadata is not None:
            normalized_metadata = _sanitize_event_metadata(metadata)
            if isinstance(normalized_metadata, dict):
                safe_metadata = normalized_metadata
            else:
                safe_metadata = {"value": normalized_metadata}
        created_at = utcnow()
        entry = BucketMigrationEvent(
            migration_id=migration.id,
            item_id=item.id if item else None,
            level=level,
            message=safe_message,
            metadata_json=_serialize_event_metadata(safe_metadata),
            created_at=created_at,
        )
        self.db.add(entry)
        self._enqueue_migration_webhook(
            migration,
            item=item,
            level=level,
            message=safe_message,
            metadata=safe_metadata,
            created_at=created_at,
        )

    def _enqueue_migration_webhook(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem],
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]],
        created_at: Any,
    ) -> None:
        webhook_url = (migration.webhook_url or "").strip()
        if not webhook_url:
            return

        payload = self._build_migration_webhook_payload(
            migration,
            item=item,
            level=level,
            message=message,
            metadata=metadata,
            created_at=created_at,
        )
        try:
            self._validate_configured_webhook_url(webhook_url)
        except ValueError as exc:
            logger.warning(
                "Bucket migration webhook target rejected by security policy: migration=%s item=%s error=%s",
                migration.id,
                item.id if item else None,
                exc,
            )
            return

        dispatcher = get_bucket_migration_webhook_dispatcher()
        enqueued = dispatcher.enqueue(
            webhook_url=webhook_url,
            payload=payload,
            migration_id=int(migration.id),
            item_id=int(item.id) if item else None,
        )
        if not enqueued:
            logger.warning(
                "Bucket migration webhook dropped because dispatch queue is full: migration=%s item=%s",
                migration.id,
                item.id if item else None,
            )

    def _build_migration_webhook_payload(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem],
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]],
        created_at: Any,
    ) -> dict[str, Any]:
        safe_metadata: Optional[dict[str, Any]] = None
        if metadata is not None:
            normalized_metadata = _json_loads(_json_dumps(metadata))
            if isinstance(normalized_metadata, dict):
                safe_metadata = normalized_metadata
            else:
                safe_metadata = {"value": normalized_metadata}

        created_iso = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)

        payload: dict[str, Any] = {
            "type": "bucket_migration.event",
            "occurred_at": created_iso,
            "migration": {
                "id": migration.id,
                "status": migration.status,
                "mode": migration.mode,
                "source_context_id": migration.source_context_id,
                "target_context_id": migration.target_context_id,
                "copy_bucket_settings": bool(migration.copy_bucket_settings),
                "delete_source": bool(migration.delete_source),
                "strong_integrity_check": bool(getattr(migration, "strong_integrity_check", False)),
                "lock_target_writes": bool(migration.lock_target_writes),
                "use_same_endpoint_copy": bool(migration.use_same_endpoint_copy),
                "auto_grant_source_read_for_copy": bool(migration.auto_grant_source_read_for_copy),
                "parallelism_max": int(migration.parallelism_max or 1),
                "total_items": int(migration.total_items or 0),
                "completed_items": int(migration.completed_items or 0),
                "failed_items": int(migration.failed_items or 0),
                "skipped_items": int(migration.skipped_items or 0),
                "awaiting_items": int(migration.awaiting_items or 0),
            },
            "event": {
                "level": level,
                "message": message,
                "metadata": safe_metadata,
            },
            "item": None,
        }
        if item is not None:
            payload["item"] = {
                "id": item.id,
                "source_bucket": item.source_bucket,
                "target_bucket": item.target_bucket,
                "status": item.status,
                "step": item.step,
                "objects_copied": int(item.objects_copied or 0),
                "objects_deleted": int(item.objects_deleted or 0),
                "error_message": item.error_message,
            }
        return payload


class _BucketMigrationWebhookDispatcher:
    def __init__(
        self,
        *,
        queue_size: int,
        workers: int,
        timeout_seconds: float,
    ) -> None:
        self._queue: queue.Queue[_WebhookDispatchTask] = queue.Queue(maxsize=max(1, int(queue_size)))
        self._workers = max(1, int(workers))
        self._timeout_seconds = max(0.1, float(timeout_seconds))
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if any(thread.is_alive() for thread in self._threads):
                return
            self._stop_event.clear()
            self._threads = []
            for index in range(self._workers):
                thread = threading.Thread(
                    target=self._run_loop,
                    name=f"bucket-migration-webhook-{index + 1}",
                    daemon=True,
                )
                thread.start()
                self._threads.append(thread)

    def stop(self, timeout: float = 3.0) -> None:
        with self._lock:
            self._stop_event.set()
            threads = list(self._threads)
        for thread in threads:
            thread.join(timeout=timeout)

    def enqueue(
        self,
        *,
        webhook_url: str,
        payload: dict[str, Any],
        migration_id: int,
        item_id: Optional[int],
    ) -> bool:
        task = _WebhookDispatchTask(
            webhook_url=webhook_url,
            payload=payload,
            migration_id=int(migration_id),
            item_id=int(item_id) if item_id is not None else None,
        )
        try:
            self._queue.put_nowait(task)
            return True
        except queue.Full:
            return False

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                task = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                self._deliver(task)
            finally:
                self._queue.task_done()

    def _deliver(self, task: _WebhookDispatchTask) -> None:
        try:
            _validate_webhook_target_url(task.webhook_url)
        except ValueError as exc:
            logger.warning(
                "Bucket migration webhook target rejected before delivery: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )
            return

        try:
            response = requests.post(
                task.webhook_url,
                json=task.payload,
                timeout=self._timeout_seconds,
                allow_redirects=False,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "s3-manager-migration-webhook/1.0",
                },
            )
            if int(getattr(response, "status_code", 0) or 0) >= 400:
                logger.warning(
                    "Bucket migration webhook returned non-success status: migration=%s item=%s status=%s",
                    task.migration_id,
                    task.item_id,
                    getattr(response, "status_code", "unknown"),
                )
        except requests.RequestException as exc:
            logger.warning(
                "Bucket migration webhook delivery failed: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Bucket migration webhook delivery raised unexpected error: migration=%s item=%s error=%s",
                task.migration_id,
                task.item_id,
                exc,
            )


_webhook_dispatcher_singleton: Optional[_BucketMigrationWebhookDispatcher] = None
_webhook_dispatcher_lock = threading.Lock()


def get_bucket_migration_webhook_dispatcher() -> _BucketMigrationWebhookDispatcher:
    global _webhook_dispatcher_singleton
    with _webhook_dispatcher_lock:
        if _webhook_dispatcher_singleton is None:
            _webhook_dispatcher_singleton = _BucketMigrationWebhookDispatcher(
                queue_size=_WEBHOOK_QUEUE_SIZE,
                workers=_WEBHOOK_WORKERS,
                timeout_seconds=_WEBHOOK_TIMEOUT_SECONDS,
            )
            _webhook_dispatcher_singleton.start()
        return _webhook_dispatcher_singleton


def reset_bucket_migration_webhook_dispatcher_for_tests() -> None:
    global _webhook_dispatcher_singleton
    with _webhook_dispatcher_lock:
        dispatcher = _webhook_dispatcher_singleton
        _webhook_dispatcher_singleton = None
    if dispatcher is not None:
        dispatcher.stop(timeout=0.1)


class BucketMigrationWorker:
    def __init__(
        self,
        session_factory: sessionmaker,
        *,
        poll_interval_seconds: float,
        lease_seconds: int,
    ) -> None:
        self._session_factory = session_factory
        self._poll_interval_seconds = max(0.2, float(poll_interval_seconds))
        self._lease_seconds = max(15, int(lease_seconds))
        self._worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._wake_event.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="bucket-migration-worker",
                daemon=True,
            )
            self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        with self._lock:
            self._stop_event.set()
            self._wake_event.set()
            thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)

    def wake_up(self) -> None:
        self._wake_event.set()

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            processed = False
            try:
                migration_id: Optional[int] = None
                with self._session_factory() as db:
                    service = BucketMigrationService(db)
                    migration_id = service.claim_next_runnable_migration_id(
                        worker_id=self._worker_id,
                        lease_seconds=self._lease_seconds,
                    )
                if migration_id is not None:
                    processed = True
                    try:
                        with self._session_factory() as db:
                            service = BucketMigrationService(db)
                            service.run_migration(
                                migration_id,
                                worker_id=self._worker_id,
                                lease_seconds=self._lease_seconds,
                            )
                    except Exception as exc:  # noqa: BLE001
                        logger.exception(
                            "Bucket migration worker failed while processing migration %s",
                            migration_id,
                        )
                        with self._session_factory() as db:
                            service = BucketMigrationService(db)
                            service.fail_migration_fatal(
                                migration_id,
                                error=exc,
                                worker_id=self._worker_id,
                            )
            except Exception:  # noqa: BLE001
                logger.exception("Bucket migration worker iteration failed")
            finally:
                wait_seconds = 0.05 if processed else self._poll_interval_seconds
                self._wake_event.wait(timeout=wait_seconds)
                self._wake_event.clear()


_worker_singleton: Optional[BucketMigrationWorker] = None
_worker_lock = threading.Lock()


def reset_bucket_migration_worker_for_tests(*, timeout: float = 0.5) -> None:
    global _worker_singleton
    with _worker_lock:
        worker = _worker_singleton
        _worker_singleton = None
    if worker is not None:
        worker.stop(timeout=timeout)


def get_bucket_migration_worker(session_factory: sessionmaker) -> BucketMigrationWorker:
    global _worker_singleton
    with _worker_lock:
        if _worker_singleton is None:
            _worker_singleton = BucketMigrationWorker(
                session_factory,
                poll_interval_seconds=settings.bucket_migration_poll_interval_seconds,
                lease_seconds=settings.bucket_migration_worker_lease_seconds,
            )
        return _worker_singleton
