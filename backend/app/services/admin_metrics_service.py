# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.traffic_service import (
    TrafficWindow,
    WINDOW_DELTAS,
    WINDOW_RESOLUTION_LABELS,
    aggregate_usage,
    flatten_usage_entries,
    window_start,
)
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import aggregate_bucket_usage, extract_usage_stats

logger = logging.getLogger(__name__)


@dataclass
class _StorageUsageTotals:
    total_buckets: int = 0
    used_bytes: int = 0
    object_count: int = 0
    has_bytes: bool = False
    has_objects: bool = False

    def _add_usage(self, used_bytes: int | None, used_objects: int | None) -> None:
        if used_bytes is not None:
            self.has_bytes = True
            self.used_bytes += used_bytes
        if used_objects is not None:
            self.has_objects = True
            self.object_count += used_objects

    def add_account_usage(
        self,
        used_bytes: int | None,
        used_objects: int | None,
        bucket_count: int | None,
    ) -> None:
        if bucket_count:
            self.total_buckets += bucket_count
        self._add_usage(used_bytes, used_objects)

    def add_bucket_usage(self, used_bytes: int | None, used_objects: int | None) -> None:
        self.total_buckets += 1
        self._add_usage(used_bytes, used_objects)

    def use_user_bucket_count_when_empty(self, bucket_count: int | None) -> None:
        if bucket_count and self.total_buckets == 0:
            self.total_buckets = bucket_count

    def payload(self, *, accounts_with_usage: int) -> dict:
        return {
            "used_bytes": self.used_bytes if self.has_bytes else None,
            "object_count": self.object_count if self.has_objects else None,
            "bucket_count": self.total_buckets or None,
            "accounts_with_usage": accounts_with_usage,
        }


@dataclass(frozen=True)
class _OwnerUsage:
    used_bytes: int | None
    object_count: int | None
    bucket_count: int


@dataclass(frozen=True)
class _AssignmentCounts:
    total: int
    assigned: int

    @property
    def unassigned(self) -> int:
        return max(self.total - self.assigned, 0)


@dataclass
class _BucketUsageIndex:
    entries_by_owner: dict[str, list[_OwnerUsage]]
    totals: _StorageUsageTotals

    @classmethod
    def build(cls, buckets: Iterable[Dict]) -> "_BucketUsageIndex":
        entries_by_owner: dict[str, list[_OwnerUsage]] = {}
        totals = _StorageUsageTotals()
        for bucket in buckets:
            used_bytes, used_objects = extract_usage_stats(bucket.get("usage"))
            owner = str(bucket.get("owner") or "").strip()
            entries_by_owner.setdefault(owner.lower(), []).append(
                _OwnerUsage(
                    used_bytes=used_bytes,
                    object_count=used_objects,
                    bucket_count=1,
                )
            )
            totals.add_bucket_usage(used_bytes, used_objects)
        return cls(entries_by_owner=entries_by_owner, totals=totals)

    def usage_for(self, owner_key: str | None) -> _OwnerUsage:
        if not owner_key:
            return _OwnerUsage(used_bytes=None, object_count=None, bucket_count=0)
        entries = self.entries_by_owner.get(owner_key.lower(), [])
        if not entries:
            return _OwnerUsage(used_bytes=None, object_count=None, bucket_count=0)
        has_bytes = any(entry.used_bytes is not None for entry in entries)
        has_objects = any(entry.object_count is not None for entry in entries)
        return _OwnerUsage(
            used_bytes=(
                sum(entry.used_bytes or 0 for entry in entries)
                if has_bytes
                else None
            ),
            object_count=(
                sum(entry.object_count or 0 for entry in entries)
                if has_objects
                else None
            ),
            bucket_count=len(entries),
        )


