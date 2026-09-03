# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable, Literal
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess, S3Account, S3Connection, S3User, StorageProvider, User
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.models.s3_connection import CredentialOwnerType
from app.core.sensitive_data import sanitize_error_detail, sanitized_error_log_detail
from app.services import app_settings_service
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.services.s3_connection_capabilities_service import refresh_connection_detected_capabilities
from app.services.s3_connections_service import S3ConnectionsService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.s3_users_service import S3UsersService
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import build_custom_endpoint_config, resolve_connection_details
from app.utils.s3_endpoint import resolve_iam_client_options, validate_user_supplied_s3_endpoint
from app.utils.normalize import normalize_storage_provider
from app.utils.storage_endpoint_features import (
    aws_iam_client_options_for_region,
    resolve_feature_flags,
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)
from app.utils.time import utcnow


ACTIVE_STATES = ("provisioning", "active", "deleting", "cleanup_pending")
AMAZON_S3_FULL_ACCESS_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
RemotePrincipalType = Literal["iam_user", "rgw_user"]


def _credential_owner_type_for_principal(
    principal_type: str,
) -> CredentialOwnerType:
    if principal_type == "iam_user":
        return "iam_user"
    if principal_type == "rgw_user":
        return "s3_user"
    raise ManagedPrivateAccessError(f"Unsupported remote principal type: {principal_type}")


class ManagedPrivateAccessError(RuntimeError):
    pass


