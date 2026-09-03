# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Callable

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_execution_context import S3ExecutionTarget
from app.models.bucket_purge import (
    BucketPurgeBucketResult,
    BucketPurgeFailure,
    BucketPurgeProgress,
    BucketPurgeResult,
    BucketPurgeStage,
    BucketPurgeStatus,
)
from app.services import s3_deletion
from app.services.buckets_service import BucketsService
from app.services.long_running_s3_client import LongRunningS3ClientMixin
from app.utils.aws_errors import aws_error_code
from app.utils.s3_errors import format_s3_error
from app.core.sensitive_data import sanitized_error_log_detail


logger = logging.getLogger(__name__)
ProgressCallback = Callable[[BucketPurgeProgress], None]
CancelCheck = Callable[[], None]


def _normalize_progress_stage(stage: str) -> BucketPurgeStage:
    if stage == "list":
        return "list"
    if stage == "versions":
        return "versions"
    if stage == "delete_bucket":
        return "delete_bucket"
    if stage == "completed":
        return "completed"
    return "delete"


class BucketPurgeCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketPurgeResolvedTarget:
    account: S3ExecutionTarget
    bucket_name: str
    context_id: str | None = None
    context_name: str | None = None


@dataclass(frozen=True)
class BucketPurgeOptions:
    parallelism: int = 10
    include_versions: bool = True
    individual_deletes: bool = False


@dataclass
class _BucketDeletePurgeState:
    target: BucketPurgeResolvedTarget
    options: BucketPurgeOptions
    total_entries_estimate: int | None
    progress_callback: ProgressCallback
    cancel_check: CancelCheck | None
    started_at: float = field(default_factory=monotonic)
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0


