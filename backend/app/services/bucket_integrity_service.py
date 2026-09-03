# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_execution_context import S3ExecutionTarget
from app.models.bucket_integrity import (
    BucketIntegrityBucketResult,
    BucketIntegrityCheckMode,
    BucketIntegrityCheckProgress,
    BucketIntegrityCheckResult,
    BucketIntegrityFailure,
    BucketIntegrityFailureStage,
    BucketIntegrityProgressStage,
    BucketIntegrityStatus,
)
from app.services.long_running_s3_client import LongRunningS3ClientMixin
from app.utils.s3_errors import format_s3_error
from app.utils.time import assume_utc


ProgressCallback = Callable[[BucketIntegrityCheckProgress], None]
CancelCheck = Callable[[], None]

_READ_CHUNK_SIZE = 8 * 1024 * 1024
_FAILURE_SAMPLE_LIMIT = 500
_PROGRESS_EVERY_CHECKED = 25
_PROGRESS_MIN_INTERVAL_SECONDS = 0.5


class BucketIntegrityCheckCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketIntegrityResolvedTarget:
    account: S3ExecutionTarget
    bucket_name: str
    context_id: str | None = None
    context_name: str | None = None


@dataclass(frozen=True)
class BucketIntegrityOptions:
    parallelism: int = 10
    all_versions: bool = False
    check_mode: BucketIntegrityCheckMode = "head"
    since: datetime | None = None
    max_mb_per_object: float | None = None

    @property
    def max_bytes_per_object(self) -> int | None:
        if self.max_mb_per_object is None:
            return None
        return max(1, int(float(self.max_mb_per_object) * 1024 * 1024))


@dataclass(frozen=True)
class _ObjectRef:
    key: str
    version_id: str | None = None
    last_modified: datetime | None = None


@dataclass(frozen=True)
class _ObjectCheckResult:
    key: str
    version_id: str | None
    stage: BucketIntegrityFailureStage
    success: bool
    bytes_read: int = 0
    message: str | None = None


@dataclass
class _BucketCheckState:
    listed_count: int = 0
    checked_count: int = 0
    failed_count: int = 0
    bytes_read: int = 0
    failures: list[BucketIntegrityFailure] = field(default_factory=list)
    last_progress_at: float = 0.0

    def add_failure(self, failure: BucketIntegrityFailure) -> None:
        self.failed_count += 1
        if len(self.failures) < _FAILURE_SAMPLE_LIMIT:
            self.failures.append(failure)

    def record_result(self, bucket_name: str, result: _ObjectCheckResult) -> None:
        self.checked_count += 1
        self.bytes_read += result.bytes_read
        if not result.success:
            self.add_failure(
                BucketIntegrityFailure(
                    bucket_name=bucket_name,
                    stage=result.stage,
                    key=result.key,
                    version_id=result.version_id,
                    message=result.message or "Object check failed",
                )
            )


def _object_request_kwargs(bucket_name: str, obj: _ObjectRef) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": obj.key}
    if obj.version_id:
        kwargs["VersionId"] = obj.version_id
    return kwargs


