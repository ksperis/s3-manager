# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import time
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.services.app_settings_service import load_app_settings
from app.services.s3_deletion import purge_bucket_contents
from app.services.s3_execution_context import S3ExecutionTarget
from ._shared import _ResolvedContext

logger = logging.getLogger(__name__)


class BucketMigrationCleanupMixin:
    def _delete_source_bucket_with_retry(self, source_bucket: str, source_account: S3ExecutionTarget) -> None:
        last_exc: Optional[RuntimeError] = None
        for attempt in range(1, 4):
            try:
                self._buckets.delete_bucket(source_bucket, source_account, force=True)
                return
            except RuntimeError as exc:
                last_exc = exc
                if not self._is_access_denied_error(exc) or attempt == 3:
                    raise
                logger.warning(
                    "Delete source bucket got AccessDenied (bucket=%s, attempt=%s/3), retrying.",
                    source_bucket,
                    attempt,
                )
                # Policy propagation may lag briefly on some S3 implementations.
                time.sleep(0.8 * attempt)
        if last_exc is not None:
            raise last_exc

    def _purge_target_bucket(self, target_ctx: _ResolvedContext, target_bucket: str) -> tuple[int, int]:
        client = self._context_client(target_ctx)
        try:
            manager_settings = load_app_settings().manager
            result = purge_bucket_contents(
                client,
                target_bucket,
                parallelism=max(1, min(int(manager_settings.bucket_migration_parallelism_max or 10), 64)),
                include_versions=True,
                tolerate_missing_bucket=True,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to purge target bucket '{target_bucket}' for rollback: {exc}") from exc
        if result.failed_count > 0:
            sample = ", ".join(failure.message for failure in result.failures_sample[:3])
            extra = f" (+{result.failed_count - len(result.failures_sample[:3])} more)" if result.failed_count > 3 else ""
            raise RuntimeError(f"Unable to purge target bucket '{target_bucket}' for rollback: {sample}{extra}")
        return result.deleted_objects, result.deleted_versions
