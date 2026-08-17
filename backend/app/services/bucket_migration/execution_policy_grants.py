# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from copy import deepcopy
from typing import Any, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import BucketMigrationItem
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.rgw_identifiers import resolve_admin_uid

from ._shared import (
    _MIGRATION_USER_AGENT_MARKER,
    _READ_ONLY_POLICY_SID,
    _SOURCE_COPY_GRANT_POLICY_SID,
    _TARGET_WRITE_LOCK_POLICY_SID,
    _ResolvedContext,
    _json_dumps,
    _json_loads,
)

logger = logging.getLogger(__name__)


class BucketMigrationPolicyGrantsMixin:
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
        source_account: S3ExecutionTarget,
        backup_policy: Optional[dict[str, Any]],
    ) -> None:
        restored = self._without_managed_source_copy_grant_statement(backup_policy)
        if isinstance(restored, dict):
            self._configuration.put_policy(source_bucket, source_account, restored)
            return
        self._configuration.delete_policy(source_bucket, source_account)

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
            backup_policy = self._configuration.get_policy(source_bucket, source_account)
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
                self._configuration.put_policy(source_bucket, source_account, policy_doc)
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

    def _remove_managed_read_only_statement(self, source_bucket: str, source_account: S3ExecutionTarget) -> None:
        existing_policy = self._configuration.get_policy(source_bucket, source_account)
        cleaned = self._without_managed_read_only_statement(existing_policy)
        if isinstance(cleaned, dict):
            self._configuration.put_policy(source_bucket, source_account, cleaned)
            return
        self._configuration.delete_policy(source_bucket, source_account)

    def _remove_managed_target_write_lock_statement(self, target_bucket: str, target_account: S3ExecutionTarget) -> None:
        existing_policy = self._configuration.get_policy(target_bucket, target_account)
        cleaned = self._without_managed_target_write_lock_statement(existing_policy)
        if isinstance(cleaned, dict):
            self._configuration.put_policy(target_bucket, target_account, cleaned)
            return
        self._configuration.delete_policy(target_bucket, target_account)

    def _set_managed_block_policy(self, source_bucket: str, source_account: S3ExecutionTarget, *, deny_delete: bool) -> None:
        try:
            existing_policy = self._configuration.get_policy(source_bucket, source_account)
            policy_doc = self._build_read_only_policy(
                source_bucket,
                existing_policy if isinstance(existing_policy, dict) else None,
                deny_delete=deny_delete,
            )
            self._configuration.put_policy(source_bucket, source_account, policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                mode = "read-only" if deny_delete else "write-block"
                raise RuntimeError(
                    f"Unable to set source bucket to {mode}: access denied on bucket policy update. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

    def _precheck_policy_roundtrip(self, source_account: S3ExecutionTarget, source_bucket: str) -> None:
        try:
            existing_policy = self._configuration.get_policy(source_bucket, source_account)
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
            self._configuration.put_policy(source_bucket, source_account, policy_doc)
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
                self._configuration.put_policy(source_bucket, source_account, restored)
            else:
                self._configuration.delete_policy(source_bucket, source_account)
        except RuntimeError as exc:
            raise RuntimeError(
                f"Unable to restore source bucket policy after precheck on '{source_bucket}': {exc}"
            ) from exc

    def _apply_read_only_policy(self, source_account: S3ExecutionTarget, source_bucket: str, item: BucketMigrationItem) -> None:
        existing_policy = self._configuration.get_policy(source_bucket, source_account)
        item.source_policy_backup_json = (
            _json_dumps(existing_policy) if isinstance(existing_policy, dict) else None
        )
        policy_doc = self._build_read_only_policy(
            source_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._configuration.put_policy(source_bucket, source_account, policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to set source bucket to read-only: access denied on PutBucketPolicy. "
                    f"Required permissions on '{source_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise

    def _validate_target_lock_worker_access(self, target_ctx: _ResolvedContext, target_bucket: str) -> None:
        client = self._context_client(target_ctx)
        test_key = f"__kaelo-migration-lock-check/{uuid.uuid4().hex}"
        try:
            client.put_object(Bucket=target_bucket, Key=test_key, Body=b"lock-check")
            client.delete_object(Bucket=target_bucket, Key=test_key)
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                "Destination write-lock blocks migration worker write/delete operations. "
                "Use a dedicated migration context or disable destination lock."
            ) from exc

    def _apply_target_write_lock_policy(self, target_ctx: _ResolvedContext, target_bucket: str, item: BucketMigrationItem) -> None:
        existing_policy = self._configuration.get_policy(target_bucket, target_ctx.account)
        item.target_policy_backup_json = (
            _json_dumps(existing_policy) if isinstance(existing_policy, dict) else None
        )
        lock_policy_doc = self._build_target_write_lock_policy(
            target_bucket,
            existing_policy if isinstance(existing_policy, dict) else None,
        )
        try:
            self._configuration.put_policy(target_bucket, target_ctx.account, lock_policy_doc)
        except RuntimeError as exc:
            if self._is_access_denied_error(exc):
                raise RuntimeError(
                    "Unable to set destination bucket write-lock: access denied on PutBucketPolicy. "
                    f"Required permissions on '{target_bucket}': s3:GetBucketPolicy and s3:PutBucketPolicy."
                ) from exc
            raise
        self._validate_target_lock_worker_access(target_ctx, target_bucket)

    def _restore_target_write_lock_policy(self, target_account: S3ExecutionTarget, target_bucket: str, item: BucketMigrationItem) -> None:
        backup = _json_loads(item.target_policy_backup_json)
        if isinstance(backup, dict):
            self._configuration.put_policy(target_bucket, target_account, backup)
            return
        self._configuration.delete_policy(target_bucket, target_account)

    def _restore_source_policy(self, source_bucket: str, source_account: S3ExecutionTarget, item: BucketMigrationItem) -> None:
        backup = _json_loads(item.source_policy_backup_json)
        if isinstance(backup, dict):
            self._configuration.put_policy(source_bucket, source_account, backup)
            return
        self._configuration.delete_policy(source_bucket, source_account)