class BucketIntegrityCheckService(LongRunningS3ClientMixin):
    s3_user_agent_extra = "bucketreef-bucket-integrity"

    def _iter_objects(
        self,
        client: Any,
        bucket_name: str,
        *,
        all_versions: bool,
        since: datetime | None,
        cancel_check: CancelCheck | None,
    ):
        since_utc = assume_utc(since)
        if all_versions:
            paginator = client.get_paginator("list_object_versions")
            for page in paginator.paginate(Bucket=bucket_name):
                if cancel_check:
                    cancel_check()
                for entry in page.get("Versions", []) or []:
                    key = entry.get("Key")
                    if not isinstance(key, str) or not key:
                        continue
                    last_modified = entry.get("LastModified")
                    if since_utc and isinstance(last_modified, datetime):
                        entry_time = assume_utc(last_modified)
                        if entry_time and entry_time < since_utc:
                            continue
                    version_id = entry.get("VersionId")
                    yield _ObjectRef(
                        key=key,
                        version_id=version_id if isinstance(version_id, str) and version_id else None,
                        last_modified=last_modified if isinstance(last_modified, datetime) else None,
                    )
            return

        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name):
            if cancel_check:
                cancel_check()
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                last_modified = entry.get("LastModified")
                if since_utc and isinstance(last_modified, datetime):
                    entry_time = assume_utc(last_modified)
                    if entry_time and entry_time < since_utc:
                        continue
                yield _ObjectRef(
                    key=key,
                    last_modified=last_modified if isinstance(last_modified, datetime) else None,
                )

    def _read_object(
        self,
        client: Any,
        bucket_name: str,
        obj: _ObjectRef,
        *,
        max_bytes: int | None,
        cancel_check: CancelCheck | None = None,
    ) -> _ObjectCheckResult:
        body = None
        total_read = 0
        kwargs = _object_request_kwargs(bucket_name, obj)
        try:
            if cancel_check:
                cancel_check()
            response = client.get_object(**kwargs)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("response body is empty")
            while True:
                if cancel_check:
                    cancel_check()
                to_read = _READ_CHUNK_SIZE
                if max_bytes is not None:
                    remaining = max_bytes - total_read
                    if remaining <= 0:
                        break
                    to_read = min(to_read, remaining)
                chunk = body.read(to_read)
                if not chunk:
                    break
                total_read += len(chunk)
        except BucketIntegrityCheckCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            return _ObjectCheckResult(
                key=obj.key,
                version_id=obj.version_id,
                stage="get",
                success=False,
                bytes_read=total_read,
                message=format_s3_error(exc, include_operation=True),
            )
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass
        return _ObjectCheckResult(
            key=obj.key,
            version_id=obj.version_id,
            stage="get",
            success=True,
            bytes_read=total_read,
        )

    def _head_object(
        self,
        client: Any,
        bucket_name: str,
        obj: _ObjectRef,
        *,
        cancel_check: CancelCheck | None = None,
    ) -> _ObjectCheckResult:
        try:
            if cancel_check:
                cancel_check()
            client.head_object(**_object_request_kwargs(bucket_name, obj))
        except BucketIntegrityCheckCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            return _ObjectCheckResult(
                key=obj.key,
                version_id=obj.version_id,
                stage="head",
                success=False,
                message=format_s3_error(exc, include_operation=True),
            )
        return _ObjectCheckResult(
            key=obj.key,
            version_id=obj.version_id,
            stage="head",
            success=True,
        )

    def _check_object(
        self,
        client: Any,
        bucket_name: str,
        obj: _ObjectRef,
        *,
        check_mode: BucketIntegrityCheckMode,
        max_bytes: int | None,
        cancel_check: CancelCheck | None = None,
    ) -> _ObjectCheckResult:
        if cancel_check:
            cancel_check()
        if check_mode == "head":
            return self._head_object(client, bucket_name, obj, cancel_check=cancel_check)
        return self._read_object(client, bucket_name, obj, max_bytes=max_bytes, cancel_check=cancel_check)

    @staticmethod
    def _record_completed_checks(
        completed: set[Future[_ObjectCheckResult]],
        state: _BucketCheckState,
        bucket_name: str,
    ) -> None:
        for future in completed:
            state.record_result(bucket_name, future.result())

    @staticmethod
    def _emit_bucket_progress(
        state: _BucketCheckState,
        target: BucketIntegrityResolvedTarget,
        *,
        stage: BucketIntegrityProgressStage,
        total_buckets: int,
        completed_buckets: int,
        progress_callback: ProgressCallback,
        force: bool = False,
        message: str | None = None,
    ) -> None:
        now = monotonic()
        if (
            not force
            and state.checked_count % _PROGRESS_EVERY_CHECKED != 0
            and (now - state.last_progress_at) < _PROGRESS_MIN_INTERVAL_SECONDS
        ):
            return
        state.last_progress_at = now
        progress_callback(
            BucketIntegrityCheckProgress(
                stage=stage,
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                total_buckets=total_buckets,
                completed_buckets=completed_buckets,
                listed_count=state.listed_count,
                checked_count=state.checked_count,
                failed_count=state.failed_count,
                bytes_read=state.bytes_read,
                message=message,
            )
        )

    def run(
        self,
        targets: list[BucketIntegrityResolvedTarget],
        options: BucketIntegrityOptions,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketIntegrityCheckResult:
        started_at = datetime.now(timezone.utc)
        bucket_results: list[BucketIntegrityBucketResult] = []
        total_listed = 0
        total_checked = 0
        total_failed = 0
        total_bytes = 0
        max_bytes = options.max_bytes_per_object

        def emit(progress: BucketIntegrityCheckProgress) -> None:
            if progress_callback:
                progress_callback(progress)

        emit(
            BucketIntegrityCheckProgress(
                stage="prepare",
                total_buckets=len(targets),
                completed_buckets=0,
                message="Preparing bucket integrity check...",
            )
        )

        for index, target in enumerate(targets):
            if cancel_check:
                cancel_check()
            bucket_result = self._run_bucket(
                target,
                options,
                max_bytes=max_bytes,
                total_buckets=len(targets),
                completed_buckets=index,
                progress_callback=emit,
                cancel_check=cancel_check,
            )
            bucket_results.append(bucket_result)
            total_listed += bucket_result.listed_count
            total_checked += bucket_result.checked_count
            total_failed += bucket_result.failed_count
            total_bytes += bucket_result.bytes_read
            emit(
                BucketIntegrityCheckProgress(
                    stage="completed",
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=len(targets),
                    completed_buckets=index + 1,
                    listed_count=total_listed,
                    checked_count=total_checked,
                    failed_count=total_failed,
                    bytes_read=total_bytes,
                    message=f"Completed {target.bucket_name}.",
                )
            )

        status = "passed"
        if bucket_results and all(item.status == "failed" for item in bucket_results):
            status = "failed"
        elif total_failed > 0 or any(item.status != "passed" for item in bucket_results):
            status = "completed_with_errors"

        finished_at = datetime.now(timezone.utc)
        return BucketIntegrityCheckResult(
            status=status,
            total_buckets=len(targets),
            completed_buckets=len(bucket_results),
            listed_count=total_listed,
            checked_count=total_checked,
            failed_count=total_failed,
            bytes_read=total_bytes,
            started_at=started_at,
            finished_at=finished_at,
            buckets=bucket_results,
        )

    def _run_bucket(
        self,
        target: BucketIntegrityResolvedTarget,
        options: BucketIntegrityOptions,
        *,
        max_bytes: int | None,
        total_buckets: int,
        completed_buckets: int,
        progress_callback: ProgressCallback,
        cancel_check: CancelCheck | None,
    ) -> BucketIntegrityBucketResult:
        started = monotonic()
        state = _BucketCheckState()

        def emit(
            stage: BucketIntegrityProgressStage,
            *,
            force: bool = False,
            message: str | None = None,
        ) -> None:
            self._emit_bucket_progress(
                state,
                target,
                stage=stage,
                total_buckets=total_buckets,
                completed_buckets=completed_buckets,
                progress_callback=progress_callback,
                force=force,
                message=message,
            )

        emit("list", force=True, message=f"Listing {target.bucket_name}...")
        try:
            client = self._build_client(target.account)
            worker_count = max(1, min(int(options.parallelism), 64))
            pending = set()
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-integrity") as executor:
                for obj in self._iter_objects(
                    client,
                    target.bucket_name,
                    all_versions=options.all_versions,
                    since=options.since,
                    cancel_check=cancel_check,
                ):
                    if cancel_check:
                        cancel_check()
                    state.listed_count += 1
                    pending.add(
                        executor.submit(
                            self._check_object,
                            client,
                            target.bucket_name,
                            obj,
                            check_mode=options.check_mode,
                            max_bytes=max_bytes,
                            cancel_check=cancel_check,
                        )
                    )
                    if len(pending) >= worker_count * 2:
                        done, pending = wait(pending, return_when=FIRST_COMPLETED)
                        self._record_completed_checks(done, state, target.bucket_name)
                        emit("verify")
                emit("verify", force=True, message=f"Verifying {target.bucket_name}...")
                while pending:
                    if cancel_check:
                        cancel_check()
                    done, pending = wait(pending, timeout=1.0)
                    self._record_completed_checks(done, state, target.bucket_name)
                    emit("verify")
        except BucketIntegrityCheckCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            state.add_failure(
                BucketIntegrityFailure(
                    bucket_name=target.bucket_name,
                    stage="list",
                    message=format_s3_error(exc, include_operation=True),
                )
            )
            status: BucketIntegrityStatus = "failed"
        else:
            status = "passed" if state.failed_count == 0 else "completed_with_errors"

        return BucketIntegrityBucketResult(
            bucket_name=target.bucket_name,
            context_id=target.context_id,
            context_name=target.context_name,
            status=status,
            listed_count=state.listed_count,
            checked_count=state.checked_count,
            failed_count=state.failed_count,
            bytes_read=state.bytes_read,
            duration_seconds=round(monotonic() - started, 3),
            failures_sample=state.failures,
        )
