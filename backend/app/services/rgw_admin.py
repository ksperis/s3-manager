# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
import secrets
from datetime import datetime, timezone
from time import perf_counter
from threading import Lock
from typing import Any, Dict, Optional, Tuple

import requests
from requests_aws4auth import AWS4Auth

from app.core.config import get_settings
from app.utils.quota_stats import extract_quota_limits

settings = get_settings()
import logging

logger = logging.getLogger(__name__)


class RGWAdminError(RuntimeError):
    pass


class RGWAdminClient:
    def __init__(
        self,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        region: Optional[str] = None,
        verify_tls: bool = True,
        request_timeout_seconds: Optional[float] = None,
        bucket_list_stats_timeout_seconds: Optional[float] = None,
    ) -> None:
        resolved_endpoint = endpoint
        if not resolved_endpoint:
            raise RGWAdminError("RGW admin endpoint is not configured")
        self.endpoint = resolved_endpoint.rstrip("/") if resolved_endpoint else ""
        self.region = region or settings.seed_s3_region
        self.access_key = access_key
        self.secret_key = secret_key
        self.verify_tls = bool(verify_tls)
        if not self.access_key or not self.secret_key:
            raise RGWAdminError("RGW admin credentials are not configured")
        self.auth = AWS4Auth(self.access_key, self.secret_key, self.region, "s3")
        self.session = requests.Session()
        self.request_timeout_seconds = (
            float(request_timeout_seconds)
            if request_timeout_seconds is not None
            else float(settings.rgw_admin_timeout_seconds)
        )
        self.bucket_list_stats_timeout_seconds = (
            float(bucket_list_stats_timeout_seconds)
            if bucket_list_stats_timeout_seconds is not None
            else float(settings.rgw_admin_bucket_list_stats_timeout_seconds)
        )
        self._account_api_support_state = "unknown"
        self._account_api_support_lock = Lock()

    @property
    def account_api_supported(self) -> Optional[bool]:
        if self._account_api_support_state == "supported":
            return True
        if self._account_api_support_state == "unsupported":
            return False
        return None

    def _mark_account_api_support(self, supported: bool) -> None:
        self._account_api_support_state = "supported" if supported else "unsupported"

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        allow_conflict: bool = False,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        url = f"{self.endpoint}{path}"
        start = perf_counter()
        try:
            headers = None
            if method.upper() in {"POST", "PUT", "DELETE"}:
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                if data:
                    headers = {"Content-Type": "application/x-www-form-urlencoded"}
            resp = self.session.request(
                method,
                url,
                params=params,
                data=data,
                headers=headers,
                auth=self.auth,
                timeout=self.request_timeout_seconds if timeout is None else timeout,
                verify=self.verify_tls,
            )
            logger.debug(
                "RGW request method=%s path=%s status=%s duration_ms=%.2f",
                method.upper(),
                path,
                resp.status_code,
                (perf_counter() - start) * 1000,
            )
        except requests.RequestException as exc:
            logger.warning(
                "RGW request failed method=%s path=%s duration_ms=%.2f error=%s",
                method.upper(),
                path,
                (perf_counter() - start) * 1000,
                exc,
            )
            raise RGWAdminError(f"RGW admin request failed: {exc}") from exc
        if resp.status_code == 409 and allow_conflict:
            # Return minimal info; caller should handle fetching details
            return {"conflict": True, "status_code": resp.status_code, "text": resp.text}
        if resp.status_code == 404 and allow_not_found:
            return {"not_found": True, "status_code": resp.status_code, "text": resp.text}
        if resp.status_code in (405, 501) and allow_not_implemented:
            return {"not_implemented": True, "status_code": resp.status_code, "text": resp.text}
        if resp.status_code >= 400:
            logger.warning("RGW admin error %s: %s", resp.status_code, resp.text)
            raise RGWAdminError(f"RGW admin error {resp.status_code}: {resp.text}")
        if not resp.text:
            return {}
        try:
            return resp.json()
        except ValueError:
            raise RGWAdminError(f"Unexpected RGW admin response format: {resp.text}")

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
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                normalized_key = str(key or "").strip()
                if not normalized_key or value is None:
                    continue
                params[normalized_key] = value
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

    def _extract_keys(self, data: Any) -> list[dict]:
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
                nested_keys = self._extract_keys(user_field)
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

    def create_account_user(
        self,
        account_id: str,
        uid: str,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        account_root: bool = False,
    ) -> Dict[str, Any]:
        return self.create_user_with_account_id(
            uid=uid,
            account_id=account_id,
            display_name=display_name or email or uid,
            account_root=account_root,
        )

    def get_account_user(
        self, account_id: str, uid: str, allow_not_found: bool = False
    ) -> Optional[Dict[str, Any]]:
        user = self.get_user(uid, tenant=None, allow_not_found=allow_not_found)
        if not user:
            return None
        account_value = str(user.get("account_id") or "").strip()
        if account_value and account_id and account_value != account_id:
            return None
        return user

    def create_account(
        self,
        account_id: Optional[str] = None,
        account_name: Optional[str] = None,
        email: Optional[str] = None,
        max_users: Optional[int] = None,
        max_buckets: Optional[int] = None,
        max_roles: Optional[int] = None,
        max_groups: Optional[int] = None,
        max_access_keys: Optional[int] = None,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "name": account_name or account_id or "",
            "format": "json",
        }
        if account_id:
            params["id"] = account_id
        if email is not None:
            params["email"] = email
        if max_users is not None:
            params["max_users"] = int(max_users)
        if max_buckets is not None:
            params["max_buckets"] = int(max_buckets)
        if max_roles is not None:
            params["max_roles"] = int(max_roles)
        if max_groups is not None:
            params["max_groups"] = int(max_groups)
        if max_access_keys is not None:
            params["max_access_keys"] = int(max_access_keys)
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                normalized_key = str(key or "").strip()
                if not normalized_key or value is None:
                    continue
                params[normalized_key] = value
        result = self._request(
            "POST",
            "/admin/account",
            params=params,
            data=None,
            allow_conflict=True,
            allow_not_found=True,
        )
        if result.get("not_found"):
            raise RGWAdminError("RGW account API not available or account endpoint returned 404.")
        self._mark_account_api_support(True)
        if result.get("conflict") and account_id:
            existing = self.get_account(account_id, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
        return result

    def update_account(
        self,
        account_id: str,
        *,
        account_name: Optional[str] = None,
        email: Optional[str] = None,
        max_users: Optional[int] = None,
        max_buckets: Optional[int] = None,
        max_roles: Optional[int] = None,
        max_groups: Optional[int] = None,
        max_access_keys: Optional[int] = None,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "id": account_id,
            "format": "json",
        }
        if account_name is not None:
            params["name"] = account_name
        if email is not None:
            params["email"] = email
        if max_users is not None:
            params["max_users"] = int(max_users)
        if max_buckets is not None:
            params["max_buckets"] = int(max_buckets)
        if max_roles is not None:
            params["max_roles"] = int(max_roles)
        if max_groups is not None:
            params["max_groups"] = int(max_groups)
        if max_access_keys is not None:
            params["max_access_keys"] = int(max_access_keys)
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                normalized_key = str(key or "").strip()
                if not normalized_key or value is None:
                    continue
                params[normalized_key] = value
        result = self._request(
            "POST",
            "/admin/account",
            params=params,
            data=None,
            allow_conflict=True,
            allow_not_found=True,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and result.get("not_implemented"):
            self._mark_account_api_support(False)
            return result
        self._mark_account_api_support(True)
        if isinstance(result, dict) and result.get("conflict"):
            existing = self.get_account(account_id, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
        return result

    def delete_account(self, account_id: str) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "id": account_id,
            "format": "json",
        }
        result = self._request(
            "DELETE",
            "/admin/account",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and result.get("not_implemented"):
            self._mark_account_api_support(False)
            return result
        self._mark_account_api_support(True)
        return result

    def set_account_quota(
        self,
        account_id: str,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "account",
        enabled: bool = True,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "quota": "",
            "id": account_id,
            "quota-type": quota_type,
            "format": "json",
        }
        if max_size_bytes is not None:
            params["max-size"] = int(max_size_bytes)
        elif max_size_gb is not None:
            # Ceph expects bytes; convert from GB for UI friendliness
            params["max-size"] = int(max_size_gb * 1024 * 1024 * 1024)
        if max_objects is not None:
            params["max-objects"] = int(max_objects)
        params["enabled"] = "true" if enabled else "false"
        result = self._request(
            "PUT",
            "/admin/account",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )
        if isinstance(result, dict) and result.get("not_implemented"):
            self._mark_account_api_support(False)
            return result
        self._mark_account_api_support(True)
        return result

    def _get_account_once(
        self,
        account_id: str,
        *,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"id": account_id, "format": "json"}
        result = self._request(
            "GET",
            "/admin/account",
            params=params,
            allow_not_found=allow_not_found,
            allow_not_implemented=allow_not_implemented,
        )
        if result.get("not_implemented"):
            self._mark_account_api_support(False)
            return None
        self._mark_account_api_support(True)
        if result.get("not_found"):
            return None
        return result

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ) -> Optional[Dict[str, Any]]:
        if not allow_not_implemented:
            return self._get_account_once(account_id, allow_not_found=allow_not_found)
        if self.account_api_supported is False:
            return None
        if self.account_api_supported is None:
            with self._account_api_support_lock:
                if self.account_api_supported is False:
                    return None
                if self.account_api_supported is None:
                    return self._get_account_once(
                        account_id,
                        allow_not_found=allow_not_found,
                        allow_not_implemented=True,
                    )
        return self._get_account_once(
            account_id,
            allow_not_found=allow_not_found,
            allow_not_implemented=True,
        )

    def get_account_quota(self, account_id: str) -> Tuple[Optional[int], Optional[int]]:
        payload = self.get_account(account_id, allow_not_found=True) or {}
        if payload.get("not_found"):
            return None, None
        return extract_quota_limits(payload, keys=("quota", "account_quota"))

    def list_accounts(self, include_details: bool = True) -> list[Dict[str, Any]]:
        params: Dict[str, Any] = {"format": "json"}
        result = self._request("GET", "/admin/metadata/account", params=params)
        if not isinstance(result, list):
            return []
        accounts: list[Dict[str, Any]] = []
        for account_id_entry in result:
            if not account_id_entry:
                continue
            account_id_value: Optional[str] = None
            account_name_value: Optional[str] = None
            if isinstance(account_id_entry, dict):
                raw_id = account_id_entry.get("account_id") or account_id_entry.get("id")
                if raw_id:
                    account_id_value = str(raw_id).strip()
                raw_name = account_id_entry.get("account_name") or account_id_entry.get("name") or account_id_entry.get("display_name")
                if isinstance(raw_name, str) and raw_name.strip():
                    account_name_value = raw_name.strip()
            else:
                account_id_value = str(account_id_entry).strip()
            if not account_id_value:
                continue
            if not include_details:
                if isinstance(account_id_entry, dict):
                    normalized: Dict[str, Any] = dict(account_id_entry)
                    normalized.setdefault("account_id", account_id_value)
                    normalized.setdefault("id", account_id_value)
                    if account_name_value:
                        normalized.setdefault("account_name", account_name_value)
                    accounts.append(normalized)
                else:
                    base: Dict[str, Any] = {"account_id": account_id_value, "id": account_id_value}
                    if account_name_value:
                        base["account_name"] = account_name_value
                    accounts.append(base)
                continue
            detail = self.get_account(account_id_value, allow_not_found=True)
            if detail and not detail.get("not_found"):
                detail.setdefault("account_id", detail.get("id") or account_id_value)
                detail.setdefault("account_name", detail.get("name") or detail.get("display_name") or account_name_value)
                accounts.append(detail)
            else:
                fallback: Dict[str, Any] = {"account_id": account_id_value, "id": account_id_value}
                if account_name_value:
                    fallback["account_name"] = account_name_value
                accounts.append(fallback)
        return accounts

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
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                normalized_key = str(key or "").strip()
                if not normalized_key or value is None:
                    continue
                params[normalized_key] = value
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
        return self._extract_keys(payload)

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
        result = self._request("GET", "/admin/bucket", params=params, allow_not_found=allow_not_found)
        if result.get("not_found"):
            return None
        return result

    def _format_usage_timestamp(self, value: Any) -> str:
        if isinstance(value, datetime):
            dt = value.astimezone(timezone.utc) if value.tzinfo else value
            return dt.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
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
        return self._request("GET", "/admin/usage", params=params, allow_not_found=True)

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
        return self._request("GET", "/admin/bucket", params=params, timeout=timeout)

    def get_account_stats(self, account_id: str, sync: bool = True) -> Dict[str, Any]:
        base_params: Dict[str, Any] = {"format": "json"}
        if sync:
            base_params["sync-stats"] = "true"

        params = dict(base_params)
        params["id"] = account_id
        return self._request("GET", "/admin/account", params=params, allow_not_found=True)

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
            # RGW Admin Ops expects bucket quota sizes in KiB, not bytes.
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

    def provision_account_keys(self, account_id: str, account_name: str) -> Tuple[Optional[str], Optional[str]]:
        account_info = self.create_account(account_id=account_id, account_name=account_name)
        keys = self._extract_keys(account_info)
        root_uid = f"{account_id}-root"
        if not keys:
            try:
                user_data = self.create_user_with_account_id(
                    uid=root_uid,
                    account_id=account_id,
                    display_name=account_name,
                    account_root=True,
                )
                keys = self._extract_keys(user_data)
            except RGWAdminError:
                keys = []
        if not keys:
            fetched = self.get_user(root_uid, tenant=None, allow_not_found=True)
            keys = self._extract_keys(fetched or {})
        if not keys:
            return None, None
        return keys[0].get("access_key"), keys[0].get("secret_key")

    def create_user_with_account_id(
        self,
        uid: str,
        account_id: str,
        display_name: Optional[str] = None,
        account_root: bool = True,
        email: Optional[str] = None,
        generate_key: bool = True,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "uid": uid,
            "account-id": account_id,
            "display-name": display_name or uid,
            "generate-key": self._to_rgw_bool(bool(generate_key)),
            "format": "json",
        }
        if email is not None:
            params["email"] = email
        if account_root:
            params["account-root"] = "true"
        if isinstance(extra_params, dict):
            for key, value in extra_params.items():
                normalized_key = str(key or "").strip()
                if not normalized_key or value is None:
                    continue
                params[normalized_key] = value
        result = self._request("PUT", "/admin/user", params=params, allow_conflict=True)
        if isinstance(result, dict) and result.get("conflict"):
            # Some RGW versions return 409 even after creating the account-scoped user.
            existing = self.get_user(uid, tenant=None, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
            account_existing = self.get_account_user(account_id, uid, allow_not_found=True)
            if account_existing and not account_existing.get("not_found"):
                return account_existing
        return result

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

    def provision_user_keys(
        self,
        user_email: str,
        tenant: Optional[str] = None,
        account_id: Optional[str] = None,
        account_root: bool = True,
    ) -> Tuple[str, str]:
        uid = self._sanitize_uid(user_email)
        keys: list[Dict[str, Any]] = []
        if account_id:
            try:
                data = self.create_user_with_account_id(
                    uid=uid,
                    account_id=account_id,
                    display_name=user_email,
                    account_root=account_root,
                )
                keys = self._extract_keys(data)
            except RGWAdminError:
                keys = []
            if not keys:
                try:
                    data = self.create_access_key(uid, tenant=account_id)
                    keys = self._extract_keys(data)
                except RGWAdminError:
                    keys = []
            if not keys:
                fetched = self.get_user(uid, tenant=None, allow_not_found=True)
                keys = self._extract_keys(fetched or {})
        else:
            data = self.create_user(uid=uid, display_name=user_email, email=user_email, tenant=tenant)
            keys = self._extract_keys(data)
            if not keys:
                try:
                    data = self.create_access_key(uid, tenant=tenant)
                    keys = self._extract_keys(data)
                except RGWAdminError:
                    keys = []
            if not keys:
                fetched = self.get_user(uid, tenant=tenant, allow_not_found=True)
                keys = self._extract_keys(fetched or {})
        if not keys:
            return secrets.token_hex(16), secrets.token_urlsafe(32)
        return keys[0].get("access_key"), keys[0].get("secret_key")

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
) -> RGWAdminClient:
    return RGWAdminClient(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )
