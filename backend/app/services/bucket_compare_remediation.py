# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import logging
from typing import Any, Literal

from botocore.exceptions import BotoCoreError, ClientError

from app.utils.aws_errors import aws_error_code


logger = logging.getLogger(__name__)


BucketCompareRemediationAction = Literal["sync_source_only", "sync_different", "delete_target_only"]


@dataclass(frozen=True)
class BucketCompareRemediationResult:
    action: BucketCompareRemediationAction
    planned_count: int
    succeeded_count: int
    failed_count: int
    failed_keys_sample: list[str]


def remediate_bucket_content(
    *,
    source_client: Any | None,
    target_client: Any,
    source_bucket: str,
    target_bucket: str,
    action: BucketCompareRemediationAction,
    object_keys: list[str],
    same_endpoint: bool,
    parallelism: int = 4,
    failed_keys_sample_limit: int = 50,
) -> BucketCompareRemediationResult:
    selected_keys = list(object_keys)
    planned_count = len(selected_keys)
    if planned_count == 0:
        return BucketCompareRemediationResult(
            action=action,
            planned_count=0,
            succeeded_count=0,
            failed_count=0,
            failed_keys_sample=[],
        )

    safe_parallelism = max(1, min(32, int(parallelism or 1)))
    failed_keys: list[str] = []
    succeeded_count = 0

    if action == "delete_target_only":
        succeeded_count, failed_keys = _delete_objects(
            target_client,
            target_bucket=target_bucket,
            keys=selected_keys,
        )
    else:
        if source_client is None:
            raise ValueError("A source client is required for bucket comparison synchronization")
        worker_count = max(1, min(safe_parallelism, planned_count))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-compare-remediate") as executor:
            futures = {
                executor.submit(
                    _copy_single_object,
                    source_client,
                    target_client,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    key=key,
                    same_endpoint=same_endpoint,
                ): key
                for key in selected_keys
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    future.result()
                    succeeded_count += 1
                except Exception:  # noqa: BLE001
                    failed_keys.append(key)

    failed_count = len(failed_keys)
    return BucketCompareRemediationResult(
        action=action,
        planned_count=planned_count,
        succeeded_count=succeeded_count,
        failed_count=failed_count,
        failed_keys_sample=sorted(failed_keys)[: max(1, failed_keys_sample_limit)],
    )


def _copy_single_object(
    source_client: Any,
    target_client: Any,
    *,
    source_bucket: str,
    target_bucket: str,
    key: str,
    same_endpoint: bool,
) -> None:
    if same_endpoint:
        copy_source = {"Bucket": source_bucket, "Key": key}
        try:
            target_client.copy_object(Bucket=target_bucket, Key=key, CopySource=copy_source)
            return
        except (ClientError, BotoCoreError) as exc:
            if not _is_access_denied_error(exc):
                raise RuntimeError(f"Unable to copy object '{key}': {exc}") from exc
            logger.warning(
                "CopyObject denied for '%s' (%s), falling back to stream copy.",
                key,
                exc,
            )

    _stream_copy_single_object(
        source_client,
        target_client,
        source_bucket=source_bucket,
        target_bucket=target_bucket,
        key=key,
    )


def _stream_copy_single_object(
    source_client: Any,
    target_client: Any,
    *,
    source_bucket: str,
    target_bucket: str,
    key: str,
) -> None:
    body = None
    try:
        response = source_client.get_object(Bucket=source_bucket, Key=key)
        body = response.get("Body")
        target_client.upload_fileobj(body, target_bucket, key)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to copy object '{key}': {exc}") from exc
    finally:
        if body is not None:
            try:
                body.close()
            except Exception:  # noqa: BLE001
                pass


def _delete_objects(client: Any, *, target_bucket: str, keys: list[str]) -> tuple[int, list[str]]:
    if not keys:
        return 0, []

    succeeded = 0
    failed_keys: list[str] = []
    for index in range(0, len(keys), 1000):
        chunk = keys[index : index + 1000]
        chunk_objects = [{"Key": key} for key in chunk]
        try:
            response = client.delete_objects(Bucket=target_bucket, Delete={"Objects": chunk_objects})
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{target_bucket}': {exc}") from exc

        errors = response.get("Errors", []) if isinstance(response, dict) else []
        failed_in_chunk = {
            str(entry.get("Key")).strip()
            for entry in errors
            if isinstance(entry, dict) and str(entry.get("Key", "")).strip()
        }
        succeeded += len(chunk) - len(failed_in_chunk)
        if failed_in_chunk:
            failed_keys.extend(sorted(failed_in_chunk))
    return succeeded, failed_keys


def _is_access_denied_error(exc: Exception) -> bool:
    code = aws_error_code(exc, lowercase=True)
    if code in {"accessdenied", "access_denied", "403", "unauthorized"}:
        return True
    text = str(exc).strip().lower()
    return "accessdenied" in text or "access denied" in text or "403" in text
