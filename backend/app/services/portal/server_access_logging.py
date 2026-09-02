# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
import hashlib
import logging
from datetime import date as date_cls
from typing import TYPE_CHECKING, Any, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import (
    AccountIAMUser,
    PortalAccountRole,
    PortalExternalAccessCredential,
    PortalStorageSpaceMetadata,
    S3Account,
    User,
)
from app.models.app_settings import PortalSettings
from app.models.portal import (
    PortalServerAccessLogEntry,
    PortalServerAccessLogFilterQuery,
    PortalServerAccessLogPage,
    PortalServerAccessRequesterIdentity,
    PortalStorageSpaceSummary,
)
from app.services import s3_bucket_access, s3_bucket_metadata, s3_client
from app.services.portal.server_access_log_records import (
    apply_server_access_log_filter,
    dash_to_none,
    parse_standard_access_log_line,
    standard_access_log_bucket,
    standard_access_log_timestamp,
    utc_dates_for_local_day,
    utc_dates_for_local_range,
)
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code
from app.utils.storage_endpoint_features import resolve_admin_endpoint

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


logger = logging.getLogger(__name__)


SERVER_ACCESS_LOGGING_SID = "BucketReefPortalServerAccessLogging"
SERVER_ACCESS_LOGGING_MANAGER_DENY_SID = "BucketReefPortalManagerDeny"
SERVER_ACCESS_LOGGING_PREFIX_ROOT = "portal-server-access/"
SERVER_ACCESS_LOGGING_RETENTION_RULE_ID = "ExpirePortalServerAccessLogs"
SERVER_ACCESS_LOGGING_RETENTION_DEFAULT_DAYS = 30


