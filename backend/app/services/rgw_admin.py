# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Any, Dict, Optional, Tuple

from app.services.rgw_admin_accounts import RGWAdminAccountOperations
from app.services.rgw_admin_buckets import RGWAdminBucketOperations
from app.services.rgw_admin_transport import (
    RGWAdminError,
    RGWAdminOperationResponse,
    RGWAdminTransport,
)
from app.utils.quota_stats import extract_quota_limits

__all__ = [
    "RGWAdminClient",
    "RGWAdminError",
    "RGWAdminOperationResponse",
    "get_rgw_admin_client",
]


class RGWAdminClient(
    RGWAdminAccountOperations,
    RGWAdminBucketOperations,
    RGWAdminTransport,
):
    def _sanitize_uid(self, name: str) -> str:
        uid = name.lower()
        uid = re.sub(r"[^a-z0-9_.-]", "-", uid)
        return uid

    def _to_rgw_bool(self, value: bool) -> str:
        return "true" if value else "false"

    def create_user(
        self,
        uid: str,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        tenant: Optional[str] = None,
        caps: Optional[str] = None,
        generate_key: bool = True,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "uid": uid,
            "display-name": display_name or uid,
            "email": email or "",
            "generate-key": self._to_rgw_bool(bool(generate_key)),
        }
        if tenant:
            params["tenant"] = tenant
        if caps:
            params["caps"] = caps
        self._merge_extra_params(params, extra_params)
        result = self._request("PUT", "/admin/user", params=params, allow_conflict=True)
        if isinstance(result, dict) and result.get("conflict"):
            existing = self.get_user(uid, tenant=tenant, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
        return result

    def get_user(
        self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False
    ) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"uid": uid, "format": "json"}
        if tenant:
            params["tenant"] = tenant
        result = self._request("GET", "/admin/user", params=params, allow_not_found=allow_not_found)
        if result.get("not_found") and tenant:
            composite_uid = f"{tenant}${uid}"
            fallback_params: Dict[str, Any] = {"uid": composite_uid, "format": "json"}
            result = self._request("GET", "/admin/user", params=fallback_params, allow_not_found=allow_not_found)
        if result.get("not_found"):
            return None
        return result

    def get_user_by_access_key(
        self, access_key: str, allow_not_found: bool = False
    ) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"access-key": access_key, "format": "json"}
        result = self._request("GET", "/admin/user", params=params, allow_not_found=allow_not_found)
        if result.get("not_found"):
            return None
        return result

    def create_access_key(
        self,
        uid: str,
        tenant: Optional[str] = None,
        key_name: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if account_id:
            raise RGWAdminError("account-scoped access key creation is not supported on this RGW cluster")
        params: Dict[str, Any] = {"uid": uid, "key": "true", "generate-key": "true", "format": "json"}
        if tenant:
            params["tenant"] = tenant
        if key_name:
            params["key-name"] = key_name
        return self._request("PUT", "/admin/user", params=params, allow_conflict=True, allow_not_found=True)

    def delete_access_key(self, uid: str, access_key: str, tenant: Optional[str] = None) -> None:
        if not access_key:
            raise RGWAdminError("access_key is required to delete a key")
        params: Dict[str, Any] = {
            "uid": uid,
            "access-key": access_key,
            "key": access_key,
            "format": "json",
        }
        if tenant:
            params["tenant"] = tenant
        self._request("DELETE", "/admin/user", params=params, allow_not_found=True)

    def set_access_key_status(
        self,
        uid: str,
        access_key: str,
        enabled: bool,
        tenant: Optional[str] = None,
    ) -> None:
        if not access_key:
            raise RGWAdminError("access_key is required to update status")
        params: Dict[str, Any] = {
            "uid": uid,
            "key": "true",
            "generate-key": "false",
            "access-key": access_key,
            "active": self._to_rgw_bool(enabled),
            "format": "json",
        }
        if tenant:
            params["tenant"] = tenant
        response = self._request(
            "PUT",
            "/admin/user",
            params=params,
            allow_not_implemented=True,
        )
        if isinstance(response, dict) and response.get("not_implemented"):
            raise RGWAdminError("RGW does not support updating access key status")

    def extract_keys(self, data: Any) -> list[dict]:
        """Normalize access-key entries from the RGW response shapes we support."""
        if not data:
            return []

        entries: list[dict] = []

        if isinstance(data, list):
            entries.extend([item for item in data if isinstance(item, dict)])
        elif isinstance(data, dict):
            for field_name in ("keys", "s3_credentials", "key"):
                field_value = data.get(field_name)
                if isinstance(field_value, list):
                    entries.extend([item for item in field_value if isinstance(item, dict)])

            # Key data may be nested under "user"
            user_field = data.get("user")
            if isinstance(user_field, dict):
                nested_keys = self.extract_keys(user_field)
                if nested_keys:
                    entries.extend(nested_keys)

            access_value = data.get("access_key")
            secret_value = data.get("secret_key")
            if access_value and secret_value:
                entry: Dict[str, Any] = {
                    "access_key": access_value,
                    "secret_key": secret_value,
                }
                for field_name in (
                    "status",
                    "key_status",
                    "state",
                    "create_time",
                    "create-time",
                    "create_date",
                    "create-date",
                    "created_at",
                    "create_timestamp",
                    "timestamp",
                ):
                    field_value = data.get(field_name)
                    if field_value is not None:
                        entry[field_name] = field_value
                entries.insert(0, entry)
        else:
            return []

        if not entries:
            return []

        def _has_secret(entry: dict) -> bool:
            return bool(entry.get("secret_key"))

        # Prefer entries that include a secret; RGW tends to only reveal the new key's secret once.
        prioritized = sorted(
            (entry for entry in entries if isinstance(entry, dict)),
            key=lambda entry: 0 if _has_secret(entry) else 1,
        )

        result: list[dict] = []
        seen_by_access: dict[str, dict] = {}
        for entry in prioritized:
            access_value = entry.get("access_key")
            normalized = str(access_value) if access_value is not None else None
            if not normalized:
                result.append(entry)
                continue
            existing = seen_by_access.get(normalized)
            if existing is None:
                copied = dict(entry)
                seen_by_access[normalized] = copied
                result.append(copied)
                continue

            # Merge sparse duplicate entries: RGW may return secret/status/timestamps
            # in separate rows for the same access key.
            for field_name, field_value in entry.items():
                if field_name not in existing or existing.get(field_name) in (None, "", [], {}):
                    if field_value not in (None, "", [], {}):
                        existing[field_name] = field_value

        return result

    def list_users(self) -> list[Dict[str, Any]]:
        params: Dict[str, Any] = {"format": "json"}
        result = self._request("GET", "/admin/metadata/user", params=params)
        if not isinstance(result, list):
            return []
        normalized: list[Dict[str, Any]] = []
        for entry in result:
            if isinstance(entry, dict):
                normalized.append(entry)
            else:
                normalized.append({"user": str(entry)})
        return normalized

    def update_user(
        self,
        uid: str,
        *,
        tenant: Optional[str] = None,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        suspended: Optional[bool] = None,
        max_buckets: Optional[int] = None,
        op_mask: Optional[str] = None,
        admin: Optional[bool] = None,
        system: Optional[bool] = None,
        account_root: Optional[bool] = None,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"uid": uid, "format": "json"}
        if tenant:
            params["tenant"] = tenant
        if display_name is not None:
            params["display-name"] = display_name
        if email is not None:
            params["email"] = email
        if suspended is not None:
            params["suspended"] = self._to_rgw_bool(bool(suspended))
        if max_buckets is not None:
            params["max_buckets"] = int(max_buckets)
        if op_mask is not None:
            params["op-mask"] = op_mask
        if admin is not None:
            params["admin"] = self._to_rgw_bool(bool(admin))
        if system is not None:
            params["system"] = self._to_rgw_bool(bool(system))
        if account_root is not None:
            params["account-root"] = self._to_rgw_bool(bool(account_root))
        self._merge_extra_params(params, extra_params)
        result = self._request(
            "PUT",
            "/admin/user",
            params=params,
            data=None,
            allow_conflict=True,
            allow_not_found=True,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and result.get("conflict"):
            existing = self.get_user(uid, tenant=tenant, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
        return result

    def list_user_keys(self, uid: str, tenant: Optional[str] = None) -> list[Dict[str, Any]]:
        payload = self.get_user(uid, tenant=tenant, allow_not_found=True)
        if not payload:
            return []
        return self.extract_keys(payload)

    def list_topics(self, account_id: Optional[str] = None) -> Optional[list[Dict[str, Any]]]:
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
        if isinstance(result, dict) and (result.get("not_found") or result.get("not_implemented")):
            return {}
        return result if isinstance(result, dict) else {}

    def delete_user(self, uid: str, tenant: Optional[str] = None) -> None:
        attempts = [uid]
        sanitized = self._sanitize_uid(uid)
        if sanitized != uid:
            attempts.append(sanitized)
        for candidate in attempts:
            params: Dict[str, Any] = {"uid": candidate, "format": "json"}
            if tenant:
                params["tenant"] = tenant
            try:
                self._request("DELETE", "/admin/user", params=params, allow_not_found=True)
                return
            except RGWAdminError:
                continue

    def delete_user_operation(
        self,
        uid: str,
        *,
        tenant: Optional[str] = None,
        purge_data: bool = False,
    ) -> RGWAdminOperationResponse:
        params: Dict[str, Any] = {"uid": uid, "format": "json"}
        if tenant:
            params["tenant"] = tenant
        if purge_data:
            params["purge-data"] = "true"
        return self._request_operation("DELETE", "/admin/user", params=params)

    def get_user_quota(self, uid: str, tenant: Optional[str] = None) -> Tuple[Optional[int], Optional[int]]:
        payload = self.get_user(uid, tenant=tenant, allow_not_found=True) or {}
        if payload.get("not_found"):
            return None, None
        return extract_quota_limits(payload, keys=("user_quota", "quota"))

    def set_user_quota(
        self,
        uid: str,
        tenant: Optional[str] = None,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "user",
        enabled: bool = True,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "quota": "",
            "uid": uid,
            "quota-type": quota_type,
            "format": "json",
        }
        if tenant:
            params["tenant"] = tenant
        if max_size_bytes is not None:
            params["max-size"] = int(max_size_bytes)
        elif max_size_gb is not None:
            params["max-size"] = int(max_size_gb * 1024 * 1024 * 1024)
        if max_objects is not None:
            params["max-objects"] = int(max_objects)
        params["enabled"] = "true" if enabled else "false"
        return self._request(
            "PUT",
            "/admin/user",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )

    def set_user_caps(self, uid: str, caps: Any, tenant: Optional[str] = None, op: str = "add") -> Dict[str, Any]:
        if isinstance(caps, (list, tuple, set)):
            caps_values = [str(value) for value in caps if value]
        else:
            caps_values = [str(caps)]
        result: Dict[str, Any] = {}
        for value in caps_values:
            params: list[tuple[str, str]] = [("caps", ""), ("uid", uid), ("user-caps", value), ("format", "json")]
            if op:
                params.append(("caps-op", op))
            if tenant:
                params.append(("tenant", tenant))
            result = self._request("PUT", "/admin/user", params=params)
        return result


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
