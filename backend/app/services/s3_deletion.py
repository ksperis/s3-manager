# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Iterable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
import logging
from typing import Any, Optional

from botocore.exceptions import BotoCoreError, ClientError
from botocore.parsers import ResponseParserError

from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code
from app.utils.s3_errors import format_s3_error

logger = logging.getLogger(__name__)


class BucketNotEmptyError(RuntimeError):
    """Raised when attempting to delete a non-empty bucket without force."""


@dataclass(frozen=True)
class BucketContentPurgeFailure:
    stage: str
    message: str
    key: str | None = None
    version_id: str | None = None
    count: int = 0


@dataclass(frozen=True)
class BucketContentPurgeProgress:
    bucket_name: str
    stage: str
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    message: str | None = None


@dataclass(frozen=True)
class BucketContentPurgeResult:
    bucket_name: str
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    missing_bucket: bool = False
    failures_sample: list[BucketContentPurgeFailure] = field(default_factory=list)


def delete_objects(client, bucket_name: str, items: Iterable[dict]) -> None:
    delete_objects_count(client, bucket_name, items)


def delete_objects_count(client, bucket_name: str, items: Iterable[dict]) -> int:
    chunk = []
    deleted = 0
    for item in items:
        chunk.append(item)
        if len(chunk) == 1000:
            deleted += _delete_objects_chunk(client, bucket_name, chunk)
            chunk = []
    if chunk:
        deleted += _delete_objects_chunk(client, bucket_name, chunk)
    return deleted


def _is_delete_objects_parse_error(exc: Exception) -> bool:
    if isinstance(exc, ResponseParserError):
        return True
    text = str(exc).strip().lower()
    return "unable to parse response" in text or "invalid xml received" in text


def _delete_object_kwargs(bucket_name: str, item: dict) -> dict[str, str]:
    kwargs = {"Bucket": bucket_name, "Key": str(item.get("Key") or "")}
    version_id = str(item.get("VersionId") or "").strip()
    if version_id:
        kwargs["VersionId"] = version_id
    return kwargs


def _delete_objects_individually(
    client,
    bucket_name: str,
    chunk: list[dict],
    *,
    after_batch_fallback: bool = False,
) -> int:
    failures: list[str] = []
    for item in chunk:
        kwargs = _delete_object_kwargs(bucket_name, item)
        key = kwargs["Key"]
        version_id = kwargs.get("VersionId")
        try:
            client.delete_object(**kwargs)
        except ClientError as exc:
            code = aws_error_code(exc, lowercase=True)
            if code in {"nosuchkey", "nosuchversion", "notfound"}:
                continue
            label = f"{key} (version {version_id})" if version_id else key
            failures.append(f"{label}: {exc}")
        except (BotoCoreError, ResponseParserError) as exc:
            label = f"{key} (version {version_id})" if version_id else key
            failures.append(f"{label}: {exc}")
    if failures:
        sample = failures[:3]
        extra = f" (+{len(failures) - 3} more)" if len(failures) > 3 else ""
        context = " after batch fallback" if after_batch_fallback else ""
        raise RuntimeError(
            f"Unable to delete {len(failures)} object(s) in bucket '{bucket_name}'{context}: "
            f"{', '.join(sample)}{extra}"
        )
    return len(chunk)


def _delete_objects_chunk(client, bucket_name: str, chunk: list[dict]) -> int:
    try:
        resp = client.delete_objects(Bucket=bucket_name, Delete={"Objects": chunk})
    except ResponseParserError as exc:
        logger.warning(
            "DeleteObjects returned invalid XML for bucket %s; retrying %s object(s) individually: %s",
            bucket_name,
            len(chunk),
            exc,
        )
        return _delete_objects_individually(client, bucket_name, chunk, after_batch_fallback=True)
    except (ClientError, BotoCoreError) as exc:
        if _is_delete_objects_parse_error(exc):
            logger.warning(
                "DeleteObjects returned an unparseable response for bucket %s; retrying %s object(s) individually: %s",
                bucket_name,
                len(chunk),
                exc,
            )
            return _delete_objects_individually(client, bucket_name, chunk, after_batch_fallback=True)
        raise
    errors = resp.get("Errors", []) if isinstance(resp, dict) else []
    if errors:
        sample = []
        for err in errors[:3]:
            key = err.get("Key", "unknown")
            version_id = err.get("VersionId")
            code = err.get("Code", "Error")
            message = err.get("Message", "")
            suffix = f" ({message})" if message else ""
            if version_id:
                sample.append(f"{code} for {key} (version {version_id}){suffix}")
            else:
                sample.append(f"{code} for {key}{suffix}")
        extra = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
        raise RuntimeError(
            f"Unable to delete {len(errors)} object(s) in bucket '{bucket_name}': {', '.join(sample)}{extra}"
        )
    return len(chunk)


