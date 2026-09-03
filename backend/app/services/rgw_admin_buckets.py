# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.services.rgw_admin_transport import RGWAdminOperationResponse


class RGWAdminBucketOperations:
    def get_bucket_info(
        self,
        bucket: str,
        tenant: Optional[str] = None,
        uid: Optional[str] = None,
        stats: bool = True,
        allow_not_found: bool = True,
        account_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"bucket": bucket, "format": "json"}
        if tenant:
            params["tenant"] = tenant
        if uid:
            params["uid"] = uid
        if account_id:
            params["account-id"] = account_id
        if stats:
            params["stats"] = "true"
        result = self._request(
            "GET",
            "/admin/bucket",
            params=params,
            allow_not_found=allow_not_found,
        )
        if result.get("not_found"):
            return None
        return result

    @staticmethod
    def _admin_bucket_identifier(
        bucket: str,
        tenant: Optional[str] = None,
    ) -> str:
        if tenant and not bucket.startswith(f"{tenant}/"):
            return f"{tenant}/{bucket}"
        return bucket

    def delete_bucket_operation(
        self,
        bucket: str,
        *,
        tenant: Optional[str] = None,
        purge_objects: bool = False,
        bypass_gc: bool = False,
    ) -> RGWAdminOperationResponse:
        params: Dict[str, Any] = {"bucket": bucket, "format": "json"}
        if tenant:
            params["tenant"] = tenant
        if purge_objects:
            params["purge-objects"] = "true"
        if bypass_gc:
            params["bypass-gc"] = "true"
        return self._request_operation("DELETE", "/admin/bucket", params=params)

    def unlink_bucket_operation(
        self,
        bucket: str,
        *,
        uid: str,
        tenant: Optional[str] = None,
    ) -> RGWAdminOperationResponse:
        return self._request_operation(
            "POST",
            "/admin/bucket",
            params={
                "bucket": self._admin_bucket_identifier(bucket, tenant),
                "uid": uid,
                "format": "json",
            },
        )

    def link_bucket_operation(
        self,
        bucket: str,
        *,
        uid: str,
        bucket_id: Optional[str] = None,
        tenant: Optional[str] = None,
    ) -> RGWAdminOperationResponse:
        params: Dict[str, Any] = {
            "bucket": self._admin_bucket_identifier(bucket, tenant),
            "uid": uid,
            "format": "json",
        }
        if bucket_id:
            params["bucket-id"] = bucket_id
        return self._request_operation("PUT", "/admin/bucket", params=params)

    def check_bucket_index_operation(
        self,
        bucket: str,
        *,
        tenant: Optional[str] = None,
        check_objects: bool = False,
        fix: bool = False,
    ) -> RGWAdminOperationResponse:
        params: Dict[str, Any] = {
            "bucket": self._admin_bucket_identifier(bucket, tenant),
            "index": "",
            "format": "json",
        }
        if check_objects:
            params["check-objects"] = "true"
        if fix:
            params["fix"] = "true"
        return self._request_operation("GET", "/admin/bucket", params=params)

    @staticmethod
    def _format_usage_timestamp(value: Any) -> str:
        if isinstance(value, datetime):
            normalized = value.astimezone(timezone.utc) if value.tzinfo else value
            return normalized.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
        return str(value)

    def get_usage(
        self,
        uid: Optional[str] = None,
        start: Optional[Any] = None,
        end: Optional[Any] = None,
        show_entries: bool = True,
        show_summary: bool = True,
        bucket: Optional[str] = None,
        tenant: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"format": "json"}
        if uid:
            params["uid"] = uid
        if tenant:
            params["tenant"] = tenant
        if bucket:
            params["bucket"] = bucket
        if start:
            params["start"] = self._format_usage_timestamp(start)
        if end:
            params["end"] = self._format_usage_timestamp(end)
        if show_entries:
            params["show-entries"] = "true"
        if show_summary:
            params["show-summary"] = "true"
        return self._request(
            "GET",
            "/admin/usage",
            params=params,
            allow_not_found=True,
        )

    def get_all_buckets(
        self,
        account_id: Optional[str] = None,
        uid: Optional[str] = None,
        with_stats: bool = False,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"format": "json"}
        if account_id:
            params["account-id"] = account_id
        if uid:
            params["uid"] = uid
        timeout: Optional[float] = None
        if with_stats:
            params["stats"] = "true"
            timeout = self.bucket_list_stats_timeout_seconds
        return self._request(
            "GET",
            "/admin/bucket",
            params=params,
            timeout=timeout,
        )

    def set_bucket_quota(
        self,
        bucket: str,
        tenant: Optional[str] = None,
        uid: Optional[str] = None,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        enabled: bool = True,
        account_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "bucket": bucket,
            "quota": "",
            "quota-scope": "bucket",
            "format": "json",
        }
        if tenant:
            params["tenant"] = tenant
        if uid:
            params["uid"] = uid
        if account_id:
            params["account-id"] = account_id
        if max_size_bytes is not None:
            params["max-size-kb"] = int(max_size_bytes // 1024)
        elif max_size_gb is not None:
            params["max-size-kb"] = int(max_size_gb * 1024 * 1024)
        if max_objects is not None:
            params["max-objects"] = int(max_objects)
        if enabled:
            params["enabled"] = "true"
        return self._request(
            "PUT",
            "/admin/bucket",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )
