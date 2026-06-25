# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Callable

from botocore.exceptions import BotoCoreError, ClientError

from app.db import S3Account
from app.models.bucket_purge import (
    BucketPurgeBucketResult,
    BucketPurgeFailure,
    BucketPurgeProgress,
    BucketPurgeResult,
)
from app.services import s3_client
from app.utils.s3_endpoint import resolve_s3_client_options


ProgressCallback = Callable[[BucketPurgeProgress], None]
CancelCheck = Callable[[], None]
BUCKET_DELETE_WITH_PURGE_ENTRY_LIMIT = 10000


class BucketPurgeCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketPurgeResolvedTarget:
    account: S3Account
    bucket_name: str
    context_id: str | None = None
    context_name: str | None = None


@dataclass(frozen=True)
class BucketPurgeOptions:
    parallelism: int = 10
    include_versions: bool = True


class BucketPurgeService:
    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 account is missing credentials")
        return access_key, secret_key

    def _client_kwargs(self, account: S3Account) -> dict[str, Any]:
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        return {
            "endpoint": endpoint,
            "region": region,
            "force_path_style": force_path_style,
            "verify_tls": verify_tls,
            "session_token": session_token,
            "user_agent_extra": "s3-manager-bucket-purge",
        }

    def _build_client(self, account: S3Account):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

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

        def emit(progress: BucketPurgeProgress) -> None:
            if progress_callback:
                progress_callback(progress)

        emit(
            BucketPurgeProgress(
                stage="prepare",
                total_buckets=len(targets),
                completed_buckets=0,
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
                progress_callback=emit,
                cancel_check=cancel_check,
            )
            bucket_results.append(bucket_result)
            total_listed_objects += bucket_result.listed_objects
            total_listed_versions += bucket_result.listed_versions
            total_deleted_objects += bucket_result.deleted_objects
            total_deleted_versions += bucket_result.deleted_versions
            total_failed += bucket_result.failed_count
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
                    failed_count=total_failed,
                    message=f"Completed purge for {target.bucket_name}.",
                )
            )

        status = "completed"
        if bucket_results and all(item.status == "failed" for item in bucket_results):
            status = "failed"
        elif total_failed > 0 or any(item.status != "completed" for item in bucket_results):
            status = "completed_with_errors"

        finished_at = datetime.now(timezone.utc)
        return BucketPurgeResult(
            status=status,  # type: ignore[arg-type]
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
        entry_limit: int = BUCKET_DELETE_WITH_PURGE_ENTRY_LIMIT,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketPurgeResult:
        started_at = datetime.now(timezone.utc)

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
                message="Preparing bucket deletion...",
            )
        )
        bucket_result = self._run_bucket_delete_with_purge(
            target,
            options,
            entry_limit=entry_limit,
            progress_callback=emit,
            cancel_check=cancel_check,
        )
        status = "completed" if bucket_result.bucket_deleted and bucket_result.failed_count == 0 else "failed"
        finished_at = datetime.now(timezone.utc)
        return BucketPurgeResult(
            status=status,  # type: ignore[arg-type]
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
        progress_callback: ProgressCallback,
        cancel_check: CancelCheck | None,
    ) -> BucketPurgeBucketResult:
        started = monotonic()

        def low_progress(progress: s3_client.BucketContentPurgeProgress) -> None:
            stage = (
                progress.stage
                if progress.stage in {"list", "delete", "versions", "delete_bucket", "completed"}
                else "delete"
            )
            progress_callback(
                BucketPurgeProgress(
                    stage=stage,  # type: ignore[arg-type]
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=total_buckets,
                    completed_buckets=completed_buckets,
                    listed_objects=base_listed_objects + progress.listed_objects,
                    listed_versions=base_listed_versions + progress.listed_versions,
                    deleted_objects=base_deleted_objects + progress.deleted_objects,
                    deleted_versions=base_deleted_versions + progress.deleted_versions,
                    failed_count=base_failed_count + progress.failed_count,
                    bucket_deleted=False,
                    message=progress.message,
                )
            )

        try:
            client = self._build_client(target.account)
            result = s3_client.purge_bucket_contents(
                client,
                target.bucket_name,
                parallelism=options.parallelism,
                include_versions=options.include_versions,
                progress_callback=low_progress,
                cancel_check=cancel_check,
            )
            status = "completed" if result.failed_count == 0 else "completed_with_errors"
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
                status=status,  # type: ignore[arg-type]
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
                        message=str(exc),
                    )
                ],
            )

    def _run_bucket_delete_with_purge(
        self,
        target: BucketPurgeResolvedTarget,
        options: BucketPurgeOptions,
        *,
        entry_limit: int,
        progress_callback: ProgressCallback,
        cancel_check: CancelCheck | None,
    ) -> BucketPurgeBucketResult:
        started = monotonic()
        listed_objects = 0
        listed_versions = 0
        deleted_objects = 0
        deleted_versions = 0

        def low_progress(progress: s3_client.BucketContentPurgeProgress) -> None:
            stage = (
                progress.stage
                if progress.stage in {"list", "delete", "versions", "delete_bucket", "completed"}
                else "delete"
            )
            progress_callback(
                BucketPurgeProgress(
                    stage=stage,  # type: ignore[arg-type]
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=1,
                    completed_buckets=0,
                    listed_objects=progress.listed_objects,
                    listed_versions=progress.listed_versions,
                    deleted_objects=progress.deleted_objects,
                    deleted_versions=progress.deleted_versions,
                    failed_count=progress.failed_count,
                    bucket_deleted=False,
                    message=progress.message,
                )
            )

        def failure_result(
            *,
            stage: str,
            message: str,
            failed_count: int = 1,
            key: str | None = None,
            version_id: str | None = None,
        ) -> BucketPurgeBucketResult:
            return BucketPurgeBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status="failed",
                listed_objects=listed_objects,
                listed_versions=listed_versions,
                deleted_objects=deleted_objects,
                deleted_versions=deleted_versions,
                failed_count=failed_count,
                bucket_deleted=False,
                duration_seconds=round(monotonic() - started, 3),
                failures_sample=[
                    BucketPurgeFailure(
                        bucket_name=target.bucket_name,
                        stage=stage,
                        message=message,
                        key=key,
                        version_id=version_id,
                        count=failed_count,
                    )
                ],
            )

        try:
            client = self._build_client(target.account)
            count_result = s3_client.count_bucket_purge_entries(
                client,
                target.bucket_name,
                include_versions=options.include_versions,
                limit=entry_limit,
                progress_callback=low_progress,
                cancel_check=cancel_check,
            )
            listed_objects = count_result.listed_objects
            listed_versions = count_result.listed_versions
            if count_result.exceeded_limit:
                message = (
                    f"Bucket '{target.bucket_name}' has more than {entry_limit:,} deletable entries. "
                    "Use Manager > Tools > Purge or an external S3 tool before deleting the bucket."
                )
                return failure_result(stage="list", message=message, failed_count=1)

            if listed_objects + listed_versions > 0:
                purge_result = s3_client.purge_bucket_contents(
                    client,
                    target.bucket_name,
                    parallelism=options.parallelism,
                    include_versions=options.include_versions,
                    progress_callback=low_progress,
                    cancel_check=cancel_check,
                )
                listed_objects = purge_result.listed_objects
                listed_versions = purge_result.listed_versions
                deleted_objects = purge_result.deleted_objects
                deleted_versions = purge_result.deleted_versions
                if purge_result.failed_count > 0:
                    failures = [
                        BucketPurgeFailure(
                            bucket_name=target.bucket_name,
                            stage=failure.stage,
                            message=failure.message,
                            key=failure.key,
                            version_id=failure.version_id,
                            count=failure.count,
                        )
                        for failure in purge_result.failures_sample
                    ]
                    return BucketPurgeBucketResult(
                        bucket_name=target.bucket_name,
                        context_id=target.context_id,
                        context_name=target.context_name,
                        status="failed",
                        listed_objects=listed_objects,
                        listed_versions=listed_versions,
                        deleted_objects=deleted_objects,
                        deleted_versions=deleted_versions,
                        failed_count=purge_result.failed_count,
                        bucket_deleted=False,
                        duration_seconds=round(monotonic() - started, 3),
                        failures_sample=failures,
                    )

            progress_callback(
                BucketPurgeProgress(
                    stage="delete_bucket",
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=1,
                    completed_buckets=0,
                    listed_objects=listed_objects,
                    listed_versions=listed_versions,
                    deleted_objects=deleted_objects,
                    deleted_versions=deleted_versions,
                    failed_count=0,
                    bucket_deleted=False,
                    message=f"Deleting bucket {target.bucket_name}...",
                )
            )
            try:
                client.delete_bucket(Bucket=target.bucket_name)
            except ClientError as exc:
                error_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
                if error_code.lower() == "bucketnotempty":
                    return failure_result(
                        stage="delete_bucket",
                        message=(
                            f"Bucket '{target.bucket_name}' is not empty after purge. "
                            "Objects may have been added while the deletion was running."
                        ),
                    )
                return failure_result(stage="delete_bucket", message=s3_client._format_delete_failure(exc))
            except BotoCoreError as exc:
                return failure_result(stage="delete_bucket", message=str(exc))

            progress_callback(
                BucketPurgeProgress(
                    stage="completed",
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=1,
                    completed_buckets=1,
                    listed_objects=listed_objects,
                    listed_versions=listed_versions,
                    deleted_objects=deleted_objects,
                    deleted_versions=deleted_versions,
                    failed_count=0,
                    bucket_deleted=True,
                    message=f"Deleted bucket {target.bucket_name}.",
                )
            )
            return BucketPurgeBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status="completed",
                listed_objects=listed_objects,
                listed_versions=listed_versions,
                deleted_objects=deleted_objects,
                deleted_versions=deleted_versions,
                failed_count=0,
                bucket_deleted=True,
                duration_seconds=round(monotonic() - started, 3),
                failures_sample=[],
            )
        except BucketPurgeCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            return failure_result(stage="list", message=str(exc))
