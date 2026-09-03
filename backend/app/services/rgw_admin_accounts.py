# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from app.services.rgw_admin_transport import RGWAdminError, RGWAdminOperationResponse
from app.utils.quota_stats import extract_quota_limits


class RGWAdminAccountOperations:
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
        self._merge_extra_params(params, extra_params)
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
        self._merge_extra_params(params, extra_params)
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

    def delete_account_operation(self, account_id: str) -> RGWAdminOperationResponse:
        return self._request_operation(
            "DELETE",
            "/admin/account",
            params={"id": account_id, "format": "json"},
        )

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
                raw_name = (
                    account_id_entry.get("account_name")
                    or account_id_entry.get("name")
                    or account_id_entry.get("display_name")
                )
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
                    base: Dict[str, Any] = {
                        "account_id": account_id_value,
                        "id": account_id_value,
                    }
                    if account_name_value:
                        base["account_name"] = account_name_value
                    accounts.append(base)
                continue
            detail = self.get_account(account_id_value, allow_not_found=True)
            if detail and not detail.get("not_found"):
                detail.setdefault("account_id", detail.get("id") or account_id_value)
                detail.setdefault(
                    "account_name",
                    detail.get("name")
                    or detail.get("display_name")
                    or account_name_value,
                )
                accounts.append(detail)
            else:
                fallback: Dict[str, Any] = {
                    "account_id": account_id_value,
                    "id": account_id_value,
                }
                if account_name_value:
                    fallback["account_name"] = account_name_value
                accounts.append(fallback)
        return accounts

    def get_account_stats(
        self,
        account_id: str,
        sync: bool = True,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"format": "json", "id": account_id}
        if sync:
            params["sync-stats"] = "true"
        return self._request(
            "GET",
            "/admin/account",
            params=params,
            allow_not_found=True,
        )

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
        self._merge_extra_params(params, extra_params)
        result = self._request(
            "PUT",
            "/admin/user",
            params=params,
            allow_conflict=True,
        )
        if isinstance(result, dict) and result.get("conflict"):
            existing = self.get_user(uid, tenant=None, allow_not_found=True)
            if existing and not existing.get("not_found"):
                return existing
            account_existing = self.get_account_user(
                account_id,
                uid,
                allow_not_found=True,
            )
            if account_existing and not account_existing.get("not_found"):
                return account_existing
        return result