class AdminMetricsService:
    _IDENTIFIER_SPLIT = re.compile(r"[$:/]")

    def __init__(
        self,
        db: Session,
        rgw_admin: RGWAdminClient,
        endpoint_id: Optional[int] = None,
    ) -> None:
        self.db = db
        self.rgw_admin = rgw_admin
        self.endpoint_id = endpoint_id

    @staticmethod
    def _endpoint_scoped_count(query, endpoint_column, endpoint_id: int | None) -> int:
        if endpoint_id is not None:
            query = query.filter(endpoint_column == endpoint_id)
        return int(query.scalar() or 0)

    @classmethod
    def _account_assignment_counts(
        cls,
        db: Session,
        endpoint_id: int | None,
    ) -> _AssignmentCounts:
        total = cls._endpoint_scoped_count(
            db.query(func.count(S3Account.id)),
            S3Account.storage_endpoint_id,
            endpoint_id,
        )
        assigned_accounts_query = (
            db.query(func.count(func.distinct(S3Account.id)))
            .join(UserS3Account, UserS3Account.account_id == S3Account.id)
        )
        assigned = cls._endpoint_scoped_count(
            assigned_accounts_query,
            S3Account.storage_endpoint_id,
            endpoint_id,
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    @classmethod
    def _s3_user_assignment_counts(
        cls,
        db: Session,
        endpoint_id: int | None,
    ) -> _AssignmentCounts:
        total = cls._endpoint_scoped_count(
            db.query(func.count(S3User.id)),
            S3User.storage_endpoint_id,
            endpoint_id,
        )
        assigned_s3_users_query = (
            db.query(func.count(func.distinct(S3User.id)))
            .join(UserS3User, UserS3User.s3_user_id == S3User.id)
        )
        assigned = cls._endpoint_scoped_count(
            assigned_s3_users_query,
            S3User.storage_endpoint_id,
            endpoint_id,
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    @staticmethod
    def _ui_user_counts(db: Session) -> tuple[int, int, int]:
        admin_count = (
            db.query(func.count(User.id))
            .filter(User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]))
            .scalar()
            or 0
        )
        manager_count = (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.UI_USER.value)
            .scalar()
            or 0
        )
        none_count = (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.UI_NONE.value)
            .scalar()
            or 0
        )
        return int(admin_count), int(manager_count), int(none_count)

    @staticmethod
    def _endpoint_counts(db: Session) -> tuple[int, int]:
        ceph_count = (
            db.query(func.count(StorageEndpoint.id))
            .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
            .scalar()
            or 0
        )
        other_count = (
            db.query(func.count(StorageEndpoint.id))
            .filter(StorageEndpoint.provider != StorageProvider.CEPH.value)
            .scalar()
            or 0
        )
        return int(ceph_count), int(other_count)

    @staticmethod
    def _connection_counts(db: Session) -> tuple[int, int, int]:
        total = db.query(func.count(S3Connection.id)).scalar() or 0
        shared = (
            db.query(func.count(S3Connection.id))
            .filter(S3Connection.is_shared.is_(True))
            .scalar()
            or 0
        )
        private = (
            db.query(func.count(S3Connection.id))
            .filter(S3Connection.is_shared.is_(False))
            .scalar()
            or 0
        )
        return int(total), int(shared), int(private)

    @classmethod
    def build_summary_payload(
        cls,
        db: Session,
        endpoint_id: Optional[int] = None,
    ) -> dict:
        accounts = cls._account_assignment_counts(db, endpoint_id)
        s3_users = cls._s3_user_assignment_counts(db, endpoint_id)
        total_admins, total_managers, total_none_users = cls._ui_user_counts(db)
        total_ceph_endpoints, total_other_endpoints = cls._endpoint_counts(db)
        total_connections, total_shared_connections, total_private_connections = cls._connection_counts(
            db
        )
        return {
            "total_accounts": accounts.total,
            "total_users": total_managers,
            "total_admins": total_admins,
            "total_none_users": total_none_users,
            "total_s3_users": s3_users.total,
            "assigned_accounts": accounts.assigned,
            "unassigned_accounts": accounts.unassigned,
            "assigned_s3_users": s3_users.assigned,
            "unassigned_s3_users": s3_users.unassigned,
            "total_endpoints": total_ceph_endpoints + total_other_endpoints,
            "total_ceph_endpoints": total_ceph_endpoints,
            "total_other_endpoints": total_other_endpoints,
            "total_connections": total_connections,
            "total_shared_connections": total_shared_connections,
            "total_private_connections": total_private_connections,
        }

    def storage(self) -> dict:
        snapshot = self._storage_snapshot()
        snapshot["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return snapshot

    def traffic(self, window: TrafficWindow) -> dict:
        return self._traffic(window=window)

    def _storage_snapshot(self) -> dict:
        summary = self.build_summary_payload(self.db, endpoint_id=self.endpoint_id)
        accounts, s3_users, allowed_identifiers = self._load_scope_targets()

        try:
            all_buckets = self._fetch_all_buckets()
        except RGWAdminError as exc:
            logger.warning("Unable to fetch consolidated bucket list: %s", exc)
            all_buckets = None

        if all_buckets is not None:
            filtered_buckets = self._filter_buckets(all_buckets, allowed_identifiers)
            return self._storage_snapshot_from_bucket_list(summary, accounts, s3_users, filtered_buckets)

        return self._storage_snapshot_from_account_fallback(summary, accounts, s3_users)

    def _resolve_fallback_account_usage(
        self,
        account: S3Account,
    ) -> tuple[int | None, int | None, int | None]:
        used_bytes, used_objects, bucket_count = self._collect_bucket_usage(
            account_id=account.rgw_account_id,
            uid=account.rgw_user_uid,
            context=f"account:{account.id}",
        )
        if used_bytes is not None or used_objects is not None:
            return used_bytes, used_objects, bucket_count

        try:
            stats = self.rgw_admin.get_account_stats(account.rgw_account_id, sync=False) or {}
        except RGWAdminError as exc:
            logger.warning(
                "Unable to fetch account stats for %s (%s): %s",
                account.id,
                account.rgw_account_id,
                exc,
            )
            return None, None, bucket_count
        if isinstance(stats, dict) and stats.get("not_found"):
            return None, None, bucket_count
        usage_payload = None
        if isinstance(stats, dict):
            usage_payload = stats.get("stats") or stats.get("usage") or stats.get("total") or stats
            if isinstance(usage_payload, dict) and "usage" in usage_payload:
                usage_payload = usage_payload.get("usage")
        used_bytes, used_objects = extract_usage_stats(usage_payload)
        return used_bytes, used_objects, bucket_count

    def _storage_snapshot_from_account_fallback(
        self,
        summary: dict,
        accounts: Iterable[S3Account],
        s3_users: Iterable[S3User],
    ) -> dict:
        totals = _StorageUsageTotals()
        account_usage: list[dict] = []
        for account in accounts:
            used_bytes, used_objects, bucket_count = self._resolve_fallback_account_usage(account)
            totals.add_account_usage(used_bytes, used_objects, bucket_count)
            if used_bytes is None and used_objects is None:
                continue
            account_usage.append(
                {
                    "account_id": account.rgw_account_id,
                    "account_name": account.name,
                    "used_bytes": used_bytes,
                    "object_count": used_objects,
                    "bucket_count": bucket_count,
                }
            )
        account_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)

        s3_user_usage: list[dict] = []
        for user in s3_users:
            used_bytes, used_objects, bucket_count = self._collect_bucket_usage(
                account_id=None,
                uid=user.rgw_user_uid,
                context=f"s3_user:{user.id}",
            )
            totals.use_user_bucket_count_when_empty(bucket_count)
            if used_bytes is None and used_objects is None:
                continue
            s3_user_usage.append(
                {
                    "user_id": user.id,
                    "user_name": user.name,
                    "rgw_user_uid": user.rgw_user_uid,
                    "used_bytes": used_bytes,
                    "object_count": used_objects,
                }
            )
        s3_user_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)

        return {
            **summary,
            "total_buckets": totals.total_buckets,
            "account_usage": account_usage,
            "s3_user_usage": s3_user_usage,
            "storage_totals": totals.payload(accounts_with_usage=len(account_usage)),
        }

    def _storage_snapshot_from_bucket_list(
        self,
        summary: dict,
        accounts: Iterable[S3Account],
        s3_users: Iterable[S3User],
        bucket_list: Iterable[Dict],
    ) -> dict:
        usage_index = _BucketUsageIndex.build(bucket_list)
        account_usage = self._account_usage_from_bucket_index(accounts, usage_index)
        s3_user_usage = self._s3_user_usage_from_bucket_index(s3_users, usage_index)
        return {
            **summary,
            "total_buckets": usage_index.totals.total_buckets,
            "account_usage": account_usage,
            "s3_user_usage": s3_user_usage,
            "storage_totals": usage_index.totals.payload(accounts_with_usage=len(account_usage)),
        }

    @staticmethod
    def _account_usage_from_bucket_index(
        accounts: Iterable[S3Account],
        usage_index: _BucketUsageIndex,
    ) -> list[dict]:
        account_usage: list[dict] = []
        for account in accounts:
            usage = usage_index.usage_for(account.rgw_account_id)
            if usage.used_bytes is None and usage.object_count is None:
                continue
            account_usage.append(
                {
                    "account_id": account.rgw_account_id,
                    "account_name": account.name,
                    "used_bytes": usage.used_bytes,
                    "object_count": usage.object_count,
                    "bucket_count": usage.bucket_count or None,
                }
            )
        account_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)
        return account_usage

    @staticmethod
    def _s3_user_usage_from_bucket_index(
        s3_users: Iterable[S3User],
        usage_index: _BucketUsageIndex,
    ) -> list[dict]:
        s3_user_usage: list[dict] = []
        for user in s3_users:
            if not user.rgw_user_uid:
                continue
            usage = usage_index.usage_for(user.rgw_user_uid)
            if usage.used_bytes is None and usage.object_count is None:
                continue
            s3_user_usage.append(
                {
                    "user_id": user.id,
                    "user_name": user.name,
                    "rgw_user_uid": user.rgw_user_uid,
                    "used_bytes": usage.used_bytes,
                    "object_count": usage.object_count,
                    "bucket_count": usage.bucket_count or None,
                }
            )
        s3_user_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)
        return s3_user_usage

    def _traffic(self, window: TrafficWindow) -> dict:
        if window not in WINDOW_DELTAS:
            raise ValueError(f"Unsupported window '{window}'.")
        reference = datetime.now(timezone.utc).replace(microsecond=0)
        start = window_start(reference, window)
        payload = self._fetch_usage(start=start, end=reference)
        entries = flatten_usage_entries(payload)
        _, _, allowed_identifiers = self._load_scope_targets()
        if allowed_identifiers:
            entries = self._filter_usage_entries(entries, allowed_identifiers)
        else:
            entries = []
        aggregation = aggregate_usage(entries, start=start, end=reference, window=window)
        aggregation.update(
            {
                "window": window.value if isinstance(window, TrafficWindow) else str(window),
                "start": start.isoformat(),
                "end": reference.isoformat(),
                "resolution": WINDOW_RESOLUTION_LABELS.get(window, "per-entry"),
                "bucket_filter": None,
            }
        )
        aggregation["data_points"] = len(aggregation.get("series") or [])
        return aggregation

    def _fetch_usage(self, start: datetime, end: datetime) -> dict:
        payload = self.rgw_admin.get_usage(
            uid=None,
            tenant=None,
            start=start,
            end=end,
            show_entries=True,
            show_summary=False,
        )
        return payload or {}

    def _normalize_identifier(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            value = str(value)
        normalized = value.strip().lower()
        return normalized or None

    def _expand_identifier(self, value: Optional[str]) -> set[str]:
        normalized = self._normalize_identifier(value)
        if not normalized:
            return set()
        tokens = {normalized}
        for part in self._IDENTIFIER_SPLIT.split(normalized):
            if part:
                tokens.add(part)
        return tokens

    def _identifier_in_scope(self, value: Optional[str], allowed: set[str]) -> bool:
        if not allowed:
            return False
        return any(token in allowed for token in self._expand_identifier(value))

    def _load_scope_targets(self) -> tuple[list[S3Account], list[S3User], set[str]]:
        account_query = self.db.query(S3Account)
        if self.endpoint_id is not None:
            account_query = account_query.filter(S3Account.storage_endpoint_id == self.endpoint_id)
        accounts = account_query.all()
        s3_user_query = self.db.query(S3User)
        if self.endpoint_id is not None:
            s3_user_query = s3_user_query.filter(S3User.storage_endpoint_id == self.endpoint_id)
        s3_users = s3_user_query.all()

        allowed: set[str] = set()
        for acc in accounts:
            allowed.add(acc.rgw_account_id.strip().lower())
            allowed.add(acc.rgw_user_uid.strip().lower())
        for user in s3_users:
            if user.rgw_user_uid:
                allowed.add(user.rgw_user_uid.strip().lower())
        return accounts, s3_users, allowed

    def _filter_buckets(self, buckets: Iterable[Dict], allowed: set[str]) -> list[dict]:
        if not allowed:
            return []
        filtered: list[dict] = []
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            if self._identifier_in_scope(bucket.get("owner"), allowed) or self._identifier_in_scope(
                bucket.get("tenant"), allowed
            ):
                filtered.append(bucket)
        return filtered

    def _filter_usage_entries(self, entries: Iterable[dict], allowed: set[str]) -> list[dict]:
        if not allowed:
            return []
        filtered: list[dict] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if (
                self._identifier_in_scope(entry.get("user"), allowed)
                or self._identifier_in_scope(entry.get("owner"), allowed)
                or self._identifier_in_scope(entry.get("tenant"), allowed)
            ):
                filtered.append(entry)
        return filtered

    def _collect_bucket_usage(
        self,
        *,
        account_id: Optional[str],
        uid: Optional[str],
        context: str,
    ) -> Tuple[Optional[int], Optional[int], Optional[int]]:
        resolved_uid = resolve_admin_uid(account_id, uid)
        if not resolved_uid:
            return None, None, None
        try:
            payload = self.rgw_admin.get_all_buckets(uid=resolved_uid, with_stats=True)
        except RGWAdminError as exc:
            logger.warning("%s unable to list buckets for admin overview: %s", context, exc)
            return None, None, None
        return aggregate_bucket_usage(extract_bucket_list(payload))

    def _fetch_all_buckets(self) -> list[dict]:
        payload = self.rgw_admin.get_all_buckets(with_stats=True)
        return extract_bucket_list(payload)
