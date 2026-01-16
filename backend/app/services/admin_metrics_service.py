# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import re
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
)
from app.utils.rgw import extract_bucket_list, resolve_admin_uid
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


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
    def build_summary_payload(db: Session, endpoint_id: Optional[int] = None) -> dict:
        accounts_query = db.query(func.count(S3Account.id))
        if endpoint_id is not None:
            accounts_query = accounts_query.filter(S3Account.storage_endpoint_id == endpoint_id)
        total_accounts = accounts_query.scalar() or 0
        assigned_accounts_query = (
            db.query(func.count(func.distinct(S3Account.id)))
            .join(UserS3Account, UserS3Account.account_id == S3Account.id)
            .filter(UserS3Account.is_root.is_(False))
        )
        if endpoint_id is not None:
            assigned_accounts_query = assigned_accounts_query.filter(S3Account.storage_endpoint_id == endpoint_id)
        assigned_accounts = assigned_accounts_query.scalar() or 0
        unassigned_accounts = max(total_accounts - assigned_accounts, 0)
        total_admins = (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.UI_ADMIN.value)
            .scalar()
            or 0
        )
        total_managers = (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.UI_USER.value)
            .scalar()
            or 0
        )
        total_none_users = (
            db.query(func.count(User.id))
            .filter(User.role == UserRole.UI_NONE.value)
            .scalar()
            or 0
        )
        s3_user_query = db.query(func.count(S3User.id))
        if endpoint_id is not None:
            s3_user_query = s3_user_query.filter(S3User.storage_endpoint_id == endpoint_id)
        total_s3_users = s3_user_query.scalar() or 0
        assigned_s3_users_query = (
            db.query(func.count(func.distinct(S3User.id)))
            .join(UserS3User, UserS3User.s3_user_id == S3User.id)
        )
        if endpoint_id is not None:
            assigned_s3_users_query = assigned_s3_users_query.filter(S3User.storage_endpoint_id == endpoint_id)
        assigned_s3_users = assigned_s3_users_query.scalar() or 0
        unassigned_s3_users = max(total_s3_users - assigned_s3_users, 0)
        total_ceph_endpoints = (
            db.query(func.count(StorageEndpoint.id))
            .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
            .scalar()
            or 0
        )
        total_other_endpoints = (
            db.query(func.count(StorageEndpoint.id))
            .filter(StorageEndpoint.provider != StorageProvider.CEPH.value)
            .scalar()
            or 0
        )
        total_connections = db.query(func.count(S3Connection.id)).scalar() or 0
        return {
            "total_accounts": total_accounts,
            "total_users": total_managers,
            "total_admins": total_admins,
            "total_none_users": total_none_users,
            "total_portal_users": total_managers,
            "total_s3_users": total_s3_users,
            "assigned_accounts": assigned_accounts,
            "unassigned_accounts": unassigned_accounts,
            "assigned_s3_users": assigned_s3_users,
            "unassigned_s3_users": unassigned_s3_users,
            "total_endpoints": total_ceph_endpoints + total_other_endpoints,
            "total_ceph_endpoints": total_ceph_endpoints,
            "total_other_endpoints": total_other_endpoints,
            "total_connections": total_connections,
        }

    def storage(self) -> dict:
        snapshot = self._storage_snapshot()
        snapshot["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return snapshot

    def traffic(self, window: TrafficWindow) -> dict:
        return self._traffic(window=window)

    def metrics(self, window: TrafficWindow) -> dict:
        snapshot = self.storage()
        try:
            traffic = self._traffic(window=window)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch RGW usage for admin metrics: %s", exc)
            traffic = None
            snapshot["traffic_error"] = "RGW usage logs are not available."
        snapshot["traffic"] = traffic
        return snapshot

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

        # Fallback to per-account collection using admin credentials only
        total_buckets = 0
        bytes_acc = 0
        objects_acc = 0
        has_bytes = False
        has_objects = False

        account_usage: list[dict] = []
        for acc in accounts:
            used_bytes = None
            used_objects = None
            bucket_count = None

            account_id = acc.rgw_account_id
            uid = None if account_id else acc.rgw_user_uid
            used_bytes, used_objects, bucket_count = self._collect_bucket_usage(
                account_id=account_id,
                uid=uid,
                context=f"account:{acc.id}",
            )
            if bucket_count:
                total_buckets += bucket_count

            if used_bytes is None and used_objects is None:
                if not acc.rgw_account_id:
                    continue
                try:
                    stats = self.rgw_admin.get_account_stats(acc.rgw_account_id, sync=False) or {}
                except RGWAdminError as exc:
                    logger.warning("Unable to fetch account stats for %s (%s): %s", acc.id, acc.rgw_account_id, exc)
                    continue
                if isinstance(stats, dict) and stats.get("not_found"):
                    continue
                usage_payload = None
                if isinstance(stats, dict):
                    usage_payload = stats.get("stats") or stats.get("usage") or stats.get("total") or stats
                    if isinstance(usage_payload, dict) and "usage" in usage_payload:
                        usage_payload = usage_payload.get("usage")
                used_bytes, used_objects = extract_usage_stats(usage_payload)

            if used_bytes is None and used_objects is None:
                continue

            if used_bytes is not None:
                has_bytes = True
                bytes_acc += used_bytes
            if used_objects is not None:
                has_objects = True
                objects_acc += used_objects

            account_usage.append(
                {
                    "account_id": acc.rgw_account_id or str(acc.id),
                    "account_name": acc.name,
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
            # Avoid double counting buckets already seen from account roots
            if bucket_count and total_buckets == 0:
                total_buckets = bucket_count
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

        storage_totals = {
            "used_bytes": bytes_acc if has_bytes else None,
            "object_count": objects_acc if has_objects else None,
            "bucket_count": total_buckets or None,
            "accounts_with_usage": len(account_usage),
        }

        return {
            **summary,
            "total_buckets": total_buckets,
            "account_usage": account_usage,
            "s3_user_usage": s3_user_usage,
            "storage_totals": storage_totals,
        }

    def _storage_snapshot_from_bucket_list(
        self,
        summary: dict,
        accounts: Iterable[S3Account],
        s3_users: Iterable[S3User],
        bucket_list: Iterable[Dict],
    ) -> dict:
        normalized_buckets = []
        total_bytes = 0
        total_objects = 0
        has_bytes = False
        has_objects = False
        for bucket in bucket_list:
            usage_bytes, usage_objects = extract_usage_stats(bucket.get("usage"))
            owner = str(bucket.get("owner") or "").strip()
            normalized_buckets.append(
                {
                    "name": bucket.get("bucket"),
                    "owner": owner,
                    "tenant": bucket.get("tenant") or "",
                    "usage_bytes": usage_bytes,
                    "usage_objects": usage_objects,
                }
            )
            if usage_bytes is not None:
                total_bytes += usage_bytes
                has_bytes = True
            if usage_objects is not None:
                total_objects += usage_objects
                has_objects = True

        owner_map: Dict[str, list[dict]] = {}
        for entry in normalized_buckets:
            owner = entry["owner"].lower()
            if owner not in owner_map:
                owner_map[owner] = []
            owner_map[owner].append(entry)

        def _aggregate_for_owner(owner_key: Optional[str]) -> tuple[Optional[int], Optional[int], int]:
            if not owner_key:
                return None, None, 0
            entries = owner_map.get(owner_key.lower(), [])
            if not entries:
                return None, None, 0
            b_total = sum(entry["usage_bytes"] or 0 for entry in entries if entry["usage_bytes"] is not None)
            o_total = sum(entry["usage_objects"] or 0 for entry in entries if entry["usage_objects"] is not None)
            has_b = any(entry["usage_bytes"] is not None for entry in entries)
            has_o = any(entry["usage_objects"] is not None for entry in entries)
            return (b_total if has_b else None, o_total if has_o else None, len(entries))

        account_usage: list[dict] = []
        for acc in accounts:
            owner_key = acc.rgw_account_id or acc.rgw_user_uid or ""
            used_bytes, used_objects, bucket_count = _aggregate_for_owner(owner_key)
            if used_bytes is None and used_objects is None:
                continue
            account_usage.append(
                {
                    "account_id": acc.rgw_account_id or str(acc.id),
                    "account_name": acc.name,
                    "used_bytes": used_bytes,
                    "object_count": used_objects,
                    "bucket_count": bucket_count or None,
                }
            )
        account_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)

        s3_user_usage: list[dict] = []
        for user in s3_users:
            if not user.rgw_user_uid:
                continue
            used_bytes, used_objects, bucket_count = _aggregate_for_owner(user.rgw_user_uid)
            if used_bytes is None and used_objects is None:
                continue
            s3_user_usage.append(
                {
                    "user_id": user.id,
                    "user_name": user.name,
                    "rgw_user_uid": user.rgw_user_uid,
                    "used_bytes": used_bytes,
                    "object_count": used_objects,
                    "bucket_count": bucket_count or None,
                }
            )
        s3_user_usage.sort(key=lambda entry: entry.get("used_bytes") or 0, reverse=True)

        storage_totals = {
            "used_bytes": total_bytes if has_bytes else None,
            "object_count": total_objects if has_objects else None,
            "bucket_count": len(normalized_buckets),
            "accounts_with_usage": len(account_usage),
        }

        return {
            **summary,
            "total_buckets": len(normalized_buckets),
            "account_usage": account_usage,
            "s3_user_usage": s3_user_usage,
            "storage_totals": storage_totals,
        }

    def _traffic(self, window: TrafficWindow) -> dict:
        if window not in WINDOW_DELTAS:
            raise ValueError(f"Unsupported window '{window}'.")
        reference = datetime.now(timezone.utc).replace(microsecond=0)
        start = reference - WINDOW_DELTAS[window]
        payload = self._fetch_usage(start=start, end=reference)
        entries = flatten_usage_entries(payload)
        _, _, allowed_identifiers = self._load_scope_targets()
        if allowed_identifiers:
            entries = self._filter_usage_entries(entries, allowed_identifiers)
        else:
            entries = []
        aggregation = aggregate_usage(entries, start=start, end=reference)
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
        targets: list[Tuple[Optional[str], Optional[str]]] = [(None, None), ("*", None)]
        last_payload: Optional[dict] = None
        last_error: Optional[RGWAdminError] = None
        for uid, tenant in targets:
            try:
                payload = self.rgw_admin.get_usage(
                    uid=uid,
                    tenant=tenant,
                    start=start,
                    end=end,
                    show_entries=True,
                    show_summary=False,
                )
            except RGWAdminError as exc:
                last_error = exc
                continue
            last_payload = payload
            entries = flatten_usage_entries(payload)
            if entries:
                return payload
        if last_payload is not None:
            return last_payload
        if last_error is not None:
            raise last_error
        return {}

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
            if acc.rgw_account_id:
                allowed.add(acc.rgw_account_id.strip().lower())
            resolved_uid = resolve_admin_uid(acc.rgw_account_id, acc.rgw_user_uid)
            if resolved_uid:
                allowed.add(resolved_uid.strip().lower())
            if acc.rgw_user_uid:
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
        buckets = extract_bucket_list(payload)

        total_bytes = 0
        total_objects = 0
        has_bytes = False
        has_objects = False

        for bucket in buckets:
            usage_payload = bucket.get("usage") if isinstance(bucket, dict) else None
            used_bytes, used_objects = extract_usage_stats(usage_payload)
            if used_bytes is not None:
                total_bytes += used_bytes
                has_bytes = True
            if used_objects is not None:
                total_objects += used_objects
                has_objects = True

        return (
            total_bytes if has_bytes else None,
            total_objects if has_objects else None,
            len(buckets),
        )

    def _fetch_all_buckets(self) -> list[dict]:
        payload = self.rgw_admin.get_all_buckets(with_stats=True)
        return extract_bucket_list(payload)