def _portal_requester_detail(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if len(value) <= 8:
        return value
    return f"{value[:4]}...{value[-4:]}"


class PortalServerAccessLoggingMixin:
    def _portal_server_access_logging_account_ready(self, account: S3Account) -> bool:
        return bool(getattr(account, "storage_endpoint", None) or getattr(account, "storage_endpoint_id", None))

    def _portal_server_access_log_bucket_name(self, account: S3Account) -> str:
        seed = f"{getattr(account, 'rgw_account_id', None) or ''}{account.name or ''}"
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8]
        return f"bkr-portal-access-logs-{account.id}-{digest}"

    def _portal_server_access_log_source_prefix(self, source_bucket: str) -> str:
        return f"{SERVER_ACCESS_LOGGING_PREFIX_ROOT}{source_bucket}/"

    def _portal_server_access_source_account_id(self, account: S3Account) -> str:
        source_account = str(getattr(account, "rgw_account_id", "") or "").strip()
        if source_account:
            return source_account
        raise RuntimeError("Portal Server Access Logging requires an RGW account id.")

    def _portal_server_access_client(self, account: S3Account):
        access_key, secret_key = self._account_credentials(account)
        return get_s3_client(
            access_key,
            secret_key,
            request_profile="long_running",
            **self._s3_client_kwargs(account),
        )

    def _portal_server_access_log_retention_days(self, portal_settings: PortalSettings) -> int:
        try:
            retention_days = int(
                getattr(
                    portal_settings,
                    "server_access_log_retention_days",
                    SERVER_ACCESS_LOGGING_RETENTION_DEFAULT_DAYS,
                )
                or SERVER_ACCESS_LOGGING_RETENTION_DEFAULT_DAYS
            )
        except (TypeError, ValueError):
            retention_days = SERVER_ACCESS_LOGGING_RETENTION_DEFAULT_DAYS
        return max(1, retention_days)

    def _portal_server_access_log_lifecycle_rules(self, portal_settings: PortalSettings) -> list[dict]:
        return [
            {
                "ID": SERVER_ACCESS_LOGGING_RETENTION_RULE_ID,
                "Status": "Enabled",
                "Prefix": SERVER_ACCESS_LOGGING_PREFIX_ROOT,
                "Expiration": {"Days": self._portal_server_access_log_retention_days(portal_settings)},
            }
        ]

    def _put_portal_server_access_log_lifecycle(
        self,
        account: S3Account,
        log_bucket: str,
        portal_settings: PortalSettings,
    ) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_lifecycle(
            log_bucket,
            rules=self._portal_server_access_log_lifecycle_rules(portal_settings),
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )

    def _ensure_portal_server_access_log_bucket(
        self,
        account: S3Account,
        *,
        portal_settings: Optional[PortalSettings] = None,
    ) -> str:
        log_bucket = self._portal_server_access_log_bucket_name(account)
        client = self._portal_server_access_client(account)
        created = False
        try:
            client.head_bucket(Bucket=log_bucket)
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
            if code not in {"404", "notfound", "nosuchbucket"}:
                raise RuntimeError(f"Unable to inspect Portal access log bucket '{log_bucket}': {exc}") from exc
            access_key, secret_key = self._account_credentials(account)
            s3_client.create_bucket(
                log_bucket,
                access_key=access_key,
                secret_key=secret_key,
                **self._s3_client_kwargs(account),
            )
            created = True
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to inspect Portal access log bucket '{log_bucket}': {exc}") from exc
        if created:
            self._put_portal_server_access_log_lifecycle(
                account,
                log_bucket,
                portal_settings or self._effective_portal_settings(account),
            )
        return log_bucket

    def _portal_server_access_log_policy(self, account: S3Account, log_bucket: str, existing_policy: Optional[dict]) -> dict:
        if isinstance(existing_policy, dict) and "raw" in existing_policy:
            raise RuntimeError(f"Unable to merge unreadable bucket policy on Portal access log bucket '{log_bucket}'.")
        policy = copy.deepcopy(existing_policy) if isinstance(existing_policy, dict) else None
        if policy is None:
            policy = {"Version": "2012-10-17", "Statement": []}
        statements = policy.get("Statement") or []
        if not isinstance(statements, list):
            statements = [statements]
        managed_sids = {SERVER_ACCESS_LOGGING_SID, SERVER_ACCESS_LOGGING_MANAGER_DENY_SID}
        filtered = [
            stmt
            for stmt in statements
            if not (isinstance(stmt, dict) and stmt.get("Sid") in managed_sids)
        ]
        filtered.append(
            {
                "Sid": SERVER_ACCESS_LOGGING_SID,
                "Effect": "Allow",
                "Principal": {"Service": "logging.s3.amazonaws.com"},
                "Action": "s3:PutObject",
                "Resource": f"arn:aws:s3:::{log_bucket}/{SERVER_ACCESS_LOGGING_PREFIX_ROOT}*",
                "Condition": {
                    "StringEquals": {"aws:SourceAccount": self._portal_server_access_source_account_id(account)},
                    "ArnLike": {"aws:SourceArn": "arn:aws:s3:::*"},
                },
            }
        )
        manager_principals = self._portal_manager_principal_arns(account)
        if manager_principals:
            filtered.append(
                {
                    "Sid": SERVER_ACCESS_LOGGING_MANAGER_DENY_SID,
                    "Effect": "Deny",
                    "Principal": {"AWS": manager_principals},
                    "Action": "s3:*",
                    "Resource": [
                        f"arn:aws:s3:::{log_bucket}",
                        f"arn:aws:s3:::{log_bucket}/*",
                    ],
                }
            )
        policy["Statement"] = filtered
        if "Version" not in policy:
            policy["Version"] = "2012-10-17"
        return policy

    def _ensure_portal_server_access_log_bucket_policy(self, account: S3Account, log_bucket: str) -> None:
        access_key, secret_key = self._account_credentials(account)
        kwargs = self._s3_client_kwargs(account)
        existing_policy = s3_bucket_access.get_bucket_policy(
            log_bucket,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        policy = self._portal_server_access_log_policy(account, log_bucket, existing_policy)
        s3_bucket_access.put_bucket_policy(
            log_bucket,
            policy=policy,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )

    def _sync_portal_server_access_log_bucket_policy_if_present(self, account: S3Account) -> None:
        if not self._portal_server_access_logging_account_ready(account):
            return
        log_bucket = self._portal_server_access_log_bucket_name(account)
        client = self._portal_server_access_client(account)
        try:
            client.head_bucket(Bucket=log_bucket)
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
            if code in {"404", "notfound", "nosuchbucket"}:
                return
            raise RuntimeError(f"Unable to inspect Portal access log bucket '{log_bucket}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to inspect Portal access log bucket '{log_bucket}': {exc}") from exc
        self._ensure_portal_server_access_log_bucket_policy(account, log_bucket)

    def _put_portal_server_access_logging(self, account: S3Account, source_bucket: str, log_bucket: str) -> None:
        if source_bucket == log_bucket:
            return
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_logging(
            source_bucket,
            logging_config={
                "TargetBucket": log_bucket,
                "TargetPrefix": self._portal_server_access_log_source_prefix(source_bucket),
            },
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )

    def _delete_managed_portal_server_access_logging(self, account: S3Account, source_bucket: str) -> bool:
        access_key, secret_key = self._account_credentials(account)
        kwargs = self._s3_client_kwargs(account)
        log_bucket = self._portal_server_access_log_bucket_name(account)
        current = s3_bucket_metadata.get_bucket_logging(
            source_bucket,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        if not current:
            return False
        target_bucket = str(current.get("target_bucket") or "")
        target_prefix = str(current.get("target_prefix") or "")
        if target_bucket != log_bucket or not target_prefix.startswith(SERVER_ACCESS_LOGGING_PREFIX_ROOT):
            logger.info(
                "Skipping unmanaged Portal Server Access Logging config on %s: target=%s prefix=%s",
                source_bucket,
                target_bucket,
                target_prefix,
            )
            return False
        s3_bucket_metadata.put_bucket_logging(
            source_bucket,
            logging_config=None,
            access_key=access_key,
            secret_key=secret_key,
            **kwargs,
        )
        return True

    def sync_storage_space_server_access_logging(
        self,
        account: S3Account,
        source_bucket: str,
        *,
        portal_settings: Optional[PortalSettings] = None,
    ) -> None:
        effective = portal_settings or self._effective_portal_settings(account)
        if not effective.server_access_logging_enabled:
            return
        if not self._portal_server_access_logging_account_ready(account):
            logger.debug("Skipping Portal Server Access Logging without a storage endpoint: account=%s", account.id)
            return
        log_bucket = self._ensure_portal_server_access_log_bucket(account, portal_settings=effective)
        self._ensure_portal_server_access_log_bucket_policy(account, log_bucket)
        self._put_portal_server_access_logging(account, source_bucket, log_bucket)

    def reconcile_portal_server_access_logging(
        self,
        account: S3Account,
        *,
        portal_settings: Optional[PortalSettings] = None,
    ) -> dict[str, int]:
        effective = portal_settings or self._effective_portal_settings(account)
        metadata_rows = (
            self.db.query(PortalStorageSpaceMetadata)
            .filter(PortalStorageSpaceMetadata.account_id == account.id)
            .all()
        )
        summary = {"enabled": 0, "disabled": 0, "skipped": 0}
        if not metadata_rows:
            return summary
        if not self._portal_server_access_logging_account_ready(account):
            summary["skipped"] = len(metadata_rows)
            return summary
        if effective.server_access_logging_enabled:
            log_bucket = self._ensure_portal_server_access_log_bucket(account, portal_settings=effective)
            self._ensure_portal_server_access_log_bucket_policy(account, log_bucket)
            for metadata in metadata_rows:
                source_bucket = metadata.bucket_name
                if source_bucket == log_bucket:
                    summary["skipped"] += 1
                    continue
                self._put_portal_server_access_logging(account, source_bucket, log_bucket)
                summary["enabled"] += 1
            return summary
        for metadata in metadata_rows:
            if self._delete_managed_portal_server_access_logging(account, metadata.bucket_name):
                summary["disabled"] += 1
            else:
                summary["skipped"] += 1
        return summary

    def reconcile_all_portal_server_access_logging(self, base_settings: PortalSettings) -> dict[str, int]:
        account_ids = [
            account_id
            for (account_id,) in self.db.query(PortalStorageSpaceMetadata.account_id).distinct().all()
            if account_id is not None
        ]
        summary = {"accounts": 0, "enabled": 0, "disabled": 0, "skipped": 0}
        if not account_ids:
            return summary
        accounts = self.db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        errors: list[str] = []
        for account in accounts:
            effective = self._effective_portal_settings(account, base_settings=base_settings)
            try:
                result = self.reconcile_portal_server_access_logging(account, portal_settings=effective)
            except Exception as exc:
                errors.append(f"{account.name or account.id}: {exc}")
                continue
            summary["accounts"] += 1
            summary["enabled"] += result["enabled"]
            summary["disabled"] += result["disabled"]
            summary["skipped"] += result["skipped"]
        if errors:
            sample = "; ".join(errors[:3])
            extra = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
            raise RuntimeError(f"Unable to reconcile Portal Server Access Logging: {sample}{extra}")
        return summary

    def _list_portal_server_access_log_objects(
        self,
        client: Any,
        log_bucket: str,
        prefixes: list[str],
        *,
        max_objects: int = 2000,
    ) -> list[str]:
        keys: list[str] = []
        for prefix in prefixes:
            continuation_token = None
            while True:
                kwargs: dict[str, Any] = {"Bucket": log_bucket, "Prefix": prefix, "MaxKeys": 1000}
                if continuation_token:
                    kwargs["ContinuationToken"] = continuation_token
                try:
                    page = client.list_objects_v2(**kwargs)
                except ClientError as exc:
                    code = aws_error_code(exc, lowercase=True)
                    if code in {"nosuchbucket", "404", "notfound"}:
                        return []
                    raise RuntimeError(f"Unable to list Portal Server Access Logging objects: {exc}") from exc
                except BotoCoreError as exc:
                    raise RuntimeError(f"Unable to list Portal Server Access Logging objects: {exc}") from exc
                for item in page.get("Contents", []) or []:
                    key = item.get("Key")
                    if key:
                        keys.append(str(key))
                        if len(keys) >= max_objects:
                            return keys
                continuation_token = page.get("NextContinuationToken")
                if not continuation_token:
                    break
        return sorted(set(keys), reverse=True)

    def _read_portal_server_access_log_object(self, client: Any, log_bucket: str, object_key: str) -> bytes:
        try:
            response = client.get_object(Bucket=log_bucket, Key=object_key)
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
            if code in {"nosuchkey", "404", "notfound"}:
                return b""
            raise RuntimeError(f"Unable to read Portal Server Access Logging object '{object_key}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to read Portal Server Access Logging object '{object_key}': {exc}") from exc
        body = response.get("Body")
        return body.read() if body is not None else b""

    def _portal_server_access_space_by_bucket(
        self,
        user: User,
        access: "AccountAccess",
        *,
        space_id: Optional[str] = None,
    ) -> dict[str, PortalStorageSpaceSummary]:
        visible_spaces = self._visible_storage_space_lookup(user, access)
        selected_space = visible_spaces.get(space_id) if space_id else None
        if space_id and selected_space is None:
            raise RuntimeError("Storage space not found or not allowed.")
        candidate_spaces = [selected_space] if selected_space else list(visible_spaces.values())
        space_by_bucket: dict[str, PortalStorageSpaceSummary] = {}
        seen_space_ids: set[str] = set()
        for space in candidate_spaces:
            if not space or space.id in seen_space_ids:
                continue
            seen_space_ids.add(space.id)
            bucket_name = space.internal_bucket_name or space.id
            if bucket_name:
                space_by_bucket[bucket_name] = space
        return space_by_bucket

    def _unknown_portal_server_access_identity(self, requester: Optional[str]) -> PortalServerAccessRequesterIdentity:
        return PortalServerAccessRequesterIdentity(
            label="Unknown S3 identity",
            kind="unknown",
            detail=_portal_requester_detail(requester),
            resolved=False,
        )

    def _portal_server_access_rgw_admin_client(self, account: S3Account) -> Optional[RGWAdminClient]:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            return None
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            return None
        access_key = getattr(endpoint, "supervision_access_key", None) or getattr(endpoint, "admin_access_key", None)
        secret_key = getattr(endpoint, "supervision_secret_key", None) or getattr(endpoint, "admin_secret_key", None)
        if not access_key or not secret_key:
            return None
        return get_rgw_admin_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=admin_endpoint,
            region=getattr(endpoint, "region", None),
            verify_tls=bool(getattr(endpoint, "verify_tls", True)),
        )

    def _portal_server_access_identity_from_rgw_payload(
        self,
        payload: Optional[dict[str, Any]],
    ) -> Optional[PortalServerAccessRequesterIdentity]:
        if not isinstance(payload, dict) or payload.get("not_found"):
            return None
        candidates: list[dict[str, Any]] = [payload]
        user_payload = payload.get("user")
        if isinstance(user_payload, dict):
            candidates.append(user_payload)
        uid = None
        account_id = None
        display_name = None
        for candidate in candidates:
            uid = dash_to_none(candidate.get("uid") or candidate.get("user_id") or (candidate.get("user") if isinstance(candidate.get("user"), str) else None))
            if uid:
                break
        for candidate in candidates:
            account_id = dash_to_none(candidate.get("account_id") or candidate.get("account") or candidate.get("tenant"))
            if account_id:
                break
        for candidate in candidates:
            display_name = dash_to_none(candidate.get("display_name") or candidate.get("name") or candidate.get("email"))
            if display_name:
                break
        if uid:
            return PortalServerAccessRequesterIdentity(
                label=display_name or uid,
                kind="rgw_user",
                detail=f"RGW user {uid}" + (f" · account {account_id}" if account_id else ""),
                iam_username=uid,
                email=display_name if isinstance(display_name, str) and "@" in display_name else None,
                resolved=True,
            )
        if account_id:
            return PortalServerAccessRequesterIdentity(
                label=account_id,
                kind="rgw_account",
                detail="RGW account",
                resolved=True,
            )
        return None

    def _resolve_portal_server_access_requester_identities(
        self,
        account: S3Account,
        entries: list[PortalServerAccessLogEntry],
    ) -> None:
        requesters = sorted({entry.requester for entry in entries if entry.requester})
        if not requesters:
            return
        identity_by_requester: dict[str, PortalServerAccessRequesterIdentity] = {}

        external_rows = (
            self.db.query(PortalExternalAccessCredential)
            .filter(
                PortalExternalAccessCredential.account_id == account.id,
                PortalExternalAccessCredential.iam_user_id.in_(requesters),
            )
            .all()
        )
        for credential in external_rows:
            if not credential.iam_user_id:
                continue
            metadata = credential.storage_space
            space_name = self._display_storage_space_name(credential.bucket_name, metadata)
            permission_label = "read/write" if credential.permission == "read_write" else "read-only"
            identity_by_requester[credential.iam_user_id] = PortalServerAccessRequesterIdentity(
                label=credential.external_email,
                kind="external_access",
                detail=f"External access · {credential.iam_username} · {space_name} · {permission_label}",
                access_key_id=credential.access_key_id,
                iam_username=credential.iam_username,
                email=credential.external_email,
                resolved=True,
            )

        portal_rows = (
            self.db.query(AccountIAMUser, User)
            .join(User, AccountIAMUser.user_id == User.id)
            .filter(
                AccountIAMUser.account_id == account.id,
                AccountIAMUser.iam_user_id.in_(requesters),
            )
            .all()
        )
        for link, linked_user in portal_rows:
            if not link.iam_user_id or link.iam_user_id in identity_by_requester:
                continue
            label = link.iam_username or linked_user.full_name or linked_user.email
            detail_parts = ["Portal user"]
            user_label = linked_user.full_name or linked_user.email
            if user_label and user_label != label:
                detail_parts.append(user_label)
            identity_by_requester[link.iam_user_id] = PortalServerAccessRequesterIdentity(
                label=label,
                kind="portal_user",
                detail=" · ".join(detail_parts),
                access_key_id=link.active_access_key,
                iam_username=link.iam_username,
                user_id=linked_user.id,
                email=linked_user.email,
                resolved=True,
            )

        unknown_requesters = [requester for requester in requesters if requester not in identity_by_requester]
        if unknown_requesters:
            rgw_cache: dict[str, PortalServerAccessRequesterIdentity] = {}
            try:
                rgw_admin = self._portal_server_access_rgw_admin_client(account)
            except Exception as exc:
                logger.debug("Unable to prepare RGW Admin requester identity resolver for account %s: %s", account.id, exc)
                rgw_admin = None
            if rgw_admin is not None:
                for requester in unknown_requesters:
                    try:
                        identity = self._portal_server_access_identity_from_rgw_payload(
                            rgw_admin.get_user(requester, allow_not_found=True),
                        )
                    except Exception as exc:
                        logger.debug("Unable to resolve requester identity for %s: %s", requester, exc)
                        identity = None
                    rgw_cache[requester] = identity or self._unknown_portal_server_access_identity(requester)
                identity_by_requester.update(rgw_cache)

        for entry in entries:
            if not entry.requester:
                entry.requester_identity = self._unknown_portal_server_access_identity(None)
                continue
            entry.requester_identity = identity_by_requester.get(entry.requester) or self._unknown_portal_server_access_identity(entry.requester)

    def _collect_portal_server_access_logs(
        self,
        user: User,
        access: "AccountAccess",
        *,
        date: str,
        space_id: Optional[str] = None,
        timezone_offset_minutes: int = 0,
    ) -> list[PortalServerAccessLogEntry]:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can access Portal server access logs")
        try:
            selected_date = date_cls.fromisoformat(date)
        except ValueError as exc:
            raise ValueError("date must use YYYY-MM-DD format") from exc
        space_by_bucket = self._portal_server_access_space_by_bucket(user, access, space_id=space_id)
        if not space_by_bucket:
            return []
        start_utc, end_utc, utc_dates = utc_dates_for_local_day(selected_date, timezone_offset_minutes)
        log_bucket = self._portal_server_access_log_bucket_name(access.account)
        prefixes = [
            f"{self._portal_server_access_log_source_prefix(bucket_name)}{utc_date.isoformat()}"
            for bucket_name in sorted(space_by_bucket)
            for utc_date in utc_dates
        ]
        client = self._portal_server_access_client(access.account)
        object_keys = self._list_portal_server_access_log_objects(client, log_bucket, prefixes)
        entries: list[PortalServerAccessLogEntry] = []
        for object_key in object_keys:
            content = self._read_portal_server_access_log_object(client, log_bucket, object_key)
            for raw_line in content.decode("utf-8", errors="replace").splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                entry = parse_standard_access_log_line(
                    line,
                    log_object_key=object_key,
                    space_by_bucket=space_by_bucket,
                )
                if entry is None:
                    continue
                if not (start_utc <= entry.timestamp < end_utc):
                    continue
                entries.append(entry)
        self._resolve_portal_server_access_requester_identities(access.account, entries)
        entries.sort(key=lambda item: item.timestamp, reverse=True)
        return entries

    def list_portal_server_access_logs(
        self,
        user: User,
        access: "AccountAccess",
        *,
        date: str,
        space_id: Optional[str] = None,
        timezone_offset_minutes: int = 0,
        limit: int = 200,
        offset: int = 0,
        advanced_filter: Optional[PortalServerAccessLogFilterQuery] = None,
    ) -> list[PortalServerAccessLogEntry]:
        query_limit = min(max(int(limit), 1), 1000)
        query_offset = max(int(offset), 0)
        entries = self._collect_portal_server_access_logs(
            user,
            access,
            date=date,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
        )
        entries = apply_server_access_log_filter(entries, advanced_filter)
        return entries[query_offset : query_offset + query_limit]

    def list_portal_server_access_log_page(
        self,
        user: User,
        access: "AccountAccess",
        *,
        date: str,
        space_id: Optional[str] = None,
        timezone_offset_minutes: int = 0,
        limit: int = 200,
        offset: int = 0,
        advanced_filter: Optional[PortalServerAccessLogFilterQuery] = None,
    ) -> PortalServerAccessLogPage:
        query_limit = min(max(int(limit), 1), 1000)
        query_offset = max(int(offset), 0)
        entries = self._collect_portal_server_access_logs(
            user,
            access,
            date=date,
            space_id=space_id,
            timezone_offset_minutes=timezone_offset_minutes,
        )
        entries = apply_server_access_log_filter(entries, advanced_filter)
        return PortalServerAccessLogPage(
            entries=entries[query_offset : query_offset + query_limit],
            total=len(entries),
            limit=query_limit,
            offset=query_offset,
        )

    def get_portal_server_access_logs_raw(
        self,
        user: User,
        access: "AccountAccess",
        *,
        date_from: str,
        date_to: str,
        space_id: Optional[str] = None,
        timezone_offset_minutes: int = 0,
        max_objects: int = 10000,
    ) -> str:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise RuntimeError("Only project managers can access Portal server access logs")
        try:
            start_date = date_cls.fromisoformat(date_from)
            end_date = date_cls.fromisoformat(date_to)
        except ValueError as exc:
            raise ValueError("dates must use YYYY-MM-DD format") from exc
        start_utc, end_utc, utc_dates = utc_dates_for_local_range(start_date, end_date, timezone_offset_minutes)
        space_by_bucket = self._portal_server_access_space_by_bucket(user, access, space_id=space_id)
        if not space_by_bucket:
            return ""
        log_bucket = self._portal_server_access_log_bucket_name(access.account)
        prefixes = [
            f"{self._portal_server_access_log_source_prefix(bucket_name)}{utc_date.isoformat()}"
            for bucket_name in sorted(space_by_bucket)
            for utc_date in utc_dates
        ]
        client = self._portal_server_access_client(access.account)
        object_keys = self._list_portal_server_access_log_objects(client, log_bucket, prefixes, max_objects=max_objects)
        lines: list[str] = []
        for object_key in object_keys:
            content = self._read_portal_server_access_log_object(client, log_bucket, object_key)
            for raw_line in content.decode("utf-8", errors="replace").splitlines():
                line = raw_line.rstrip("\r\n")
                if not line.strip():
                    continue
                bucket_name = standard_access_log_bucket(line)
                if bucket_name not in space_by_bucket:
                    continue
                timestamp = standard_access_log_timestamp(line)
                if timestamp is None or not (start_utc <= timestamp < end_utc):
                    continue
                lines.append(line)
        return "\n".join(lines) + ("\n" if lines else "")
