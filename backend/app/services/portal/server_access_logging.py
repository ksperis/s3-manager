# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import copy
import hashlib
import logging
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import (
    PortalStorageSpaceMetadata,
    S3Account,
)
from app.models.app_settings import PortalSettings
from app.services import s3_bucket_access, s3_bucket_metadata, s3_client
from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


SERVER_ACCESS_LOGGING_SID = "BucketReefPortalServerAccessLogging"
SERVER_ACCESS_LOGGING_MANAGER_DENY_SID = "BucketReefPortalManagerDeny"
SERVER_ACCESS_LOGGING_PREFIX_ROOT = "portal-server-access/"
SERVER_ACCESS_LOGGING_RETENTION_RULE_ID = "ExpirePortalServerAccessLogs"
SERVER_ACCESS_LOGGING_RETENTION_DEFAULT_DAYS = 30


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
