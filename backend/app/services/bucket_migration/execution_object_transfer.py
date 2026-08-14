# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable, Optional
from urllib.parse import urlencode

from botocore.exceptions import BotoCoreError, ClientError

from ._shared import (
    _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER,
    _RUN_ACTIONS_WAIT_TIMEOUT_SECONDS,
    _ResolvedContext,
    _WorkerLeaseLostError,
    _chunked,
)

logger = logging.getLogger(__name__)


class BucketMigrationObjectTransferMixin:
    def _copy_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        same_endpoint: bool,
        version_id: Optional[str] = None,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        if same_endpoint:
            copy_source = {"Bucket": source_bucket, "Key": key}
            if version_id:
                copy_source["VersionId"] = version_id
            try:
                head = self._head_object_with_version(
                    resolved_source_client,
                    source_bucket,
                    key,
                    version_id=version_id,
                )
                kwargs: dict[str, Any] = {
                    "Bucket": target_bucket,
                    "Key": key,
                    "CopySource": copy_source,
                    "MetadataDirective": "COPY",
                    "TaggingDirective": "COPY",
                }
                storage_class = head.get("StorageClass")
                if isinstance(storage_class, str) and storage_class.strip():
                    kwargs["StorageClass"] = storage_class.strip()
                resolved_target_client.copy_object(**kwargs)
                return
            except (ClientError, BotoCoreError) as exc:
                if not self._is_access_denied_error(exc):
                    object_label = (
                        f"object version '{version_id}' for '{key}'"
                        if version_id
                        else f"object '{key}'"
                    )
                    raise RuntimeError(
                        f"Unable to copy {object_label} with x-amz-copy-source: {exc}"
                    ) from exc
                copy_label = f"version '{version_id}' of '{key}'" if version_id else f"'{key}'"
                logger.warning(
                    "CopyObject with x-amz-copy-source denied for %s (%s), falling back to stream-copy.",
                    copy_label,
                    exc,
                )

        self._stream_copy_object(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            key=key,
            version_id=version_id,
            source_client=resolved_source_client,
            target_client=resolved_target_client,
        )

    def _build_upload_extra_args(
        self,
        *,
        head: dict[str, Any],
        tags: tuple[tuple[str, str], ...],
    ) -> dict[str, Any]:
        extra_args: dict[str, Any] = {}
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        if metadata:
            extra_args["Metadata"] = {
                str(meta_key): str(meta_value)
                for meta_key, meta_value in metadata.items()
                if meta_key is not None and meta_value is not None
            }
        for head_field, extra_arg_field in (
            ("ContentType", "ContentType"),
            ("CacheControl", "CacheControl"),
            ("ContentDisposition", "ContentDisposition"),
            ("ContentEncoding", "ContentEncoding"),
            ("ContentLanguage", "ContentLanguage"),
            ("Expires", "Expires"),
            ("StorageClass", "StorageClass"),
        ):
            value = head.get(head_field)
            if value is not None:
                extra_args[extra_arg_field] = value
        if tags:
            extra_args["Tagging"] = urlencode({tag_key: tag_value for tag_key, tag_value in tags})
        return extra_args

    def _stream_copy_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        version_id: Optional[str] = None,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        body = None
        try:
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            tags = self._get_object_tags_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            get_kwargs: dict[str, Any] = {"Bucket": source_bucket, "Key": key}
            if version_id:
                get_kwargs["VersionId"] = version_id
            response = resolved_source_client.get_object(**get_kwargs)
            body = response.get("Body")
            extra_args = self._build_upload_extra_args(head=head, tags=tags)
            if extra_args:
                resolved_target_client.upload_fileobj(body, target_bucket, key, ExtraArgs=extra_args)
            else:
                resolved_target_client.upload_fileobj(body, target_bucket, key)
        except (ClientError, BotoCoreError) as exc:
            object_label = (
                f"object version '{version_id}' for '{key}'"
                if version_id
                else f"object '{key}'"
            )
            raise RuntimeError(f"Unable to stream-copy {object_label}: {exc}") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

    def _delete_single_object(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        key: str,
        *,
        target_client: Any | None = None,
    ) -> None:
        client = target_client or self._context_client(target_ctx)
        try:
            client.delete_object(Bucket=target_bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete target object '{key}': {exc}") from exc

    def _run_copy_actions(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        same_endpoint: bool,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        copied = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _copy_worker(key: str) -> None:
            source_client = getattr(thread_local, "source_client", None)
            if source_client is None:
                source_client = self._context_client(source_ctx)
                thread_local.source_client = source_client
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._copy_object(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                key=key,
                same_endpoint=same_endpoint,
                source_client=source_client,
                target_client=target_client,
            )

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while copying objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-copy") as executor:
                futures = {executor.submit(_copy_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        copied += 1
                        if on_progress is not None:
                            on_progress(copied_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while copying objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return copied

    def _run_delete_actions(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        deleted = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _delete_worker(key: str) -> None:
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._delete_single_object(target_ctx, target_bucket, key, target_client=target_client)

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-delete") as executor:
                futures = {executor.submit(_delete_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        deleted += 1
                        if on_progress is not None:
                            on_progress(deleted_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return deleted