def _bucket_missing_error(exc: Exception) -> bool:
    return aws_error_code(exc, lowercase=True) in {"nosuchbucket", "notfound"}


def _version_listing_absent_error(exc: Exception) -> bool:
    return aws_error_code(exc, lowercase=True) in {"nosuchbucket", "nosuchversion", "notfound"}


_DeleteBatchResult = tuple[str, int, list[dict] | None, Exception | None]
_PendingDeletes = set[Future[_DeleteBatchResult]]


class _BucketContentPurger:
    _FAILURE_SAMPLE_LIMIT = 500

    def __init__(
        self,
        client: Any,
        bucket_name: str,
        *,
        parallelism: int,
        include_versions: bool,
        individual_deletes: bool,
        progress_callback: Callable[[BucketContentPurgeProgress], None] | None,
        cancel_check: Callable[[], None] | None,
        tolerate_missing_bucket: bool,
    ) -> None:
        self.client = client
        self.bucket_name = bucket_name
        self.worker_count = max(1, min(int(parallelism or 10), 64))
        self.include_versions = include_versions
        self.individual_deletes = individual_deletes
        self.progress_callback = progress_callback
        self.cancel_check = cancel_check
        self.tolerate_missing_bucket = tolerate_missing_bucket
        self.listed_objects = 0
        self.listed_versions = 0
        self.deleted_objects = 0
        self.deleted_versions = 0
        self.failed_count = 0
        self.failures: list[BucketContentPurgeFailure] = []

    def run(self) -> BucketContentPurgeResult:
        self._emit("list", f"Listing objects in {self.bucket_name}...")
        with ThreadPoolExecutor(
            max_workers=self.worker_count,
            thread_name_prefix="bucket-purge-delete",
        ) as executor:
            pending: _PendingDeletes = set()
            pending, missing_bucket = self._queue_current_objects(executor, pending)
            if missing_bucket:
                return BucketContentPurgeResult(bucket_name=self.bucket_name, missing_bucket=True)
            self._drain_all(pending)

            if self.include_versions:
                self._emit("versions", f"Listing object versions in {self.bucket_name}...")
                pending = self._queue_object_versions(executor, set())
                self._drain_all(pending)

        self._emit("completed", f"Purged {self.bucket_name}.")
        return self._result()

    def _check_cancel(self) -> None:
        if self.cancel_check:
            self.cancel_check()

    def _emit(self, stage: str, message: str | None = None) -> None:
        if not self.progress_callback:
            return
        self.progress_callback(
            BucketContentPurgeProgress(
                bucket_name=self.bucket_name,
                stage=stage,
                listed_objects=self.listed_objects,
                listed_versions=self.listed_versions,
                deleted_objects=self.deleted_objects,
                deleted_versions=self.deleted_versions,
                failed_count=self.failed_count,
                message=message,
            )
        )

    def _result(self) -> BucketContentPurgeResult:
        return BucketContentPurgeResult(
            bucket_name=self.bucket_name,
            listed_objects=self.listed_objects,
            listed_versions=self.listed_versions,
            deleted_objects=self.deleted_objects,
            deleted_versions=self.deleted_versions,
            failed_count=self.failed_count,
            failures_sample=self.failures,
        )

    def _add_failure(self, stage: str, exc: Exception, items: list[dict] | None) -> None:
        self.failed_count += len(items or []) or 1
        if len(self.failures) >= self._FAILURE_SAMPLE_LIMIT:
            return
        first = (items or [{}])[0]
        self.failures.append(
            BucketContentPurgeFailure(
                stage=stage,
                message=format_s3_error(exc),
                key=str(first.get("Key") or "") or None,
                version_id=str(first.get("VersionId") or "") or None,
                count=len(items or []),
            )
        )

    def _delete_batch(self, stage: str, items: list[dict]) -> _DeleteBatchResult:
        self._check_cancel()
        try:
            if self.individual_deletes:
                deleted = _delete_objects_individually(self.client, self.bucket_name, items)
            else:
                deleted = delete_objects_count(self.client, self.bucket_name, items)
            return stage, deleted, None, None
        except Exception as exc:  # noqa: BLE001
            return stage, 0, items, exc

    def _drain(self, pending: _PendingDeletes, *, wait_all: bool = False) -> _PendingDeletes:
        if not pending:
            return pending
        done, remaining = wait(
            pending,
            timeout=1.0 if wait_all else None,
            return_when=FIRST_COMPLETED,
        )
        for future in done:
            stage, deleted, items, exc = future.result()
            if stage == "versions":
                self.deleted_versions += deleted
            else:
                self.deleted_objects += deleted
            if exc is not None:
                self._add_failure(stage, exc, items)
        self._emit("delete")
        return remaining

    def _drain_all(self, pending: _PendingDeletes) -> None:
        while pending:
            self._check_cancel()
            pending = self._drain(pending, wait_all=True)

    def _submit_batch(
        self,
        executor: ThreadPoolExecutor,
        pending: _PendingDeletes,
        stage: str,
        items: list[dict],
    ) -> _PendingDeletes:
        pending.add(executor.submit(self._delete_batch, stage, items))
        while len(pending) >= self.worker_count * 2:
            self._check_cancel()
            pending = self._drain(pending)
        return pending

    def _submit_items(
        self,
        executor: ThreadPoolExecutor,
        pending: _PendingDeletes,
        stage: str,
        items: list[dict],
    ) -> _PendingDeletes:
        chunk_size = 1 if self.individual_deletes else 1000
        for start in range(0, len(items), chunk_size):
            pending = self._submit_batch(executor, pending, stage, items[start : start + chunk_size])
        return pending

    def _queue_current_objects(
        self,
        executor: ThreadPoolExecutor,
        pending: _PendingDeletes,
    ) -> tuple[_PendingDeletes, bool]:
        continuation_token = None
        while True:
            self._check_cancel()
            list_kwargs = {"Bucket": self.bucket_name, "MaxKeys": 1000}
            if continuation_token:
                list_kwargs["ContinuationToken"] = continuation_token
            try:
                page = self.client.list_objects_v2(**list_kwargs)
            except ClientError as exc:
                if self.tolerate_missing_bucket and _bucket_missing_error(exc):
                    return pending, True
                raise
            objects = [{"Key": item["Key"]} for item in page.get("Contents", []) or [] if item.get("Key")]
            if objects:
                self.listed_objects += len(objects)
                pending = self._submit_items(executor, pending, "objects", objects)
            continuation_token = page.get("NextContinuationToken")
            self._emit("list")
            if not continuation_token:
                return pending, False

    def _queue_object_versions(
        self,
        executor: ThreadPoolExecutor,
        pending: _PendingDeletes,
    ) -> _PendingDeletes:
        key_marker = None
        version_marker = None
        while True:
            self._check_cancel()
            list_kwargs = {"Bucket": self.bucket_name}
            if key_marker:
                list_kwargs["KeyMarker"] = key_marker
            if version_marker:
                list_kwargs["VersionIdMarker"] = version_marker
            try:
                page = self.client.list_object_versions(**list_kwargs)
            except ClientError as exc:
                if _version_listing_absent_error(exc):
                    return pending
                raise
            items = self._version_items(page)
            if items:
                self.listed_versions += len(items)
                pending = self._submit_items(executor, pending, "versions", items)
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            self._emit("versions")
            if not key_marker and not version_marker:
                return pending

    @staticmethod
    def _version_items(page: dict) -> list[dict]:
        items: list[dict] = []
        for collection in (page.get("Versions", []) or [], page.get("DeleteMarkers", []) or []):
            for entry in collection:
                key = entry.get("Key")
                version_id = entry.get("VersionId")
                if key and version_id:
                    items.append({"Key": key, "VersionId": version_id})
        return items


