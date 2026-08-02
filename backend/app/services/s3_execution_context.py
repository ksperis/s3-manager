# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from app.db import S3Account, S3Connection, S3User, StorageEndpoint
from app.models.account_capabilities import AccountCapabilities
from app.utils.s3_connection_endpoint import resolve_connection_endpoint


S3ExecutionContextKind = Literal[
    "account",
    "connection",
    "legacy_user",
    "portal_account",
    "ceph_admin",
    "session",
]


@dataclass(slots=True)
class S3ExecutionContext:
    """Explicit, non-persistent identity used for S3 data-plane execution."""

    context_id: str
    context_kind: S3ExecutionContextKind
    name: str
    access_key: Optional[str]
    secret_key: Optional[str]
    id: Optional[int] = None
    rgw_account_id: Optional[str] = None
    email: Optional[str] = None
    rgw_user_uid: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint: Optional[StorageEndpoint] = None
    session_token_value: Optional[str] = None
    session_endpoint: Optional[str] = None
    session_region: Optional[str] = None
    session_force_path_style: Optional[bool] = None
    session_verify_tls: Optional[bool] = None
    s3_connection_id: Optional[int] = None
    s3_user_id: Optional[int] = None
    ceph_admin_endpoint_id: Optional[int] = None
    source_connection: Optional[S3Connection] = None
    manager_capabilities: AccountCapabilities = field(default_factory=AccountCapabilities)
    allow_manager_bucket_quota: bool = False
    allow_manager_ceph_s3_user_keys: bool = False
    portal_browser_role: Optional[str] = None
    portal_browser_access: Any = None
    portal_allowed_buckets: Optional[set[str]] = None
    portal_storage_spaces: Optional[list[Any]] = None

    @classmethod
    def from_account(
        cls,
        account: S3Account,
        *,
        context_kind: Literal["account", "portal_account"] = "account",
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        manager_capabilities: Optional[AccountCapabilities] = None,
    ) -> S3ExecutionContext:
        return cls(
            context_id=str(account.id),
            context_kind=context_kind,
            id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            email=account.email,
            rgw_user_uid=account.rgw_user_uid,
            access_key=access_key,
            secret_key=secret_key,
            storage_endpoint_id=account.storage_endpoint_id,
            storage_endpoint=account.storage_endpoint,
            manager_capabilities=manager_capabilities or AccountCapabilities(),
            allow_manager_bucket_quota=bool(account.allow_manager_bucket_quota),
        )

    @classmethod
    def from_connection(
        cls,
        connection: S3Connection,
        *,
        manager_capabilities: Optional[AccountCapabilities] = None,
    ) -> S3ExecutionContext:
        endpoint, region, force_path_style, verify_tls = resolve_connection_endpoint(connection)
        return cls(
            context_id=f"conn-{connection.id}",
            context_kind="connection",
            name=connection.name,
            access_key=connection.access_key_id,
            secret_key=connection.secret_access_key,
            storage_endpoint_id=connection.storage_endpoint_id,
            storage_endpoint=connection.storage_endpoint,
            session_token_value=connection.session_token,
            session_endpoint=endpoint,
            session_region=region,
            session_force_path_style=force_path_style,
            session_verify_tls=verify_tls,
            s3_connection_id=connection.id,
            source_connection=connection,
            manager_capabilities=manager_capabilities or AccountCapabilities(),
        )

    @classmethod
    def from_legacy_user(
        cls,
        user: S3User,
        *,
        manager_capabilities: Optional[AccountCapabilities] = None,
    ) -> S3ExecutionContext:
        return cls(
            context_id=f"s3u-{user.id}",
            context_kind="legacy_user",
            name=user.name,
            access_key=user.rgw_access_key,
            secret_key=user.rgw_secret_key,
            email=user.email,
            rgw_user_uid=user.rgw_user_uid,
            storage_endpoint_id=user.storage_endpoint_id,
            storage_endpoint=user.storage_endpoint,
            s3_user_id=user.id,
            manager_capabilities=manager_capabilities or AccountCapabilities(),
            allow_manager_bucket_quota=bool(user.allow_manager_bucket_quota),
            allow_manager_ceph_s3_user_keys=bool(user.allow_manager_ceph_s3_user_keys),
        )

    @classmethod
    def from_ceph_admin_endpoint(
        cls,
        endpoint: StorageEndpoint,
        *,
        access_key: Optional[str],
        secret_key: Optional[str],
        manager_capabilities: Optional[AccountCapabilities] = None,
    ) -> S3ExecutionContext:
        return cls(
            context_id=f"ceph-admin-{endpoint.id}",
            context_kind="ceph_admin",
            name=f"ceph-admin:{endpoint.id}",
            access_key=access_key,
            secret_key=secret_key,
            storage_endpoint_id=endpoint.id,
            storage_endpoint=endpoint,
            ceph_admin_endpoint_id=endpoint.id,
            manager_capabilities=manager_capabilities or AccountCapabilities(),
        )

    def effective_rgw_credentials(self) -> tuple[Optional[str], Optional[str]]:
        return self.access_key, self.secret_key

    def session_token(self) -> Optional[str]:
        return self.session_token_value


S3ExecutionTarget = S3Account | S3ExecutionContext
