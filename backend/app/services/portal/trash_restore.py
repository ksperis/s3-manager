# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.portal import (
    PortalDeletedPrefixRestoreFailure,
    PortalDeletedPrefixRestoreProgress,
    PortalDeletedPrefixRestoreResult,
    PortalDeletedPrefixRestoreStage,
)
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.object_restore_store import (
    ObjectRestoreScanCounts,
    ObjectRestoreStore,
)

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


PortalDeletedPrefixRestoreProgressCallback = Callable[
    [PortalDeletedPrefixRestoreProgress], None
]
PortalDeletedPrefixRestoreCancelCheck = Callable[[], None]
_FAILURE_DETAIL_LIMIT = 20
_RESTORE_CONCURRENCY = 4


@dataclass(frozen=True)
class PortalDeletedPrefixRestoreTarget:
    client: Any
    bucket_name: str
    storage_space_id: str
    storage_space_name: str
    prefix: str


@dataclass
class _PortalDeletedPrefixRestoreState:
    started_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    restore_candidates: int = 0
    restored_objects: int = 0
    failed_objects: int = 0
    failures: list[PortalDeletedPrefixRestoreFailure] = field(default_factory=list)


class _PortalDeletedPrefixRestoreRunner:
    def __init__(
        self,
        *,
        target: PortalDeletedPrefixRestoreTarget,
        restore_version: Callable[..., Any],
        progress_callback: PortalDeletedPrefixRestoreProgressCallback | None,
        cancel_check: PortalDeletedPrefixRestoreCancelCheck | None,
    ) -> None:
        self.target = target
        self.restore_version = restore_version
        self.progress_callback = progress_callback
        self.cancel_check = cancel_check
        self.state = _PortalDeletedPrefixRestoreState()

    def run(self) -> PortalDeletedPrefixRestoreResult:
        self._emit("prepare", "Preparing deleted file restoration...")
        with TemporarySqliteStore(
            prefix="bucketreef-portal-deleted-prefix-restore-"
        ) as temporary_store:
            store = ObjectRestoreStore(temporary_store.connection)
            self._scan_candidates(store)
            self._restore_candidates(store)
        self._emit(
            "completed",
            "Deleted file restoration completed.",
            total_candidates_final=True,
        )
        return self._result()

    def _scan_candidates(self, store: ObjectRestoreStore) -> None:
        self._emit("list", "Scanning deleted files in this folder...")

        def update_progress(counts: ObjectRestoreScanCounts) -> None:
            self.state.scanned_versions = counts.versions
            self.state.scanned_delete_markers = counts.delete_markers
            self._emit("list", "Scanning deleted files in this folder...")

        store.scan(
            self.target.client,
            self.target.bucket_name,
            self.target.prefix,
            before_page=self._check_cancel,
            after_page=update_progress,
        )

    def _restore_candidates(self, store: ObjectRestoreStore) -> None:
        self.state.restore_candidates = store.count_candidates()
        self._emit(
            "restore",
            "Restoring deleted files...",
            total_candidates_final=True,
        )
        with ThreadPoolExecutor(max_workers=_RESTORE_CONCURRENCY) as executor:
            self._check_cancel()
            for batch in store.iter_candidate_batches(_RESTORE_CONCURRENCY):
                futures = {
                    executor.submit(
                        self.restore_version,
                        self.target.client,
                        self.target.bucket_name,
                        str(row["key"]),
                        str(row["version_id"]),
                        space_id=self.target.storage_space_id,
                    ): str(row["key"])
                    for row in batch
                }
                for future in as_completed(futures):
                    key = futures[future]
                    self._record_restore_result(future, key)
                    self._emit(
                        "restore",
                        "Restoring deleted files...",
                        total_candidates_final=True,
                        current_key=key,
                    )
                self._check_cancel()

    def _record_restore_result(self, future: Future[Any], key: str) -> None:
        try:
            future.result()
            self.state.restored_objects += 1
        except Exception as exc:
            self.state.failed_objects += 1
            if len(self.state.failures) < _FAILURE_DETAIL_LIMIT:
                self.state.failures.append(
                    PortalDeletedPrefixRestoreFailure(
                        key=key,
                        detail=str(sanitize_error_detail(str(exc))),
                    )
                )

    def _check_cancel(self) -> None:
        if self.cancel_check:
            self.cancel_check()

    def _emit(
        self,
        stage: PortalDeletedPrefixRestoreStage,
        message: str,
        *,
        total_candidates_final: bool = False,
        current_key: str | None = None,
    ) -> None:
        if self.progress_callback is None:
            return
        self.progress_callback(
            PortalDeletedPrefixRestoreProgress(
                stage=stage,
                storage_space_id=self.target.storage_space_id,
                storage_space_name=self.target.storage_space_name,
                prefix=self.target.prefix,
                scanned_versions=self.state.scanned_versions,
                scanned_delete_markers=self.state.scanned_delete_markers,
                restore_candidates=self.state.restore_candidates,
                restored_objects=self.state.restored_objects,
                failed_objects=self.state.failed_objects,
                total_candidates_final=total_candidates_final,
                current_key=current_key,
                message=message,
            )
        )

    def _result(self) -> PortalDeletedPrefixRestoreResult:
        state = self.state
        return PortalDeletedPrefixRestoreResult(
            status="partial" if state.failed_objects else "completed",
            storage_space_id=self.target.storage_space_id,
            storage_space_name=self.target.storage_space_name,
            prefix=self.target.prefix,
            scanned_versions=state.scanned_versions,
            scanned_delete_markers=state.scanned_delete_markers,
            restore_candidates=state.restore_candidates,
            restored_objects=state.restored_objects,
            failed_objects=state.failed_objects,
            failures=state.failures,
            failures_truncated=state.failed_objects > len(state.failures),
            started_at=state.started_at,
            finished_at=datetime.now(timezone.utc),
        )