def purge_bucket_contents(
    client: Any,
    bucket_name: str,
    *,
    parallelism: int = 10,
    include_versions: bool = True,
    individual_deletes: bool = False,
    progress_callback: Callable[[BucketContentPurgeProgress], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    tolerate_missing_bucket: bool = False,
) -> BucketContentPurgeResult:
    return _BucketContentPurger(
        client,
        bucket_name,
        parallelism=parallelism,
        include_versions=include_versions,
        individual_deletes=individual_deletes,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
        tolerate_missing_bucket=tolerate_missing_bucket,
    ).run()


def delete_bucket(
    bucket_name: str,
    force: bool = False,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to inspect bucket '{bucket_name}': {exc}") from exc

    has_objects = (resp.get("KeyCount") or 0) > 0 or bool(resp.get("Contents"))
    if has_objects and not force:
        raise BucketNotEmptyError(
            f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
        )

    if force:
        try:
            purge_result = purge_bucket_contents(client, bucket_name, parallelism=10, include_versions=True)
            if purge_result.failed_count > 0:
                sample_failures = purge_result.failures_sample[:3]
                sample = ", ".join(failure.message for failure in sample_failures)
                extra = (
                    f" (+{purge_result.failed_count - len(sample_failures)} more)"
                    if purge_result.failed_count > len(sample_failures)
                    else ""
                )
                raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {sample}{extra}")
        except ClientError as exc:
            error_code = aws_error_code(exc, lowercase=True)
            if error_code not in {"nosuchbucket", "nosuchversion"}:
                raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {exc}") from exc

    try:
        client.delete_bucket(Bucket=bucket_name)
    except ClientError as exc:
        error_code = aws_error_code(exc, lowercase=True)
        if error_code == "bucketnotempty":
            raise BucketNotEmptyError(
                f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
            ) from exc
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket %s (force=%s)", bucket_name, force)