class ManagedPrivateAccessConflict(ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessForbidden(ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessCleanupPending(ManagedPrivateAccessError):
    def __init__(self, provisioning_id: int, message: str) -> None:
        super().__init__(message)
        self.provisioning_id = provisioning_id


@dataclass(frozen=True)
class _Source:
    kind: str
    identifier: int
    remote_principal_type: RemotePrincipalType
    remote_principal_identifier: str
    iam_username: str | None


@dataclass(frozen=True)
class _Destination:
    storage_endpoint_id: int | None
    custom_endpoint_config: str | None


class ManagedPrivateAccessService:
    """Orchestrate remote credentials and a private connection as a durable saga."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.access = EffectiveAccessService(db)
        self.connections = S3ConnectionsService(db)
        self.audit = AuditService(db)

    def provision_iam(
        self,
        *,
        user: User,
        account: S3ExecutionTarget,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self._ensure_managed_private_connection_provisioning_allowed(user)
        source = self._resolve_iam_source(user, account)
        destination = self._derive_destination(source)
        iam = self._iam_service_for_account(account)
        try:
            self._validate_iam_selections(iam, payload)
        except ManagedPrivateAccessError:
            raise
        except Exception as exc:
            raise ManagedPrivateAccessError("Unable to validate IAM groups and policies") from exc
        existing = self._active_for_source(user.id, source)
        if existing is not None:
            return self._resolve_idempotent_existing(existing, payload)

        provisioning = self._claim(user, source)
        self._record(
            user,
            provisioning,
            "managed_private_access.provision.start",
            status="success",
        )
        try:
            if iam.get_user(source.iam_username or "") is not None:
                self._mark_failed(provisioning, "deterministic_remote_principal_exists")
                raise ManagedPrivateAccessConflict(
                    "The deterministic IAM user already exists and is not linked to a known provisioning"
                )

            iam.create_user(source.iam_username or "", create_key=False)
            provisioning.created_remote_principal = True
            self._checkpoint(provisioning)

            for group_name in payload.groups:
                iam.add_user_to_group(group_name, source.iam_username or "")
                self._append_json_value(provisioning, "iam_groups_json", group_name)
                self._checkpoint(provisioning)
            for policy_arn in payload.managed_policies:
                iam.attach_user_policy(source.iam_username or "", policy_arn)
                self._append_json_value(provisioning, "iam_managed_policies_json", policy_arn)
                self._checkpoint(provisioning)
            for inline in payload.inline_policies:
                iam.put_user_inline_policy(source.iam_username or "", inline.name, inline.document)
                self._append_json_value(provisioning, "iam_inline_policy_names_json", inline.name)
                self._checkpoint(provisioning)

            key = iam.create_access_key(source.iam_username or "")
            if not key.access_key_id or not key.secret_access_key:
                raise ManagedPrivateAccessError("RGW IAM did not return complete access credentials")
            provisioning.access_key_id = key.access_key_id
            provisioning.created_access_key = True
            self._checkpoint(provisioning)

            result = self._create_connection(
                user=user,
                provisioning=provisioning,
                destination=destination,
                connection_name=payload.connection_name,
                access_key_id=key.access_key_id,
                secret_access_key=key.secret_access_key,
                access_browser=payload.access_browser,
                access_manager=payload.access_manager,
            )
            self._record(user, provisioning, "managed_private_access.provision.success")
            return result
        except ManagedPrivateAccessConflict:
            self._record(
                user,
                provisioning,
                "managed_private_access.provision.failure",
                status="failure",
                message="Deterministic IAM principal conflict",
            )
            raise
        except Exception as exc:
            safe_error = str(sanitize_error_detail(str(exc)))
            self.db.rollback()
            failed = self.db.query(ManagedPrivateAccess).filter(ManagedPrivateAccess.id == provisioning.id).first()
            if failed is not None:
                self._record(
                    user,
                    failed,
                    "managed_private_access.provision.failure",
                    status="failure",
                    message=safe_error,
                )
            self._compensate_iam(provisioning.id, iam, failure=safe_error, user=user)
            pending = self.db.query(ManagedPrivateAccess).filter(ManagedPrivateAccess.id == provisioning.id).first()
            if pending is not None and pending.state == "cleanup_pending":
                raise ManagedPrivateAccessCleanupPending(
                    pending.id,
                    "Provisioning failed and remote cleanup requires remediation",
                ) from exc
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def provision_rgw_user(
        self,
        *,
        user: User,
        account: S3ExecutionTarget,
        payload: ManagedRGWUserPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self._ensure_managed_private_connection_provisioning_allowed(user)
        source = self._resolve_rgw_user_source(user, account)
        destination = self._derive_destination(source)
        existing = self._active_for_source(user.id, source)
        if existing is not None:
            return self._resolve_idempotent_existing(existing, payload)

        provisioning = self._claim(user, source)
        self._record(user, provisioning, "managed_private_access.provision.start")
        users = S3UsersService(self.db)
        try:
            key = users.create_access_key_entry(source.identifier)
            provisioning.access_key_id = key.access_key_id
            provisioning.created_access_key = True
            self._checkpoint(provisioning)
            result = self._create_connection(
                user=user,
                provisioning=provisioning,
                destination=destination,
                connection_name=payload.connection_name,
                access_key_id=key.access_key_id,
                secret_access_key=key.secret_access_key,
                access_browser=payload.access_browser,
                access_manager=payload.access_manager,
            )
            self._record(user, provisioning, "managed_private_access.provision.success")
            return result
        except Exception as exc:
            safe_error = str(sanitize_error_detail(str(exc)))
            self.db.rollback()
            failed = self.db.query(ManagedPrivateAccess).filter(ManagedPrivateAccess.id == provisioning.id).first()
            if failed is not None:
                self._record(
                    user,
                    failed,
                    "managed_private_access.provision.failure",
                    status="failure",
                    message=safe_error,
                )
            self._compensate_rgw_user(provisioning.id, failure=safe_error, user=user)
            pending = self.db.query(ManagedPrivateAccess).filter(ManagedPrivateAccess.id == provisioning.id).first()
            if pending is not None and pending.state == "cleanup_pending":
                raise ManagedPrivateAccessCleanupPending(
                    pending.id,
                    "Provisioning failed and remote cleanup requires remediation",
                ) from exc
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def delete_owned_connection(self, *, user: User, connection_id: int) -> bool:
        provisioning = (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
            )
            .first()
        )
        if provisioning is None:
            return False
        connection = provisioning.connection
        if connection is None:
            raise ManagedPrivateAccessConflict("Managed private access connection is already absent")
        connection.is_active = False
        provisioning.state = "deleting"
        provisioning.updated_at = utcnow()
        self.db.commit()
        try:
            self._cleanup_remote(provisioning, user=user)
        except Exception as exc:
            self._set_cleanup_pending(provisioning, sanitize_error_detail(str(exc)), user=user)
            raise ManagedPrivateAccessCleanupPending(
                provisioning.id,
                "Remote cleanup failed; the managed access remains recorded for remediation",
            ) from exc

        self.db.delete(provisioning)
        domain_kind, _owner_user_id = self.connections.tags.resolve_connection_domain(
            connection
        )
        self.db.delete(connection)
        self.db.flush()
        self.connections.tags.cleanup_orphan_definitions(
            domain_kinds=[domain_kind]
        )
        self.db.commit()
        self._record(
            user,
            provisioning,
            "managed_private_access.delete.success",
            connection_id=connection_id,
        )
        return True

    def retry_cleanup(self, *, user: User, connection_id: int) -> None:
        provisioning = (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .first()
        )
        if provisioning is None:
            raise KeyError("Managed private access cleanup not found")
        self.delete_owned_connection(user=user, connection_id=connection_id)

    def retry_provisioning_cleanup(self, *, user: User, provisioning_id: int) -> None:
        """Retry compensation when provisioning failed before a connection existed."""
        provisioning = (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.id == provisioning_id,
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id.is_(None),
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .first()
        )
        if provisioning is None:
            raise KeyError("Managed private access provisioning cleanup not found")
        provisioning.state = "deleting"
        provisioning.updated_at = utcnow()
        self.db.commit()
        try:
            self._cleanup_remote(provisioning, user=user)
        except Exception as exc:
            self._set_cleanup_pending(provisioning, str(sanitize_error_detail(str(exc))), user=user)
            raise ManagedPrivateAccessCleanupPending(
                provisioning.id,
                "Remote cleanup still requires remediation",
            ) from exc

        self.db.delete(provisioning)
        self.db.commit()
        self._record(
            user,
            provisioning,
            "managed_private_access.compensation.retry.success",
        )

    def managed_iam_user(self, source_kind: str, source_id: int, username: str) -> ManagedPrivateAccess | None:
        return (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.source_context_type == source_kind,
                ManagedPrivateAccess.source_context_id == source_id,
                ManagedPrivateAccess.iam_username == username,
                ManagedPrivateAccess.state.in_(ACTIVE_STATES),
            )
            .first()
        )

    def managed_key(self, source_kind: str, source_id: int, access_key_id: str) -> ManagedPrivateAccess | None:
        return (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.source_context_type == source_kind,
                ManagedPrivateAccess.source_context_id == source_id,
                ManagedPrivateAccess.access_key_id == access_key_id,
                ManagedPrivateAccess.state.in_(ACTIVE_STATES),
            )
            .first()
        )

    def managed_resources_for_source(
        self,
        source_kind: str,
        source_id: int,
    ) -> list[ManagedPrivateAccess]:
        return (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.source_context_type == source_kind,
                ManagedPrivateAccess.source_context_id == source_id,
                ManagedPrivateAccess.state.in_(ACTIVE_STATES),
            )
            .all()
        )

    @staticmethod
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

    def managed_provisioning_allowed(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        if not (
            app_settings_service.load_app_settings()
            .general.managed_private_connection_provisioning_enabled
        ):
            return False
        effective = resolved or self.access.resolve_user(user)
        return effective.can_provision_managed_private_connections

    def rgw_user_provisioning_available(
        self,
        user: User,
        account: S3ExecutionTarget,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        try:
            self._ensure_managed_private_connection_provisioning_allowed(
                user,
                resolved=resolved,
            )
            self._resolve_rgw_user_source(user, account)
        except ManagedPrivateAccessError:
            return False
        return True

    def _ensure_managed_private_connection_provisioning_allowed(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> None:
        if not self.managed_provisioning_allowed(user, resolved=resolved):
            raise ManagedPrivateAccessForbidden(
                "Managed private S3 connection provisioning is not allowed for this user"
            )

    def _resolve_iam_source(self, user: User, account: S3ExecutionTarget) -> _Source:
        effective = self.access.resolve_user(user)
        connection_id = getattr(account, "s3_connection_id", None)
        if isinstance(connection_id, int):
            connection = self.db.query(S3Connection).filter(S3Connection.id == connection_id).first()
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
                raise ManagedPrivateAccessForbidden("IAM provisioning is not allowed for this connection")
            endpoint = connection.storage_endpoint
            if endpoint is not None and not resolve_feature_flags(endpoint).iam_enabled:
                raise ManagedPrivateAccessForbidden("IAM is disabled for this endpoint")
            username = self._iam_username(user.id, "connection", connection.id)
            return _Source("connection", connection.id, "iam_user", username, username)

        if getattr(account, "s3_user_id", None) is not None:
            raise ManagedPrivateAccessForbidden("IAM provisioning is not available for an RGW User context")
        account_id = getattr(account, "id", None)
        if not isinstance(account_id, int) or account_id <= 0:
            raise ManagedPrivateAccessForbidden("A persisted RGW Account context is required")
        link = effective.account_link_for(account_id)
        if link is None or not self.access.manager_account_allowed(link):
            raise ManagedPrivateAccessForbidden("Account administrator access is required")
        source_account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if source_account is None or source_account.storage_endpoint is None:
            raise ManagedPrivateAccessError("The account has no usable storage endpoint")
        if not resolve_feature_flags(source_account.storage_endpoint).iam_enabled:
            raise ManagedPrivateAccessForbidden("IAM is disabled for this endpoint")
        username = self._iam_username(user.id, "account", account_id)
        return _Source("account", account_id, "iam_user", username, username)

    def _resolve_rgw_user_source(self, user: User, account: S3ExecutionTarget) -> _Source:
        s3_user_id = getattr(account, "s3_user_id", None)
        if not isinstance(s3_user_id, int) or s3_user_id <= 0:
            raise ManagedPrivateAccessForbidden("An assigned RGW User context is required")
        resolved = self.access.resolve_user(user)
        if not resolved.has_s3_user(s3_user_id):
            raise ManagedPrivateAccessForbidden("The RGW User is not assigned to this user")
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
            raise ManagedPrivateAccessForbidden("Managed Ceph private access is not allowed for this context")
        return _Source(
            "s3_user",
            s3_user.id,
            "rgw_user",
            s3_user.rgw_user_uid,
            None,
        )

    def _derive_destination(self, source: _Source) -> _Destination:
        if source.kind == "account":
            row = self.db.query(S3Account).filter(S3Account.id == source.identifier).first()
            endpoint_id = row.storage_endpoint_id if row is not None else None
            if endpoint_id is None or row is None or row.storage_endpoint is None:
                raise ManagedPrivateAccessError("The source account has no usable storage endpoint")
            return _Destination(endpoint_id, None)
        if source.kind == "s3_user":
            row = self.db.query(S3User).filter(S3User.id == source.identifier).first()
            endpoint_id = row.storage_endpoint_id if row is not None else None
            if endpoint_id is None or row is None or row.storage_endpoint is None:
                raise ManagedPrivateAccessError("The source RGW User has no usable storage endpoint")
            return _Destination(endpoint_id, None)

        connection = self.db.query(S3Connection).filter(S3Connection.id == source.identifier).first()
        if connection is None:
            raise ManagedPrivateAccessError("Source connection not found")
        if connection.storage_endpoint_id is not None:
            if connection.storage_endpoint is None:
                raise ManagedPrivateAccessError("The source connection endpoint is unavailable")
            return _Destination(connection.storage_endpoint_id, None)
        details = resolve_connection_details(connection)
        try:
            endpoint_url = validate_user_supplied_s3_endpoint(
                (details.endpoint_url or "").strip(),
                field_name="Endpoint URL",
            )
        except ValueError as exc:
            raise ManagedPrivateAccessError(sanitized_error_log_detail(exc)) from exc
        if not details.verify_tls:
            raise ManagedPrivateAccessError("Managed private access requires TLS verification")
        return _Destination(
            None,
            build_custom_endpoint_config(
                endpoint_url,
                details.region,
                details.force_path_style,
                details.verify_tls,
                details.provider,
            ),
        )

    def _validate_iam_selections(
        self,
        iam: RGWIAMService,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> None:
        available_groups = {group.name for group in iam.list_groups()}
        invalid_groups = sorted(set(payload.groups) - available_groups)
        if invalid_groups:
            raise ManagedPrivateAccessError(f"Unknown IAM groups: {', '.join(invalid_groups)}")
        available_policies = {AMAZON_S3_FULL_ACCESS_POLICY_ARN} | {
            policy.arn for policy in iam.list_policies()
        }
        invalid_policies = sorted(set(payload.managed_policies) - available_policies)
        if invalid_policies:
            raise ManagedPrivateAccessError(f"Unknown IAM policies: {', '.join(invalid_policies)}")
        inline_names = [inline.name for inline in payload.inline_policies]
        if len(inline_names) != len(set(inline_names)):
            raise ManagedPrivateAccessError("Inline policy names must be unique")

    def _active_for_source(self, user_id: int, source: _Source) -> ManagedPrivateAccess | None:
        return (
            self.db.query(ManagedPrivateAccess)
            .filter(
                ManagedPrivateAccess.owner_user_id == user_id,
                ManagedPrivateAccess.source_context_type == source.kind,
                ManagedPrivateAccess.source_context_id == source.identifier,
                ManagedPrivateAccess.state.in_(ACTIVE_STATES),
            )
            .first()
        )

    def _resolve_idempotent_existing(self, provisioning, payload) -> ManagedPrivateAccessResult:
        connection = provisioning.connection
        if provisioning.state == "active" and connection is not None:
            same_request = (
                connection.name == payload.connection_name
                and bool(connection.access_browser) == bool(payload.access_browser)
                and bool(connection.access_manager) == bool(payload.access_manager)
            )
            if isinstance(payload, ManagedIAMPrivateAccessRequest):
                same_request = same_request and self._json_list(provisioning.iam_groups_json) == payload.groups
                same_request = same_request and self._json_list(provisioning.iam_managed_policies_json) == payload.managed_policies
                same_request = same_request and self._json_list(provisioning.iam_inline_policy_names_json) == [
                    policy.name for policy in payload.inline_policies
                ]
            if same_request:
                return ManagedPrivateAccessResult(
                    provisioning_id=provisioning.id,
                    status="active",
                    connection=self.connections.serialize(connection),
                )
        raise ManagedPrivateAccessConflict(
            "A managed private access already exists or requires cleanup for this execution context"
        )

    def _claim(self, user: User, source: _Source) -> ManagedPrivateAccess:
        row = ManagedPrivateAccess(
            owner_user_id=user.id,
            source_context_type=source.kind,
            source_context_id=source.identifier,
            remote_principal_type=source.remote_principal_type,
            remote_principal_identifier=source.remote_principal_identifier,
            iam_username=source.iam_username,
            state="provisioning",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        self.db.refresh(row)
        return row

    def _create_connection(
        self,
        *,
        user: User,
        provisioning: ManagedPrivateAccess,
        destination: _Destination,
        connection_name: str,
        access_key_id: str,
        secret_access_key: str,
        access_browser: bool,
        access_manager: bool,
    ) -> ManagedPrivateAccessResult:
        connection = S3Connection(
            created_by_user_id=user.id,
            name=connection_name,
            is_shared=False,
            is_active=True,
            access_manager=access_manager,
            access_browser=access_browser,
            server_managed=True,
            credential_owner_type=_credential_owner_type_for_principal(
                provisioning.remote_principal_type
            ),
            credential_owner_identifier=provisioning.remote_principal_identifier,
            storage_endpoint_id=destination.storage_endpoint_id,
            custom_endpoint_config=destination.custom_endpoint_config,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(connection)
        self.db.flush()
        refresh_connection_detected_capabilities(connection)
        provisioning.s3_connection_id = connection.id
        provisioning.state = "active"
        provisioning.cleanup_error = None
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(connection)
        return ManagedPrivateAccessResult(
            provisioning_id=provisioning.id,
            status="active",
            connection=self.connections.serialize(connection),
        )

    def _cleanup_remote(self, provisioning: ManagedPrivateAccess, *, user: User) -> None:
        if provisioning.remote_principal_type == "iam_user":
            iam = self._iam_service_for_source(provisioning, user)
            self._cleanup_iam_resources(provisioning, iam)
        else:
            users = S3UsersService(self.db)
            if provisioning.created_access_key and provisioning.access_key_id:
                users.delete_key(provisioning.source_context_id, provisioning.access_key_id)
                provisioning.created_access_key = False
                self._checkpoint(provisioning)

    def _iam_service_for_source(self, provisioning: ManagedPrivateAccess, user: User) -> RGWIAMService:
        if provisioning.source_context_type == "account":
            link = self.access.resolve_user(user).account_link_for(provisioning.source_context_id)
            if link is None or not self.access.manager_account_allowed(link):
                raise ManagedPrivateAccessForbidden("Account access was revoked")
            account = self.db.query(S3Account).filter(S3Account.id == provisioning.source_context_id).first()
            if account is None:
                raise ManagedPrivateAccessError("Source account not found")
            return self._iam_service_for_account(account)
        if provisioning.source_context_type != "connection":
            raise ManagedPrivateAccessError("Invalid IAM source context")
        connection = self.db.query(S3Connection).filter(S3Connection.id == provisioning.source_context_id).first()
        if connection is None or not self.access.connection_is_allowed(user, connection, workspace="manager"):
            raise ManagedPrivateAccessForbidden("Source connection access was revoked")
        details = resolve_connection_details(connection)
        endpoint = connection.storage_endpoint
        if endpoint is not None:
            iam_endpoint = resolve_iam_endpoint(endpoint)
            iam_region = resolve_iam_signing_region(endpoint)
        elif (details.provider or "").strip().lower() == "aws":
            iam_endpoint, iam_region = aws_iam_client_options_for_region(details.region)
        else:
            iam_endpoint, iam_region = details.endpoint_url, details.region
        return get_iam_service(
            connection.access_key_id,
            connection.secret_access_key,
            endpoint=iam_endpoint,
            region=iam_region,
            verify_tls=details.verify_tls,
        )

    def _cleanup_iam_resources(self, provisioning: ManagedPrivateAccess, iam: RGWIAMService) -> None:
        username = provisioning.iam_username or provisioning.remote_principal_identifier
        errors: list[str] = []

        def attempt(operation, on_success) -> None:
            try:
                operation()
                on_success()
                self._checkpoint(provisioning)
            except Exception as exc:
                errors.append(sanitize_error_detail(str(exc)))

        if provisioning.created_access_key and provisioning.access_key_id:
            attempt(
                lambda: iam.delete_access_key(username, provisioning.access_key_id or ""),
                lambda: setattr(provisioning, "created_access_key", False),
            )
        for name in reversed(self._json_list(provisioning.iam_inline_policy_names_json)):
            attempt(
                lambda name=name: iam.delete_user_inline_policy(username, name),
                lambda name=name: self._remove_json_value(provisioning, "iam_inline_policy_names_json", name),
            )
        for arn in reversed(self._json_list(provisioning.iam_managed_policies_json)):
            attempt(
                lambda arn=arn: iam.detach_user_policy(username, arn),
                lambda arn=arn: self._remove_json_value(provisioning, "iam_managed_policies_json", arn),
            )
        for group in reversed(self._json_list(provisioning.iam_groups_json)):
            attempt(
                lambda group=group: iam.remove_user_from_group(group, username),
                lambda group=group: self._remove_json_value(provisioning, "iam_groups_json", group),
            )
        if provisioning.created_remote_principal:
            attempt(
                lambda: iam.delete_user(username),
                lambda: setattr(provisioning, "created_remote_principal", False),
            )
        if errors:
            raise ManagedPrivateAccessError("; ".join(str(error) for error in errors))

    @staticmethod
    def _iam_service_for_account(account: S3ExecutionTarget) -> RGWIAMService:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise ManagedPrivateAccessError("The source context has no IAM administration credentials")
        endpoint, region, verify_tls = resolve_iam_client_options(account)
        return get_iam_service(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        )

    def _compensate_iam(
        self,
        provisioning_id: int,
        iam: RGWIAMService,
        *,
        failure: str,
        user: User,
    ) -> None:
        self._compensate(
            provisioning_id,
            cleanup=lambda provisioning: self._cleanup_iam_resources(
                provisioning,
                iam,
            ),
            failure=failure,
            user=user,
        )

    def _compensate_rgw_user(self, provisioning_id: int, *, failure: str, user: User) -> None:
        def cleanup(provisioning: ManagedPrivateAccess) -> None:
            if provisioning.created_access_key and provisioning.access_key_id:
                S3UsersService(self.db).delete_key(
                    provisioning.source_context_id,
                    provisioning.access_key_id,
                )

        self._compensate(
            provisioning_id,
            cleanup=cleanup,
            failure=failure,
            user=user,
        )

    def _compensate(
        self,
        provisioning_id: int,
        *,
        cleanup: Callable[[ManagedPrivateAccess], None],
        failure: str,
        user: User,
    ) -> None:
        provisioning = self.db.query(ManagedPrivateAccess).filter(ManagedPrivateAccess.id == provisioning_id).first()
        if provisioning is None:
            return
        try:
            cleanup(provisioning)
        except Exception as cleanup_exc:
            cleanup_error = str(sanitize_error_detail(str(cleanup_exc)))
            self._record(
                user,
                provisioning,
                "managed_private_access.compensation.failure",
                status="failure",
                message=cleanup_error,
            )
            self._set_cleanup_pending(provisioning, cleanup_error, user=user)
            return
        provisioning.state = "failed"
        provisioning.cleanup_error = failure
        provisioning.updated_at = utcnow()
        self.db.commit()
        self._record(user, provisioning, "managed_private_access.compensation.success", status="failure", message=failure)

    def _set_cleanup_pending(self, provisioning, error: str, *, user: User) -> None:
        provisioning.state = "cleanup_pending"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        self.db.commit()
        self._record(
            user,
            provisioning,
            "managed_private_access.cleanup_pending",
            status="failure",
            message=error,
        )

    def _mark_failed(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "failed"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        self.db.commit()

    def _checkpoint(self, provisioning: ManagedPrivateAccess) -> None:
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(provisioning)

    def _record(
        self,
        user: User,
        provisioning: ManagedPrivateAccess,
        action: str,
        *,
        status: str = "success",
        message: str | None = None,
        connection_id: int | None = None,
    ) -> None:
        self.audit.record_action(
            user=user,
            scope="manager",
            action=action,
            entity_type="managed_private_access",
            entity_id=str(provisioning.id),
            status=status,
            message=message,
            metadata={
                "source_context_type": provisioning.source_context_type,
                "source_context_id": provisioning.source_context_id,
                "remote_principal_type": provisioning.remote_principal_type,
                "remote_principal_identifier": provisioning.remote_principal_identifier,
                "iam_username": provisioning.iam_username,
                "access_key_id": mask_access_key_id(provisioning.access_key_id),
                "connection_id": connection_id or provisioning.s3_connection_id,
                "provisioning_state": provisioning.state,
            },
        )

    @staticmethod
    def _iam_username(user_id: int, source_kind: str, source_id: int) -> str:
        kind = "acc" if source_kind == "account" else "conn"
        return f"bkr-private-u{user_id}-{kind}{source_id}"

    @staticmethod
    def _json_list(value: str) -> list[str]:
        parsed = json.loads(value)
        if not isinstance(parsed, list):
            raise ValueError("Managed private access IAM state must be a JSON list")
        if any(not isinstance(item, str) or not item for item in parsed):
            raise ValueError("Managed private access IAM state must contain non-empty strings")
        return parsed

    def _append_json_value(self, provisioning, field_name: str, value: str) -> None:
        values = self._json_list(getattr(provisioning, field_name))
        if value not in values:
            values.append(value)
        setattr(provisioning, field_name, json.dumps(values))

    def _remove_json_value(self, provisioning, field_name: str, value: str) -> None:
        values = [item for item in self._json_list(getattr(provisioning, field_name)) if item != value]
        setattr(provisioning, field_name, json.dumps(values))
