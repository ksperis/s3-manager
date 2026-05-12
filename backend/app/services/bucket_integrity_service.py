# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import S3Account
from app.models.bucket_integrity import (
    BucketIntegrityBucketResult,
    BucketIntegrityCheckProgress,
    BucketIntegrityCheckResult,
    BucketIntegrityFailure,
)
from app.services import s3_client
from app.utils.s3_endpoint import resolve_s3_client_options


ProgressCallback = Callable[[BucketIntegrityCheckProgress], None]
CancelCheck = Callable[[], None]

_READ_CHUNK_SIZE = 8 * 1024 * 1024
_FAILURE_SAMPLE_LIMIT = 100
_PROGRESS_EVERY_CHECKED = 25
_PROGRESS_MIN_INTERVAL_SECONDS = 0.5


class BucketIntegrityCheckCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketIntegrityResolvedTarget:
    account: S3Account
    bucket_name: str
    context_id: str | None = None
    context_name: str | None = None


@dataclass(frozen=True)
class BucketIntegrityOptions:
    parallelism: int = 10
    all_versions: bool = False
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
    success: bool
    bytes_read: int = 0
    message: str | None = None


def _format_storage_error(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
        code = str(error.get("Code") or "").strip()
        message = str(error.get("Message") or "").strip()
        operation = str(getattr(exc, "operation_name", "") or "").strip()
        parts = [part for part in (code, message) if part and part.lower() != "none"]
        detail = ": ".join(parts) if parts else str(exc)
        return f"{operation} failed with {detail}" if operation else detail
    return str(exc)


def _normalize_since(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class BucketIntegrityCheckService:
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
            "user_agent_extra": "s3-manager-bucket-integrity",
        }

    def _build_client(self, account: S3Account):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def _iter_objects(
        self,
        client: Any,
        bucket_name: str,
        *,
        all_versions: bool,
        since: datetime | None,
        cancel_check: CancelCheck | None,
    ):
        since_utc = _normalize_since(since)
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
                        entry_time = _normalize_since(last_modified)
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
                    entry_time = _normalize_since(last_modified)
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
    ) -> _ObjectCheckResult:
        body = None
        total_read = 0
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": obj.key}
        if obj.version_id:
            kwargs["VersionId"] = obj.version_id
        try:
            response = client.get_object(**kwargs)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("response body is empty")
            while True:
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
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            return _ObjectCheckResult(
                key=obj.key,
                version_id=obj.version_id,
                success=False,
                bytes_read=total_read,
                message=_format_storage_error(exc),
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
            success=True,
            bytes_read=total_read,
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
        listed_count = 0
        checked_count = 0
        failed_count = 0
        bytes_read = 0
        failures: list[BucketIntegrityFailure] = []
        last_progress_at = 0.0

        def add_failure(failure: BucketIntegrityFailure) -> None:
            nonlocal failed_count
            failed_count += 1
            if len(failures) < _FAILURE_SAMPLE_LIMIT:
                failures.append(failure)

        def emit(stage: str, *, force: bool = False, message: str | None = None) -> None:
            nonlocal last_progress_at
            now = monotonic()
            if not force and checked_count % _PROGRESS_EVERY_CHECKED != 0 and (now - last_progress_at) < _PROGRESS_MIN_INTERVAL_SECONDS:
                return
            last_progress_at = now
            progress_callback(
                BucketIntegrityCheckProgress(
                    stage=stage,  # type: ignore[arg-type]
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    total_buckets=total_buckets,
                    completed_buckets=completed_buckets,
                    listed_count=listed_count,
                    checked_count=checked_count,
                    failed_count=failed_count,
                    bytes_read=bytes_read,
                    message=message,
                )
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
                    listed_count += 1
                    pending.add(executor.submit(self._read_object, client, target.bucket_name, obj, max_bytes=max_bytes))
                    if len(pending) >= worker_count * 2:
                        done, pending = wait(pending, return_when=FIRST_COMPLETED)
                        for future in done:
                            result = future.result()
                            checked_count += 1
                            bytes_read += result.bytes_read
                            if not result.success:
                                add_failure(
                                    BucketIntegrityFailure(
                                        bucket_name=target.bucket_name,
                                        stage="get",
                                        key=result.key,
                                        version_id=result.version_id,
                                        message=result.message or "Object read failed",
                                    )
                                )
                        emit("verify")
                emit("verify", force=True, message=f"Verifying {target.bucket_name}...")
                while pending:
                    if cancel_check:
                        cancel_check()
                    done, pending = wait(pending, timeout=1.0)
                    for future in done:
                        result = future.result()
                        checked_count += 1
                        bytes_read += result.bytes_read
                        if not result.success:
                            add_failure(
                                BucketIntegrityFailure(
                                    bucket_name=target.bucket_name,
                                    stage="get",
                                    key=result.key,
                                    version_id=result.version_id,
                                    message=result.message or "Object read failed",
                                )
                            )
                    emit("verify")
        except BucketIntegrityCheckCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            add_failure(
                BucketIntegrityFailure(
                    bucket_name=target.bucket_name,
                    stage="list",
                    message=_format_storage_error(exc),
                )
            )
            status = "failed"
        else:
            status = "passed" if failed_count == 0 else "completed_with_errors"

        return BucketIntegrityBucketResult(
            bucket_name=target.bucket_name,
            context_id=target.context_id,
            context_name=target.context_name,
            status=status,  # type: ignore[arg-type]
            listed_count=listed_count,
            checked_count=checked_count,
            failed_count=failed_count,
            bytes_read=bytes_read,
            duration_seconds=round(monotonic() - started, 3),
            failures_sample=failures,
        )
