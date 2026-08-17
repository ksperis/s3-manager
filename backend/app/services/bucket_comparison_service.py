# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
import logging
from typing import Any, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.ceph_admin import CephAdminBucketConfigDiff, CephAdminBucketContentDiff
from app.services import (
    bucket_compare_remediation,
    bucket_configuration_comparison,
    bucket_content_comparison,
    s3_client,
)
from app.services.bucket_configuration_comparison import BucketConfigurationReader
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_errors import format_s3_error
from app.utils.s3_etag import etag_md5

logger = logging.getLogger(__name__)


class BucketComparisonService:
    """Compare bucket contents and configuration, then remediate content differences."""

    def __init__(self, configuration_reader: Optional[BucketConfigurationReader] = None) -> None:
        self._configuration_reader = configuration_reader or BucketConfigurationService()

    @staticmethod
    def _account_credentials(account: S3ExecutionTarget) -> tuple[str, str]:
        return require_s3_execution_credentials(
            account,
            error_message="S3ExecutionTarget is missing admin credentials",
        )

    @staticmethod
    def _client_kwargs(account: S3ExecutionTarget) -> dict[str, object]:
        return s3_execution_client_kwargs(account)

    def _compare_client(self, account: S3ExecutionTarget):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            request_profile="long_running",
            **self._client_kwargs(account),
        )

    def _list_bucket_objects_for_compare(self, bucket_name: str, account: S3ExecutionTarget):
        client = self._compare_client(account)
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**kwargs)
            except (RuntimeError, ClientError, BotoCoreError) as exc:
                detail = format_s3_error(exc, include_operation=True)
                raise RuntimeError(f"Unable to list objects in bucket '{bucket_name}': {detail}") from exc
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                etag_raw = entry.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                last_modified = entry.get("LastModified")
                storage_class = entry.get("StorageClass")
                yield bucket_content_comparison.BucketCompareObjectEntry(
                    key=key,
                    size=int(entry.get("Size") or 0),
                    etag=etag or None,
                    last_modified=last_modified if isinstance(last_modified, datetime) else None,
                    storage_class=storage_class if isinstance(storage_class, str) else None,
                )
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

    def compare_bucket_content(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        ignore_modified_after: Optional[datetime] = None,
    ) -> CephAdminBucketContentDiff:
        with TemporarySqliteStore(prefix="kaelo-bucket-compare-") as store:
            index = bucket_content_comparison.BucketCompareObjectIndex(store.connection)
            source_indexed_count = index.add_objects(
                "source",
                self._list_bucket_objects_for_compare(source_bucket, source_account),
            )
            target_indexed_count = index.add_objects(
                "target",
                self._list_bucket_objects_for_compare(target_bucket, target_account),
            )
            diff = index.build_content_diff(
                md5_resolver=etag_md5,
                ignore_modified_after=ignore_modified_after,
            )
            logger.info(
                "Bucket compare indexed object metadata with temporary store: "
                "source_indexed_count=%s target_indexed_count=%s source_count=%s target_count=%s",
                source_indexed_count,
                target_indexed_count,
                diff.source_count,
                diff.target_count,
            )
            return diff

    def _accounts_share_storage_endpoint(
        self,
        source_account: S3ExecutionTarget,
        target_account: S3ExecutionTarget,
    ) -> bool:
        source_options = self._client_kwargs(source_account)
        target_options = self._client_kwargs(target_account)
        return (
            source_options.get("endpoint") == target_options.get("endpoint")
            and source_options.get("region") == target_options.get("region")
            and bool(source_options.get("force_path_style")) == bool(target_options.get("force_path_style"))
            and bool(source_options.get("verify_tls")) == bool(target_options.get("verify_tls"))
        )

    def run_compare_content_remediation(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        action: bucket_compare_remediation.BucketCompareRemediationAction,
        object_keys: list[str],
        parallelism: int = 4,
        failed_keys_sample_limit: int = 50,
    ) -> bucket_compare_remediation.BucketCompareRemediationResult:
        if not object_keys:
            return bucket_compare_remediation.remediate_bucket_content(
                source_client=None,
                target_client=None,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                action=action,
                object_keys=[],
                same_endpoint=False,
                parallelism=parallelism,
                failed_keys_sample_limit=failed_keys_sample_limit,
            )

        if action == "delete_target_only":
            source_client = None
            target_client = self._compare_client(target_account)
            same_endpoint = False
        else:
            source_client = self._compare_client(source_account)
            target_client = self._compare_client(target_account)
            same_endpoint = self._accounts_share_storage_endpoint(source_account, target_account)

        return bucket_compare_remediation.remediate_bucket_content(
            source_client=source_client,
            target_client=target_client,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            action=action,
            object_keys=object_keys,
            same_endpoint=same_endpoint,
            parallelism=parallelism,
            failed_keys_sample_limit=failed_keys_sample_limit,
        )

    def compare_bucket_configuration(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        include_sections: Optional[set[str]] = None,
    ) -> CephAdminBucketConfigDiff:
        return bucket_configuration_comparison.compare_bucket_configuration(
            self._configuration_reader,
            source_bucket,
            source_account,
            target_bucket,
            target_account,
            include_sections=include_sections,
        )


def get_bucket_comparison_service() -> BucketComparisonService:
    return BucketComparisonService()
