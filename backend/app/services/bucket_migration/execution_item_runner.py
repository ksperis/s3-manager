# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import BucketMigration, BucketMigrationItem
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.time import utcnow

from ._shared import (
    _ResolvedContext,
    _WorkerLeaseLostError,
    _json_dumps,
    _json_loads,
)
from .execution_item_loop import _MigrationItemExecutionLoop
from .execution_settings_copy import _BucketSettingsCopyRunner


class BucketMigrationItemRunnerMixin:
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

    def _stop_interrupted_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> None:
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

    def _store_item_diff(self, item: BucketMigrationItem, diff: Any) -> None:
        item.source_count = diff.source_count
        item.target_count = diff.target_count
        item.matched_count = diff.matched_count
        item.different_count = diff.different_count
        item.only_source_count = diff.only_source_count
        item.only_target_count = diff.only_target_count
        item.diff_sample_json = _json_dumps(diff.sample)

    def _run_verify_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
        control_check: Callable[[], str],
    ) -> bool:
        diff = self._compare_buckets_streamed(
            source_ctx,
            target_ctx,
            source_bucket=item.source_bucket,
            target_bucket=item.target_bucket,
            strategy=strategy,
            control_check=control_check,
        )
        if diff is None:
            self._stop_interrupted_item(migration, item, control_check)
            return False

        self._store_item_diff(item, diff)
        if bool(diff.different_count or diff.only_source_count or diff.only_target_count):
            self._fail_item_for_final_diff(migration, item, diff)
            return False

        if migration.delete_source:
            if not self._verify_source_deletion_safety(
                migration,
                item,
                source_ctx,
                target_ctx,
                strategy=strategy,
                control_check=control_check,
            ):
                return False
            item.step = "delete_source"
            item.updated_at = utcnow()
            self._commit()
            return True

        self._complete_item_after_verification(migration, item, target_ctx)
        return False

    def _fail_item_for_final_diff(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        diff: Any,
    ) -> None:
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

    def _verify_source_deletion_safety(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
        control_check: Callable[[], str],
    ) -> bool:
        if not bool(getattr(migration, "strong_integrity_check", False)):
            self._add_event(
                migration,
                item=item,
                level="warning",
                message=(
                    "Strong integrity check is disabled; source deletion relies on "
                    "md5/size diff only."
                ),
            )
            return True

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
            self._stop_interrupted_item(migration, item, control_check)
            return False
        if failed_keys:
            self._fail_item_for_strong_verification(
                migration,
                item,
                size_only_count=size_only_count,
                verified_count=verified_count,
                failed_keys=failed_keys,
                method_counts=method_counts,
            )
            return False

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
        return True

    def _fail_item_for_strong_verification(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        *,
        size_only_count: int,
        verified_count: int,
        failed_keys: list[str],
        method_counts: dict[str, int],
    ) -> None:
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
                "failed_sample": failed_keys[:20],
                "method_counts": method_counts,
            },
        )
        self._commit()

    def _complete_item_after_verification(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        target_ctx: _ResolvedContext,
    ) -> None:
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

    def _run_create_bucket_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        strategy: str,
    ) -> bool:
        object_lock_enabled = False
        if migration.copy_bucket_settings:
            object_lock = self._configuration.get_bucket_object_lock(item.source_bucket, source_ctx.account)
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
            if not self._is_bucket_already_exists_error(exc):
                raise
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
            return False

        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target bucket created.",
            metadata={"target_bucket": item.target_bucket, "object_lock_enabled": object_lock_enabled},
        )
        item.step = (
            "copy_bucket_settings"
            if migration.copy_bucket_settings
            else self._next_step_after_target_setup(migration, item)
        )
        self._commit()
        return True

    def _run_apply_target_lock_step(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        target_ctx: _ResolvedContext,
    ) -> None:
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
            raise RuntimeError(f"Target write-lock policy could not be applied: {lock_error}") from exc

        item.step = "pre_sync" if migration.mode == "pre_sync" and not item.pre_sync_done else "apply_read_only"
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target write-lock policy applied.",
        )
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
        _MigrationItemExecutionLoop(
            service=self,
            migration=migration,
            item=item,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
            control_check=control_check,
        ).run()

    def _copy_bucket_settings(
        self,
        source_account: S3ExecutionTarget,
        source_bucket: str,
        target_account: S3ExecutionTarget,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> None:
        _BucketSettingsCopyRunner(
            service=self,
            source_account=source_account,
            source_bucket=source_bucket,
            target_account=target_account,
            target_bucket=target_bucket,
            migration=migration,
            item=item,
        ).run()

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

    def _precheck_bucket_exists(self, target_ctx: _ResolvedContext, target_bucket: str) -> Optional[bool]:
        client = self._context_client(target_ctx)
        try:
            client.head_bucket(Bucket=target_bucket)
            return True
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
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
            existing_policy = self._configuration.get_policy(target_bucket, target_ctx.account)
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
            self._configuration.put_policy(target_bucket, target_ctx.account, lock_policy_doc)
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
                self._configuration.put_policy(target_bucket, target_ctx.account, restored)
            else:
                self._configuration.delete_policy(target_bucket, target_ctx.account)
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
        probe_bucket = f"bucketreef-mig-precheck-{migration_id}-{uuid.uuid4().hex[:12]}"
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