class PortalDeletedPrefixRestoreMixin:
    def prepare_deleted_prefix_restore(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        prefix: str,
    ) -> PortalDeletedPrefixRestoreTarget:
        target_prefix = (prefix or "").lstrip("/")
        if not target_prefix:
            raise ValueError("A folder prefix is required.")
        if not target_prefix.endswith("/"):
            target_prefix = f"{target_prefix}/"
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise RuntimeError("Storage space not found or not allowed.")
        if self._require_storage_space_content_role(user, access, bucket_name) == "Viewer":
            raise RuntimeError("Restore not allowed for this storage space role.")
        self._require_storage_space_active(access.account, bucket_name)
        client = self._portal_object_client(
            user,
            access.account,
            request_profile="long_running",
        )
        if self._storage_space_versioning_status(client, bucket_name, space_id) == "Disabled":
            raise RuntimeError("File history is not enabled for this storage space.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        return PortalDeletedPrefixRestoreTarget(
            client=client,
            bucket_name=bucket_name,
            storage_space_id=space_id,
            storage_space_name=self._display_storage_space_name(bucket_name, metadata),
            prefix=target_prefix,
        )

    def run_deleted_prefix_restore(
        self,
        target: PortalDeletedPrefixRestoreTarget,
        *,
        progress_callback: PortalDeletedPrefixRestoreProgressCallback | None = None,
        cancel_check: PortalDeletedPrefixRestoreCancelCheck | None = None,
    ) -> PortalDeletedPrefixRestoreResult:
        try:
            return _PortalDeletedPrefixRestoreRunner(
                target=target,
                restore_version=self._restore_storage_space_object_version_with_client,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            ).run()
        except BucketPurgeCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                f"Unable to restore deleted files from '{target.prefix}' "
                f"in Storage Space '{target.storage_space_name}': {exc}"
            ) from exc
