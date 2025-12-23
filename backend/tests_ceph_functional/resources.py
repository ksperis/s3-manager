# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .clients import BackendAPIError, BackendSession


def _bool_param(value: bool) -> str:
    return "true" if value else "false"


@dataclass
class ResourceTracker:
    """Tracks resources created during a test session and cleans them up."""

    admin_session: BackendSession
    delete_rgw_by_default: bool = True
    accounts: list[tuple[int, bool]] = field(default_factory=list)
    buckets: list[tuple[int, str]] = field(default_factory=list)
    users: list[int] = field(default_factory=list)

    def track_account(self, account_id: int, *, delete_rgw: bool | None = None) -> None:
        flag = delete_rgw if delete_rgw is not None else self.delete_rgw_by_default
        self.accounts.append((account_id, flag))

    def track_bucket(self, account_id: int, bucket_name: str) -> None:
        self.buckets.append((account_id, bucket_name))

    def track_user(self, user_id: int) -> None:
        self.users.append(user_id)

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
            (aid, flag)
            for aid, flag in self.accounts
            if aid != account_id
        ]

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

        for account_id, delete_rgw in reversed(self.accounts):
            try:
                self.admin_session.delete(
                    f"/admin/accounts/{account_id}",
                    params={"delete_rgw": _bool_param(delete_rgw)},
                    expected_status=(204,),
                )
                if log:
                    log(f"Deleted account {account_id} (delete_rgw={delete_rgw})")
            except BackendAPIError as exc:
                errors.append(f"account {account_id}: {exc}")
        self.accounts.clear()

        return errors


__all__ = ["ResourceTracker"]
