# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from time import monotonic
from typing import Callable

from app.core.sensitive_data import sanitize_error_detail
from app.models.ceph_admin import (
    CephAdminAdminOpsResult,
    CephAdminBucketIndexCheckBatchBucketResult,
    CephAdminBucketIndexCheckBatchProgress,
    CephAdminBucketIndexCheckBatchResult,
    CephAdminBucketIndexCheckTarget,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, RGWAdminOperationResponse
from app.utils.time import utcnow


ProgressCallback = Callable[[CephAdminBucketIndexCheckBatchProgress], None]
CancelCheck = Callable[[], None]


class BucketIndexCheckCancelled(Exception):
    pass


def execute_bucket_index_check_operation(
    rgw_admin: RGWAdminClient,
    *,
    bucket: str,
    tenant: str | None,
    fix: bool,
    check_objects: bool,
) -> RGWAdminOperationResponse:
    return rgw_admin.check_bucket_index_operation(
        bucket,
        tenant=tenant,
        fix=fix,
        check_objects=check_objects,
    )


class BucketIndexCheckService:
    def run(
        self,
        rgw_admin: RGWAdminClient,
        targets: list[CephAdminBucketIndexCheckTarget],
        *,
        endpoint_id: int,
        endpoint_name: str,
        parallelism: int,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> CephAdminBucketIndexCheckBatchResult:
        started_at = utcnow()
        if progress_callback:
            progress_callback(
                CephAdminBucketIndexCheckBatchProgress(
                    stage="prepare",
                    total_buckets=len(targets),
                    message="Preparing read-only RGW bucket index checks",
                )
            )

        max_workers = max(1, min(parallelism, 16, len(targets)))
        results: list[CephAdminBucketIndexCheckBatchBucketResult] = []
        completed_buckets = 0
        failed_buckets = 0

        def run_target(target: CephAdminBucketIndexCheckTarget) -> CephAdminBucketIndexCheckBatchBucketResult:
            if cancel_check:
                cancel_check()
            started = monotonic()
            try:
                upstream = execute_bucket_index_check_operation(
                    rgw_admin,
                    bucket=target.name,
                    tenant=target.tenant,
                    fix=False,
                    check_objects=False,
                )
                success = bool(upstream.success)
                result = CephAdminBucketIndexCheckBatchBucketResult(
                    name=target.name,
                    tenant=target.tenant,
                    status="completed" if success else "failed",
                    duration_seconds=monotonic() - started,
                    rgw_status_code=upstream.status_code,
                    rgw_error_code=upstream.error_code,
                    message=upstream.message or (
                        "RGW bucket index check completed." if success else "RGW bucket index check failed."
                    ),
                    result=upstream.result,
                )
            except BucketIndexCheckCancelled:
                raise
            except RGWAdminError as exc:
                result = CephAdminBucketIndexCheckBatchBucketResult(
                    name=target.name,
                    tenant=target.tenant,
                    status="failed",
                    duration_seconds=monotonic() - started,
                    message=str(sanitize_error_detail(str(exc))),
                )
            except Exception as exc:  # noqa: BLE001
                result = CephAdminBucketIndexCheckBatchBucketResult(
                    name=target.name,
                    tenant=target.tenant,
                    status="failed",
                    duration_seconds=monotonic() - started,
                    message=str(sanitize_error_detail(str(exc))),
                )
            return result

        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="bucket-index-check") as executor:
            pending = {executor.submit(run_target, target): target for target in targets}
            while pending:
                if cancel_check:
                    cancel_check()
                done, _ = wait(pending.keys(), timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    target = pending.pop(future)
                    result = future.result()
                    results.append(result)
                    completed_buckets += 1
                    if result.status == "failed":
                        failed_buckets += 1
                    if progress_callback:
                        progress_callback(
                            CephAdminBucketIndexCheckBatchProgress(
                                stage="completed",
                                bucket_name=target.name,
                                tenant=target.tenant,
                                total_buckets=len(targets),
                                completed_buckets=completed_buckets,
                                failed_buckets=failed_buckets,
                                message=f"{completed_buckets}/{len(targets)} bucket indexes checked",
                            )
                        )

        finished_at = utcnow()
        status = "completed" if failed_buckets == 0 else ("failed" if failed_buckets == len(targets) else "completed_with_errors")
        return CephAdminBucketIndexCheckBatchResult(
            status=status,
            total_buckets=len(targets),
            completed_buckets=completed_buckets,
            failed_buckets=failed_buckets,
            started_at=started_at,
            finished_at=finished_at,
            buckets=sorted(results, key=lambda item: ((item.tenant or ""), item.name)),
        )
