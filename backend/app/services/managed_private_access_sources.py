# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Authorized source and destination resolution for managed private access."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, S3Connection, S3User, StorageProvider, User
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.normalize import normalize_storage_provider
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    resolve_connection_details,
)
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint
from app.utils.storage_endpoint_features import resolve_feature_flags

RemotePrincipalType = Literal["iam_user", "rgw_user"]


@dataclass(frozen=True)
class ManagedPrivateAccessSource:
    kind: str
    identifier: int
    remote_principal_type: RemotePrincipalType
    remote_principal_identifier: str
    iam_username: str | None


@dataclass(frozen=True)
class ManagedPrivateAccessDestination:
    storage_endpoint_id: int | None
    custom_endpoint_config: str | None


def iam_source_reference(account: S3ExecutionTarget) -> tuple[str, int] | None:
    connection_id = getattr(account, "s3_connection_id", None)
    if isinstance(connection_id, int) and connection_id > 0:
        return "connection", connection_id
    if getattr(account, "s3_user_id", None) is not None:
        return None
    account_id = getattr(account, "id", None)
    if isinstance(account_id, int) and account_id > 0:
        return "account", account_id
    return None


class ManagedPrivateAccessSourceResolver:
    def __init__(self, db: Session, access: EffectiveAccessService) -> None:
        self.db = db
        self.access = access

    def resolve_iam_source(
        self,
        user: User,
        account: S3ExecutionTarget,
    ) -> ManagedPrivateAccessSource:
        effective = self.access.resolve_user(user)
        connection_id = getattr(account, "s3_connection_id", None)
        if isinstance(connection_id, int):
            connection = (
                self.db.query(S3Connection)
                .filter(S3Connection.id == connection_id)
                .first()
            )
            if (
                connection is None
                or not self.access.connection_is_allowed(
                    user,
                    connection,
                    workspace="manager",
                    resolved=effective,
                )
                or not s3_connection_can_manage_iam(connection.capabilities_json)
            ):
                raise ManagedPrivateAccessForbidden(
                    "IAM provisioning is not allowed for this connection"
                )
            endpoint = connection.storage_endpoint
            if endpoint is not None and not resolve_feature_flags(endpoint).iam_enabled:
                raise ManagedPrivateAccessForbidden(
                    "IAM is disabled for this endpoint"
                )
            username = self._iam_username(user.id, "connection", connection.id)
            return ManagedPrivateAccessSource(
                "connection",
                connection.id,
                "iam_user",
                username,
                username,
            )

        if getattr(account, "s3_user_id", None) is not None:
            raise ManagedPrivateAccessForbidden(
                "IAM provisioning is not available for an RGW User context"
            )
        account_id = getattr(account, "id", None)
        if not isinstance(account_id, int) or account_id <= 0:
            raise ManagedPrivateAccessForbidden(
                "A persisted RGW Account context is required"
            )
        link = effective.account_link_for(account_id)
        if link is None or not self.access.manager_account_allowed(link):
            raise ManagedPrivateAccessForbidden(
                "Account administrator access is required"
            )
        source_account = (
            self.db.query(S3Account).filter(S3Account.id == account_id).first()
        )
        if source_account is None or source_account.storage_endpoint is None:
            raise ManagedPrivateAccessError(
                "The account has no usable storage endpoint"
            )
        if not resolve_feature_flags(source_account.storage_endpoint).iam_enabled:
            raise ManagedPrivateAccessForbidden(
                "IAM is disabled for this endpoint"
            )
        username = self._iam_username(user.id, "account", account_id)
        return ManagedPrivateAccessSource(
            "account",
            account_id,
            "iam_user",
            username,
            username,
        )

    def resolve_rgw_user_source(
        self,
        user: User,
        account: S3ExecutionTarget,
    ) -> ManagedPrivateAccessSource:
        s3_user_id = getattr(account, "s3_user_id", None)
        if not isinstance(s3_user_id, int) or s3_user_id <= 0:
            raise ManagedPrivateAccessForbidden(
                "An assigned RGW User context is required"
            )
        resolved = self.access.resolve_user(user)
        if not resolved.has_s3_user(s3_user_id):
            raise ManagedPrivateAccessForbidden(
                "The RGW User is not assigned to this user"
            )
        s3_user = self.db.query(S3User).filter(S3User.id == s3_user_id).first()
        if s3_user is None:
            raise ManagedPrivateAccessError("RGW User not found")
        endpoint = s3_user.storage_endpoint
        if (
            not s3_user.allow_managed_private_connection_provisioning
            or endpoint is None
            or normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH
            or not resolve_feature_flags(endpoint).admin_enabled
            or not (endpoint.admin_access_key or "").strip()
            or not (endpoint.admin_secret_key or "").strip()
        ):
            raise ManagedPrivateAccessForbidden(
                "Managed Ceph private access is not allowed for this context"
            )
        return ManagedPrivateAccessSource(
            "s3_user",
            s3_user.id,
            "rgw_user",
            s3_user.rgw_user_uid,
            None,
        )

    def derive_destination(
        self,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccessDestination:
        if source.kind == "account":
            row = (
                self.db.query(S3Account)
                .filter(S3Account.id == source.identifier)
                .first()
            )
            endpoint_id = row.storage_endpoint_id if row is not None else None
            if endpoint_id is None or row is None or row.storage_endpoint is None:
                raise ManagedPrivateAccessError(
                    "The source account has no usable storage endpoint"
                )
            return ManagedPrivateAccessDestination(endpoint_id, None)
        if source.kind == "s3_user":
            row = (
                self.db.query(S3User)
                .filter(S3User.id == source.identifier)
                .first()
            )
            endpoint_id = row.storage_endpoint_id if row is not None else None
            if endpoint_id is None or row is None or row.storage_endpoint is None:
                raise ManagedPrivateAccessError(
                    "The source RGW User has no usable storage endpoint"
                )
            return ManagedPrivateAccessDestination(endpoint_id, None)

        connection = (
            self.db.query(S3Connection)
            .filter(S3Connection.id == source.identifier)
            .first()
        )
        if connection is None:
            raise ManagedPrivateAccessError("Source connection not found")
        if connection.storage_endpoint_id is not None:
            if connection.storage_endpoint is None:
                raise ManagedPrivateAccessError(
                    "The source connection endpoint is unavailable"
                )
            return ManagedPrivateAccessDestination(
                connection.storage_endpoint_id,
                None,
            )
        details = resolve_connection_details(connection)
        try:
            endpoint_url = validate_user_supplied_s3_endpoint(
                (details.endpoint_url or "").strip(),
                field_name="Endpoint URL",
            )
        except ValueError as exc:
            raise ManagedPrivateAccessError(
                sanitized_error_log_detail(exc)
            ) from exc
        if not details.verify_tls:
            raise ManagedPrivateAccessError(
                "Managed private access requires TLS verification"
            )
        return ManagedPrivateAccessDestination(
            None,
            build_custom_endpoint_config(
                endpoint_url,
                details.region,
                details.force_path_style,
                details.verify_tls,
                details.provider,
            ),
        )

    @staticmethod
    def _iam_username(user_id: int, source_kind: str, source_id: int) -> str:
        kind = "acc" if source_kind == "account" else "conn"
        return f"bkr-private-u{user_id}-{kind}{source_id}"
