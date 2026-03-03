# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from .clients import BackendAPIError, BackendSession


def _bool_param(value: bool) -> str:
    return "true" if value else "false"


class RgwCleanupClient(Protocol):
    def delete_user(self, uid: str, tenant: str | None = None) -> None:
        ...

    def delete_account(self, account_id: str) -> dict[str, Any]:
        ...

    def list_users(self) -> list[dict[str, Any]]:
        ...

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = False) -> dict[str, Any] | None:
        ...


@dataclass
class ResourceTracker:
    """Tracks resources created during a test session and cleans them up."""

    admin_session: BackendSession
    delete_rgw_by_default: bool = True
    rgw_admin_client: RgwCleanupClient | None = None
    accounts: list[tuple[int, bool, str | None]] = field(default_factory=list)
    buckets: list[tuple[int, str]] = field(default_factory=list)
    users: list[int] = field(default_factory=list)
    ceph_admin_users: list[tuple[str, str | None]] = field(default_factory=list)
    ceph_admin_accounts: list[str] = field(default_factory=list)

    def track_account(
        self,
        account_id: int,
        *,
        delete_rgw: bool | None = None,
        rgw_account_id: str | None = None,
    ) -> None:
        flag = delete_rgw if delete_rgw is not None else self.delete_rgw_by_default
        self.accounts.append((account_id, flag, rgw_account_id))

    def track_bucket(self, account_id: int, bucket_name: str) -> None:
        self.buckets.append((account_id, bucket_name))

    def track_user(self, user_id: int) -> None:
        self.users.append(user_id)

    def track_ceph_admin_user(self, uid: str, *, tenant: str | None = None) -> None:
        if not uid:
            return
        self.ceph_admin_users.append((uid, tenant))

    def track_ceph_admin_account(self, account_id: str) -> None:
        if not account_id:
            return
        self.ceph_admin_accounts.append(account_id)

    def discard_bucket(self, account_id: int, bucket_name: str) -> None:
        self.buckets = [
            (aid, name)
            for aid, name in self.buckets
            if not (aid == account_id and name == bucket_name)
        ]

    def discard_user(self, user_id: int) -> None:
        self.users = [uid for uid in self.users if uid != user_id]

    def discard_account(self, account_id: int) -> None:
        self.accounts = [
            (aid, flag, rgw_account_id)
            for aid, flag, rgw_account_id in self.accounts
            if aid != account_id
        ]

    def discard_ceph_admin_user(self, uid: str, *, tenant: str | None = None) -> None:
        self.ceph_admin_users = [
            (tracked_uid, tracked_tenant)
            for tracked_uid, tracked_tenant in self.ceph_admin_users
            if not (tracked_uid == uid and tracked_tenant == tenant)
        ]

    def discard_ceph_admin_account(self, account_id: str) -> None:
        self.ceph_admin_accounts = [tracked_id for tracked_id in self.ceph_admin_accounts if tracked_id != account_id]

    def cleanup(self, log: Callable[[str], None] | None = None) -> list[str]:
        errors: list[str] = []
        for account_id, bucket_name in reversed(self.buckets):
            try:
                self.admin_session.delete(
                    f"/manager/buckets/{bucket_name}",
                    params={"account_id": account_id, "force": "true"},
                )
                if log:
                    log(f"Deleted bucket {bucket_name} (account {account_id})")
            except BackendAPIError as exc:
                payload_text = str(exc.payload).lower() if exc.payload is not None else ""
                if exc.status_code == 403 and "not authorized for this account" in payload_text:
                    # Super-admin tokens can be forbidden on manager-scoped bucket routes.
                    # Account cleanup still handles DB-side teardown.
                    continue
                errors.append(f"bucket {bucket_name}@{account_id}: {exc}")
        self.buckets.clear()

        for user_id in reversed(self.users):
            try:
                self.admin_session.delete(
                    f"/admin/users/{user_id}",
                    expected_status=(204,),
                )
                if log:
                    log(f"Deleted UI user {user_id}")
            except BackendAPIError as exc:
                errors.append(f"user {user_id}: {exc}")
        self.users.clear()

        for account_id, delete_rgw, rgw_account_id in reversed(self.accounts):
            try:
                self.admin_session.delete(
                    f"/admin/accounts/{account_id}",
                    params={"delete_rgw": _bool_param(delete_rgw)},
                    expected_status=(204,),
                )
                if log:
                    log(f"Deleted account {account_id} (delete_rgw={delete_rgw})")
            except BackendAPIError as exc:
                # Some RGW backends deny tenant deletion checks while DB unlink is still valid.
                # Retry with delete_rgw=false to avoid leaking UI-side resources.
                retry_without_rgw = (
                    delete_rgw
                    and exc.status_code in {400, 404}
                    and "cannot delete the rgw tenant" in str(exc.payload).lower()
                )
                if retry_without_rgw:
                    try:
                        self.admin_session.delete(
                            f"/admin/accounts/{account_id}",
                            params={"delete_rgw": "false"},
                            expected_status=(204,),
                        )
                        if log:
                            log(f"Deleted account {account_id} with delete_rgw=false fallback")
                    except BackendAPIError as retry_exc:
                        errors.append(f"account {account_id}: {retry_exc}")
                    else:
                        if self.rgw_admin_client is not None and rgw_account_id:
                            try:
                                self.rgw_admin_client.delete_account(rgw_account_id)
                                if log:
                                    log(f"Deleted RGW account {rgw_account_id} after DB unlink fallback")
                            except Exception as cleanup_exc:  # pragma: no cover - cluster dependent
                                errors.append(f"account {account_id} RGW cleanup failed ({rgw_account_id}): {cleanup_exc}")
                else:
                    errors.append(f"account {account_id}: {exc}")
        self.accounts.clear()

        if self.ceph_admin_users or self.ceph_admin_accounts:
            if self.rgw_admin_client is None:
                errors.append(
                    "ceph-admin resources could not be cleaned up because RGW admin credentials are unavailable"
                )
            else:
                for uid, tenant in reversed(self.ceph_admin_users):
                    try:
                        self.rgw_admin_client.delete_user(uid, tenant=tenant)
                        if log:
                            tenant_suffix = f" (tenant={tenant})" if tenant else ""
                            log(f"Deleted RGW user {uid}{tenant_suffix}")
                    except Exception as exc:  # pragma: no cover - network/cluster dependent
                        errors.append(f"ceph-admin user {uid} (tenant={tenant or '-'}) cleanup failed: {exc}")
                for account_id in reversed(self.ceph_admin_accounts):
                    try:
                        self._cleanup_rgw_account_users(account_id, log=log)
                        self.rgw_admin_client.delete_account(account_id)
                        if log:
                            log(f"Deleted RGW account {account_id}")
                    except Exception as exc:  # pragma: no cover - network/cluster dependent
                        errors.append(f"ceph-admin account {account_id} cleanup failed: {exc}")
        self.ceph_admin_users.clear()
        self.ceph_admin_accounts.clear()

        return errors

    def _cleanup_rgw_account_users(self, account_id: str, log: Callable[[str], None] | None = None) -> None:
        """Best-effort removal of users still bound to an RGW account before account deletion."""

        client = self.rgw_admin_client
        if client is None or not hasattr(client, "list_users") or not hasattr(client, "get_user"):
            return
        try:
            listed = client.list_users()
        except Exception:  # pragma: no cover - cluster dependent
            return

        for entry in listed or []:
            raw_uid = ""
            if isinstance(entry, dict):
                raw_uid = str(entry.get("uid") or entry.get("user") or "").strip()
            else:
                raw_uid = str(entry or "").strip()
            if not raw_uid:
                continue
            tenant: str | None = None
            uid = raw_uid
            if "$" in raw_uid:
                tenant_candidate, uid_candidate = raw_uid.split("$", 1)
                if tenant_candidate and uid_candidate:
                    tenant = tenant_candidate
                    uid = uid_candidate
            try:
                payload = client.get_user(uid, tenant=tenant, allow_not_found=True) or {}
            except Exception:  # pragma: no cover - cluster dependent
                continue
            account_ref = str(payload.get("account_id") or payload.get("account-id") or "").strip()
            if account_ref != account_id:
                continue
            try:
                client.delete_user(uid, tenant=tenant)
                if log:
                    suffix = f" (tenant={tenant})" if tenant else ""
                    log(f"Deleted RGW account user {uid}{suffix} for account {account_id}")
            except Exception:  # pragma: no cover - cluster dependent
                continue


__all__ = ["ResourceTracker"]