class BucketPurgeService(LongRunningS3ClientMixin):
    s3_user_agent_extra = "bucketreef-bucket-purge"

    def _resolve_initial_entry_estimates(self, targets: list[BucketPurgeResolvedTarget]) -> list[int | None]:
        estimates: list[int | None] = [None for _ in targets]
        if not targets:
            return estimates

        grouped_indexes: dict[str, list[int]] = {}
        for index, target in enumerate(targets):
            context_key = target.context_id or f"account-object:{id(target.account)}"
            grouped_indexes.setdefault(context_key, []).append(index)

        buckets_service = BucketsService()
        for indexes in grouped_indexes.values():
            account = targets[indexes[0]].account
            try:
                buckets = buckets_service.list_buckets(account, with_stats=True)
            except Exception as exc:  # noqa: BLE001 - stats are best-effort only.
                logger.info(
                    "Unable to resolve bucket purge entry estimates for context=%s: %s",
                    targets[indexes[0]].context_id,
                    sanitized_error_log_detail(exc),
                )
                continue

            object_counts_by_name: dict[str, int] = {}
            for bucket in buckets:
                if bucket.object_count is None:
                    continue
                try:
                    object_count = int(bucket.object_count)
                except (TypeError, ValueError):
                    continue
                if object_count >= 0:
                    object_counts_by_name[bucket.name] = object_count
            for index in indexes:
                estimates[index] = object_counts_by_name.get(targets[index].bucket_name)

        return estimates

    def _sum_known_entry_estimates(self, estimates: list[int | None]) -> int | None:
        known_estimates = [estimate for estimate in estimates if estimate is not None]
        if not known_estimates:
            return None
        return sum(known_estimates)

    def _progress_total_entries_estimate(
        self,
        initial_total_entries_estimate: int | None,
        *,
        listed_objects: int,
        listed_versions: int,
        deleted_objects: int,
        deleted_versions: int,
        total_entries_final: bool = False,
    ) -> int | None:
        discovered_total = max(listed_objects + listed_versions, deleted_objects + deleted_versions)
        if total_entries_final:
            return discovered_total
        if initial_total_entries_estimate is None:
            return discovered_total if discovered_total > 0 else None
        return max(initial_total_entries_estimate, discovered_total)

    def run(
        self,
        targets: list[BucketPurgeResolvedTarget],
        options: BucketPurgeOptions,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketPurgeResult:
        started_at = datetime.now(timezone.utc)
        bucket_results: list[BucketPurgeBucketResult] = []
        total_listed_objects = 0
        total_listed_versions = 0
        total_deleted_objects = 0
        total_deleted_versions = 0
        total_failed = 0
        initial_entry_estimates = self._resolve_initial_entry_estimates(targets)
        initial_total_entries_estimate = self._sum_known_entry_estimates(initial_entry_estimates)

        def emit(progress: BucketPurgeProgress) -> None:
            if progress_callback:
                progress_callback(progress)

        emit(
            BucketPurgeProgress(
                stage="prepare",
                total_buckets=len(targets),
                completed_buckets=0,
                total_entries_estimate=initial_total_entries_estimate,
                total_entries_final=False,
                message="Preparing bucket purge...",
            )
        )

        for index, target in enumerate(targets):
            if cancel_check:
                cancel_check()
            bucket_result = self._run_bucket(
                target,
                options,
                total_buckets=len(targets),
                completed_buckets=index,
                base_listed_objects=total_listed_objects,
                base_listed_versions=total_listed_versions,
                base_deleted_objects=total_deleted_objects,
                base_deleted_versions=total_deleted_versions,
                base_failed_count=total_failed,
                total_entries_estimate=initial_total_entries_estimate,
                is_last_bucket=index == len(targets) - 1,
                progress_callback=emit,
                cancel_check=cancel_check,
            )
            bucket_results.append(bucket_result)
            total_listed_objects += bucket_result.listed_objects
            total_listed_versions += bucket_result.listed_versions
            total_deleted_objects += bucket_result.deleted_objects
            total_deleted_versions += bucket_result.deleted_versions
            total_failed += bucket_result.failed_count
            total_entries_estimate = self._progress_total_entries_estimate(
                initial_total_entries_estimate,
                listed_objects=total_listed_objects,
                listed_versions=total_listed_versions,
                deleted_objects=total_deleted_objects,
                deleted_versions=total_deleted_versions,
                total_entries_final=index == len(targets) - 1 and bucket_result.status != "failed",
            )
            total_entries_final = index == len(targets) - 1 and bucket_result.status != "failed"
            emit(
                BucketPurgeProgress(
                    stage="completed",
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=len(targets),
                    completed_buckets=index + 1,
                    listed_objects=total_listed_objects,
                    listed_versions=total_listed_versions,
                    deleted_objects=total_deleted_objects,
                    deleted_versions=total_deleted_versions,
                    total_entries_estimate=total_entries_estimate,
                    total_entries_final=total_entries_final,
                    failed_count=total_failed,
                    message=f"Completed purge for {target.bucket_name}.",
                )
            )

        status: BucketPurgeStatus = "completed"
        if bucket_results and all(item.status == "failed" for item in bucket_results):
            status = "failed"
        elif total_failed > 0 or any(item.status != "completed" for item in bucket_results):
            status = "completed_with_errors"

        finished_at = datetime.now(timezone.utc)
        return BucketPurgeResult(
            status=status,
            total_buckets=len(targets),
            completed_buckets=len(bucket_results),
            listed_objects=total_listed_objects,
            listed_versions=total_listed_versions,
            deleted_objects=total_deleted_objects,
            deleted_versions=total_deleted_versions,
            failed_count=total_failed,
            bucket_deleted=False,
            started_at=started_at,
            finished_at=finished_at,
            buckets=bucket_results,
        )

    def run_delete_bucket_with_purge(
        self,
        target: BucketPurgeResolvedTarget,
        options: BucketPurgeOptions,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketPurgeResult:
        started_at = datetime.now(timezone.utc)
        initial_entry_estimates = self._resolve_initial_entry_estimates([target])
        initial_total_entries_estimate = self._sum_known_entry_estimates(initial_entry_estimates)

        def emit(progress: BucketPurgeProgress) -> None:
            if progress_callback:
                progress_callback(progress)

        emit(
            BucketPurgeProgress(
                stage="prepare",
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                total_buckets=1,
                completed_buckets=0,
                total_entries_estimate=initial_total_entries_estimate,
                total_entries_final=False,
                message="Preparing bucket deletion...",
            )
        )
        bucket_result = self._run_bucket_delete_with_purge(
            target,
            options,
            total_entries_estimate=initial_total_entries_estimate,
            progress_callback=emit,
            cancel_check=cancel_check,
        )
        status: BucketPurgeStatus = (
            "completed" if bucket_result.bucket_deleted and bucket_result.failed_count == 0 else "failed"
        )
        finished_at = datetime.now(timezone.utc)
        return BucketPurgeResult(
            status=status,
            total_buckets=1,
            completed_buckets=1 if bucket_result.bucket_deleted else 0,
            listed_objects=bucket_result.listed_objects,
            listed_versions=bucket_result.listed_versions,
            deleted_objects=bucket_result.deleted_objects,
            deleted_versions=bucket_result.deleted_versions,
            failed_count=bucket_result.failed_count,
            bucket_deleted=bucket_result.bucket_deleted,
            started_at=started_at,
            finished_at=finished_at,
            buckets=[bucket_result],
        )

    def _run_bucket(
        self,
        target: BucketPurgeResolvedTarget,
        options: BucketPurgeOptions,
        *,
        total_buckets: int,
        completed_buckets: int,
        base_listed_objects: int,
        base_listed_versions: int,
        base_deleted_objects: int,
        base_deleted_versions: int,
        base_failed_count: int,
        total_entries_estimate: int | None,
        is_last_bucket: bool,
        progress_callback: ProgressCallback,
        cancel_check: CancelCheck | None,
    ) -> BucketPurgeBucketResult:
        started = monotonic()

        def low_progress(progress: s3_deletion.BucketContentPurgeProgress) -> None:
            stage = _normalize_progress_stage(progress.stage)
            listed_objects = base_listed_objects + progress.listed_objects
            listed_versions = base_listed_versions + progress.listed_versions
            deleted_objects = base_deleted_objects + progress.deleted_objects
            deleted_versions = base_deleted_versions + progress.deleted_versions
            progress_callback(
                BucketPurgeProgress(
                    stage=stage,
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=total_buckets,
                    completed_buckets=completed_buckets,
                    listed_objects=listed_objects,
                    listed_versions=listed_versions,
                    deleted_objects=deleted_objects,
                    deleted_versions=deleted_versions,
                    total_entries_estimate=self._progress_total_entries_estimate(
                        total_entries_estimate,
                        listed_objects=listed_objects,
                        listed_versions=listed_versions,
                        deleted_objects=deleted_objects,
                        deleted_versions=deleted_versions,
                        total_entries_final=is_last_bucket and stage == "completed",
                    ),
                    total_entries_final=is_last_bucket and stage == "completed",
                    failed_count=base_failed_count + progress.failed_count,
                    bucket_deleted=False,
                    message=progress.message,
                )
            )

        try:
            client = self._build_client(target.account)
            result = s3_deletion.purge_bucket_contents(
                client,
                target.bucket_name,
                parallelism=options.parallelism,
                include_versions=options.include_versions,
                individual_deletes=options.individual_deletes,
                progress_callback=low_progress,
                cancel_check=cancel_check,
            )
            status: BucketPurgeStatus = "completed" if result.failed_count == 0 else "completed_with_errors"
            failures = [
                BucketPurgeFailure(
                    bucket_name=target.bucket_name,
                    stage=failure.stage,
                    message=failure.message,
                    key=failure.key,
                    version_id=failure.version_id,
                    count=failure.count,
                )
                for failure in result.failures_sample
            ]
            return BucketPurgeBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status=status,
                listed_objects=result.listed_objects,
                listed_versions=result.listed_versions,
                deleted_objects=result.deleted_objects,
                deleted_versions=result.deleted_versions,
                failed_count=result.failed_count,
                bucket_deleted=False,
                duration_seconds=round(monotonic() - started, 3),
                failures_sample=failures,
            )
        except BucketPurgeCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            return BucketPurgeBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status="failed",
                failed_count=1,
                bucket_deleted=False,
                duration_seconds=round(monotonic() - started, 3),
                failures_sample=[
                    BucketPurgeFailure(
                        bucket_name=target.bucket_name,
                        stage="list",
                        message=sanitized_error_log_detail(exc),
                    )
                ],
            )

    def _run_bucket_delete_with_purge(
        self,
        target: BucketPurgeResolvedTarget,
        options: BucketPurgeOptions,
        *,
        total_entries_estimate: int | None,
        progress_callback: ProgressCallback,
        cancel_check: CancelCheck | None,
    ) -> BucketPurgeBucketResult:
        state = _BucketDeletePurgeState(
            target=target,
            options=options,
            total_entries_estimate=total_entries_estimate,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
        try:
            client = self._build_client(target.account)
            purge_result = s3_deletion.purge_bucket_contents(
                client,
                target.bucket_name,
                parallelism=state.options.parallelism,
                include_versions=state.options.include_versions,
                individual_deletes=state.options.individual_deletes,
                progress_callback=lambda progress: self._emit_delete_purge_progress(
                    state,
                    progress,
                ),
                cancel_check=state.cancel_check,
            )
            self._apply_delete_purge_result(state, purge_result)
            if purge_result.failed_count > 0:
                return self._delete_purge_failure_result(state, purge_result)

            self._emit_bucket_deletion_progress(
                state,
                stage="delete_bucket",
                completed_buckets=0,
                bucket_deleted=False,
                message=f"Deleting bucket {target.bucket_name}...",
            )
            delete_failure = self._delete_empty_bucket(client, state)
            if delete_failure is not None:
                return delete_failure
            self._emit_bucket_deletion_progress(
                state,
                stage="completed",
                completed_buckets=1,
                bucket_deleted=True,
                message=f"Deleted bucket {target.bucket_name}.",
            )
            return self._build_bucket_delete_result(
                state,
                status="completed",
                failed_count=0,
                bucket_deleted=True,
                failures_sample=[],
            )
        except BucketPurgeCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            return self._bucket_delete_failure_result(
                state,
                stage="list",
                message=sanitized_error_log_detail(exc),
            )

    def _emit_delete_purge_progress(
        self,
        state: _BucketDeletePurgeState,
        progress: s3_deletion.BucketContentPurgeProgress,
    ) -> None:
        stage = _normalize_progress_stage(progress.stage)
        state.progress_callback(
            BucketPurgeProgress(
                stage=stage,
                bucket_name=state.target.bucket_name,
                context_id=state.target.context_id,
                context_name=state.target.context_name,
                total_buckets=1,
                completed_buckets=0,
                listed_objects=progress.listed_objects,
                listed_versions=progress.listed_versions,
                deleted_objects=progress.deleted_objects,
                deleted_versions=progress.deleted_versions,
                total_entries_estimate=self._progress_total_entries_estimate(
                    state.total_entries_estimate,
                    listed_objects=progress.listed_objects,
                    listed_versions=progress.listed_versions,
                    deleted_objects=progress.deleted_objects,
                    deleted_versions=progress.deleted_versions,
                    total_entries_final=stage == "completed",
                ),
                total_entries_final=stage == "completed",
                failed_count=progress.failed_count,
                bucket_deleted=False,
                message=progress.message,
            )
        )

    @staticmethod
    def _apply_delete_purge_result(
        state: _BucketDeletePurgeState,
        result: s3_deletion.BucketContentPurgeResult,
    ) -> None:
        state.listed_objects = result.listed_objects
        state.listed_versions = result.listed_versions
        state.deleted_objects = result.deleted_objects
        state.deleted_versions = result.deleted_versions

    def _delete_purge_failure_result(
        self,
        state: _BucketDeletePurgeState,
        result: s3_deletion.BucketContentPurgeResult,
    ) -> BucketPurgeBucketResult:
        failures = [
            BucketPurgeFailure(
                bucket_name=state.target.bucket_name,
                stage=failure.stage,
                message=failure.message,
                key=failure.key,
                version_id=failure.version_id,
                count=failure.count,
            )
            for failure in result.failures_sample
        ]
        return self._build_bucket_delete_result(
            state,
            status="failed",
            failed_count=result.failed_count,
            bucket_deleted=False,
            failures_sample=failures,
        )

    def _emit_bucket_deletion_progress(
        self,
        state: _BucketDeletePurgeState,
        *,
        stage: BucketPurgeStage,
        completed_buckets: int,
        bucket_deleted: bool,
        message: str,
    ) -> None:
        state.progress_callback(
            BucketPurgeProgress(
                stage=stage,
                bucket_name=state.target.bucket_name,
                context_id=state.target.context_id,
                context_name=state.target.context_name,
                total_buckets=1,
                completed_buckets=completed_buckets,
                listed_objects=state.listed_objects,
                listed_versions=state.listed_versions,
                deleted_objects=state.deleted_objects,
                deleted_versions=state.deleted_versions,
                total_entries_estimate=self._progress_total_entries_estimate(
                    state.total_entries_estimate,
                    listed_objects=state.listed_objects,
                    listed_versions=state.listed_versions,
                    deleted_objects=state.deleted_objects,
                    deleted_versions=state.deleted_versions,
                    total_entries_final=True,
                ),
                total_entries_final=True,
                failed_count=0,
                bucket_deleted=bucket_deleted,
                message=message,
            )
        )

    def _delete_empty_bucket(
        self,
        client: Any,
        state: _BucketDeletePurgeState,
    ) -> BucketPurgeBucketResult | None:
        try:
            client.delete_bucket(Bucket=state.target.bucket_name)
        except ClientError as exc:
            if aws_error_code(exc, lowercase=True) == "bucketnotempty":
                return self._bucket_delete_failure_result(
                    state,
                    stage="delete_bucket",
                    message=(
                        f"Bucket '{state.target.bucket_name}' is not empty after purge. "
                        "Objects may have been added while the deletion was running."
                    ),
                )
            return self._bucket_delete_failure_result(
                state,
                stage="delete_bucket",
                message=format_s3_error(exc),
            )
        except BotoCoreError as exc:
            return self._bucket_delete_failure_result(
                state,
                stage="delete_bucket",
                message=sanitized_error_log_detail(exc),
            )
        return None

    def _bucket_delete_failure_result(
        self,
        state: _BucketDeletePurgeState,
        *,
        stage: str,
        message: str,
    ) -> BucketPurgeBucketResult:
        return self._build_bucket_delete_result(
            state,
            status="failed",
            failed_count=1,
            bucket_deleted=False,
            failures_sample=[
                BucketPurgeFailure(
                    bucket_name=state.target.bucket_name,
                    stage=stage,
                    message=message,
                    count=1,
                )
            ],
        )

    @staticmethod
    def _build_bucket_delete_result(
        state: _BucketDeletePurgeState,
        *,
        status: BucketPurgeStatus,
        failed_count: int,
        bucket_deleted: bool,
        failures_sample: list[BucketPurgeFailure],
    ) -> BucketPurgeBucketResult:
        return BucketPurgeBucketResult(
            bucket_name=state.target.bucket_name,
            context_id=state.target.context_id,
            context_name=state.target.context_name,
            status=status,
            listed_objects=state.listed_objects,
            listed_versions=state.listed_versions,
            deleted_objects=state.deleted_objects,
            deleted_versions=state.deleted_versions,
            failed_count=failed_count,
            bucket_deleted=bucket_deleted,
            duration_seconds=round(monotonic() - state.started_at, 3),
            failures_sample=failures_sample,
        )
