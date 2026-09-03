# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Dict, Optional

from app.services.rgw_admin_accounts import RGWAdminAccountOperations
from app.services.rgw_admin_buckets import RGWAdminBucketOperations
from app.services.rgw_admin_transport import (
    RGWAdminError,
    RGWAdminOperationResponse,
    RGWAdminTransport,
)
from app.services.rgw_admin_users import RGWAdminUserOperations

__all__ = [
    "RGWAdminClient",
    "RGWAdminError",
    "RGWAdminOperationResponse",
    "get_rgw_admin_client",
]


class RGWAdminClient(
    RGWAdminAccountOperations,
    RGWAdminBucketOperations,
    RGWAdminUserOperations,
    RGWAdminTransport,
):
    def list_topics(
        self,
        account_id: Optional[str] = None,
    ) -> Optional[list[Dict[str, Any]]]:
        params: Dict[str, Any] = {"format": "json", "list": ""}
        if account_id:
            params["account-id"] = account_id
        result = self._request(
            "GET",
            "/admin/notification",
            params=params,
            allow_not_found=True,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and result.get("not_implemented"):
            return None
        if isinstance(result, dict) and result.get("not_found"):
            return []
        if isinstance(result, dict) and "topics" in result:
            topics = result.get("topics")
            return topics if isinstance(topics, list) else []
        if isinstance(result, list):
            return result
        return []

    def get_info(self, allow_not_found: bool = True) -> Dict[str, Any]:
        result = self._request(
            "GET",
            "/api/info",
            params={"format": "json"},
            allow_not_found=allow_not_found,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and (
            result.get("not_found") or result.get("not_implemented")
        ):
            return {}
        return result if isinstance(result, dict) else {}


def get_rgw_admin_client(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
    request_timeout_seconds: Optional[float] = None,
) -> RGWAdminClient:
    return RGWAdminClient(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
        request_timeout_seconds=request_timeout_seconds,
    )
