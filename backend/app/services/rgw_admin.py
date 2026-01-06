# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import requests
from requests_aws4auth import AWS4Auth

from app.core.config import get_settings

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
    ) -> None:
        resolved_endpoint = endpoint
        if not resolved_endpoint:
            raise RGWAdminError("RGW admin endpoint is not configured")
        self.endpoint = resolved_endpoint.rstrip("/") if resolved_endpoint else ""
        self.region = region or settings.s3_region
        self.access_key = access_key
        self.secret_key = secret_key
        if not self.access_key or not self.secret_key:
            raise RGWAdminError("RGW admin credentials are not configured")
        self.auth = AWS4Auth(self.access_key, self.secret_key, self.region, "s3")
        self.session = requests.Session()

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        allow_conflict: bool = False,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ) -> Dict[str, Any]:
        url = f"{self.endpoint}{path}"
        try:
            headers = None
            if method.upper() in {"POST", "PUT", "DELETE"}:
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                if data:
                    headers = {"Content-Type": "application/x-www-form-urlencoded"}
            logger.debug("RGW request %s %s params=%s data=%s", method, url, params, data)
            resp = self.session.request(
                method,
                url,
                params=params,
                data=data,
                headers=headers,
                auth=self.auth,
                timeout=10,
            )
            logger.debug("RGW response %s %s -> %s", method, url, resp.status_code)
        except requests.RequestException as exc:
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

    def create_user(
        self,
        uid: str,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        tenant: Optional[str] = None,
        caps: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "uid": uid,
            "display-name": display_name or uid,
            "email": email or "",
            "generate-key": "true",
        }
        if tenant:
            params["tenant"] = tenant
        if caps:
            params["caps"] = caps
        return self._request("PUT", "/admin/user", params=params, allow_conflict=True)

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
        status_value = "enabled" if enabled else "suspended"
        params: Dict[str, Any] = {
            "uid": uid,
            "access-key": access_key,
            "key": access_key,
            "key-status": status_value,
            "key-op": "modify",
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
        if response.get("not_implemented"):
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
                status_value = data.get("status") or data.get("key_status") or data.get("state")
                if status_value:
                    entry["status"] = status_value
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
        seen: set[str] = set()
        for entry in prioritized:
            access_value = entry.get("access_key")
            normalized = str(access_value) if access_value is not None else None
            if normalized and normalized in seen:
                continue
            if normalized:
                seen.add(normalized)
            result.append(entry)

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

    def create_account(self, account_id: str, account_name: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "id": account_id,
            "name": account_name or account_id,
            "format": "json",
        }
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
        if result.get("conflict"):
            existing = self.get_account(account_id, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
        return result

    def delete_account(self, account_id: str) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "id": account_id,
            "account-id": account_id,
            "format": "json",
        }
        return self._request(
            "DELETE",
            "/admin/account",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )

    def set_account_quota(
        self,
        account_id: str,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "account",
        enabled: bool = True,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            # Some RGW versions expect different identifiers; provide all
            "quota": "",
            "account-id": account_id,
            "id": account_id,
            "quota-type": quota_type,
            "format": "json",
        }
        if max_size_gb is not None:
            # Ceph expects bytes; convert from GB for UI friendliness
            params["max-size"] = int(max_size_gb * 1024 * 1024 * 1024)
        if max_objects is not None:
            params["max-objects"] = int(max_objects)
        params["enabled"] = "true" if enabled else "false"
        return self._request(
            "PUT",
            "/admin/account",
            params=params,
            data=None,
            allow_not_found=True,
            allow_not_implemented=True,
        )

    def get_account(self, account_id: str, allow_not_found: bool = False) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"id": account_id, "format": "json"}
        result = self._request("GET", "/admin/account", params=params, allow_not_found=allow_not_found)
        if result.get("not_found"):
            return None
        return result

    def list_accounts(self) -> list[Dict[str, Any]]:
        params: Dict[str, Any] = {"format": "json"}
        result = self._request("GET", "/admin/metadata/account", params=params)
        if not isinstance(result, list):
            return []
        accounts: list[Dict[str, Any]] = []
        for account_id in result:
            if not account_id:
                continue
            detail = self.get_account(str(account_id), allow_not_found=True)
            if detail and not detail.get("not_found"):
                detail.setdefault("account_id", detail.get("id") or str(account_id))
                detail.setdefault("account_name", detail.get("name") or detail.get("display_name"))
                accounts.append(detail)
            else:
                accounts.append({"account_id": str(account_id), "id": str(account_id)})
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
        if with_stats:
            params["stats"] = "true"
        return self._request("GET", "/admin/bucket", params=params)

    def get_account_stats(self, account_id: str, sync: bool = True) -> Dict[str, Any]:
        base_params: Dict[str, Any] = {"format": "json"}
        if sync:
            base_params["sync-stats"] = "true"

        params = dict(base_params)
        params["account-id"] = account_id
        return self._request("GET", "/admin/account", params=params, allow_not_found=True)

    def set_bucket_quota(
        self,
        bucket: str,
        tenant: Optional[str] = None,
        uid: Optional[str] = None,
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
        if max_size_gb is not None:
            params["max-size"] = int(max_size_gb * 1024 * 1024 * 1024)
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
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "uid": uid,
            "account-id": account_id,
            "display-name": display_name or uid,
            "generate-key": "true",
            "format": "json",
        }
        if account_root:
            params["account-root"] = "true"
        return self._request("PUT", "/admin/user", params=params, allow_conflict=True)

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
) -> RGWAdminClient:
    return RGWAdminClient(access_key=access_key, secret_key=secret_key, endpoint=endpoint, region=region)
