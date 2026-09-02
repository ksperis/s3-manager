# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, ClassVar, Literal, Optional

from pydantic import EmailStr, Field, model_validator

from app.models.base import ApiModel
from app.db import StorageProvider
from app.models.s3_connection import CredentialOwnerType
from app.models.user import ManagerToolAccess, UiRole
from app.utils.account_roles import (
    ManagerAccountRoleValue,
    PortalAccountRoleValue,
)


ApplyState = Literal["present", "absent"]


def _provided_reference_count(*values: object) -> int:
    return sum(
        value is not None and (not isinstance(value, str) or bool(value))
        for value in values
    )


class _ReferenceSelection(ApiModel):
    _reference_fields: ClassVar[tuple[str, ...]]
    _reference_error: ClassVar[str]
    _require_one_reference: ClassVar[bool] = True

    @model_validator(mode="after")
    def _validate_reference_count(self):
        count = _provided_reference_count(
            *(getattr(self, field) for field in self._reference_fields)
        )
        invalid = count != 1 if self._require_one_reference else count > 1
        if invalid:
            raise ValueError(self._reference_error)
        return self


class StorageEndpointMatch(_ReferenceSelection):
    _reference_fields = ("id", "name", "endpoint_url")
    _reference_error = (
        "storage_endpoints.match requires exactly one of id, name, or endpoint_url"
    )

    id: Optional[int] = None
    name: Optional[str] = None
    endpoint_url: Optional[str] = None


class StorageEndpointSpec(ApiModel):
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    set_default: Optional[bool] = None


class StorageEndpointApply(ApiModel):
    state: ApplyState = "present"
    match: StorageEndpointMatch
    spec: Optional[StorageEndpointSpec] = None
    update_secrets: bool = False


class UiUserMatch(_ReferenceSelection):
    _reference_fields = ("id", "email")
    _reference_error = "ui_users.match requires exactly one of id or email"

    id: Optional[int] = None
    email: Optional[EmailStr] = None


class UiUserSpec(ApiModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[UiRole] = None
    is_active: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    s3_user_ids: Optional[list[int]] = None
    s3_connection_ids: Optional[list[int]] = None


class UiUserApply(ApiModel):
    state: ApplyState = "present"
    match: UiUserMatch
    spec: Optional[UiUserSpec] = None
    set_password: bool = False


class ExternalIdentityMatch(ApiModel):
    provider_type: Literal["oidc", "ldap"]
    provider_id: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=2048)


class ExternalIdentityUserRef(_ReferenceSelection):
    _reference_fields = ("id", "email")
    _reference_error = (
        "external_identities.user requires exactly one of id or email"
    )

    id: Optional[int] = None
    email: Optional[EmailStr] = None


class ExternalIdentitySpec(ApiModel):
    email: Optional[EmailStr] = None
    email_verified: bool = False


class ExternalIdentityApply(ApiModel):
    state: ApplyState = "present"
    match: ExternalIdentityMatch
    user: ExternalIdentityUserRef
    spec: Optional[ExternalIdentitySpec] = None
    restore: bool = False


class S3AccountMatch(_ReferenceSelection):
    _reference_fields = ("id", "name", "rgw_account_id")
    _reference_error = (
        "s3_accounts.match requires exactly one of id, name, or rgw_account_id"
    )

    id: Optional[int] = None
    name: Optional[str] = None
    rgw_account_id: Optional[str] = None


class S3AccountSpec(_ReferenceSelection):
    _reference_fields = (
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
    )
    _reference_error = "s3_accounts.spec accepts only one storage endpoint reference"
    _require_one_reference = False

    name: Optional[str] = None
    email: Optional[str] = None
    rgw_account_id: Optional[str] = None
    root_user_uid: Optional[str] = None
    rgw_access_key: Optional[str] = None
    rgw_secret_key: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None


class S3AccountApply(ApiModel):
    state: ApplyState = "present"
    action: Literal["create", "register"] = "create"
    match: S3AccountMatch
    spec: Optional[S3AccountSpec] = None


class S3UserMatch(_ReferenceSelection):
    _reference_fields = ("id", "uid")
    _reference_error = "s3_users.match requires exactly one of id or uid"

    id: Optional[int] = None
    uid: Optional[str] = None


class S3UserSpec(_ReferenceSelection):
    _reference_fields = (
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
    )
    _reference_error = "s3_users.spec accepts only one storage endpoint reference"
    _require_one_reference = False

    name: Optional[str] = None
    uid: Optional[str] = None
    email: Optional[str] = None
    rgw_access_key: Optional[str] = None
    rgw_secret_key: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    user_ids: Optional[list[int]] = None


class S3UserApply(ApiModel):
    state: ApplyState = "present"
    action: Literal["create", "register"] = "create"
    match: S3UserMatch
    spec: Optional[S3UserSpec] = None


class S3ConnectionMatch(_ReferenceSelection):
    _reference_fields = ("id", "name")
    _reference_error = "s3_connections.match requires exactly one of id or name"

    id: Optional[int] = None
    name: Optional[str] = None


class S3ConnectionSpec(_ReferenceSelection):
    _reference_fields = ("storage_endpoint_id", "endpoint_url")
    _reference_error = "s3_connections.spec accepts only one endpoint reference"
    _require_one_reference = False

    name: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    provider_hint: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    remediation_action: Optional[Literal["activate_manager"]] = None
    credential_owner_type: Optional[CredentialOwnerType] = None
    credential_owner_identifier: Optional[str] = None
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None


class S3ConnectionApply(ApiModel):
    state: ApplyState = "present"
    match: S3ConnectionMatch
    spec: Optional[S3ConnectionSpec] = None
    update_credentials: bool = False


class AccountLinkUserRef(_ReferenceSelection):
    _reference_fields = ("id", "email")
    _reference_error = "account_links.user requires exactly one of id or email"

    id: Optional[int] = None
    email: Optional[EmailStr] = None


class AccountLinkAccountRef(_ReferenceSelection):
    _reference_fields = ("id", "name", "rgw_account_id")
    _reference_error = (
        "account_links.account requires exactly one of id, name, or rgw_account_id"
    )

    id: Optional[int] = None
    name: Optional[str] = None
    rgw_account_id: Optional[str] = None


class AccountLinkApply(ApiModel):
    state: ApplyState = "present"
    user: AccountLinkUserRef
    account: AccountLinkAccountRef
    manager_role: Optional[ManagerAccountRoleValue]
    portal_role: Optional[PortalAccountRoleValue]

    @model_validator(mode="after")
    def _validate_roles_for_state(self) -> "AccountLinkApply":
        if self.state == "present":
            if self.manager_role is None and self.portal_role is None:
                raise ValueError("account_links requires at least one account role")
        elif self.manager_role is not None or self.portal_role is not None:
            raise ValueError(
                "absent account_links require null manager_role and portal_role"
            )
        return self


class AdminAutomationApplyRequest(ApiModel):
    dry_run: bool = False
    continue_on_error: bool = False
    storage_endpoints: list[StorageEndpointApply] = Field(default_factory=list)
    ui_users: list[UiUserApply] = Field(default_factory=list)
    external_identities: list[ExternalIdentityApply] = Field(default_factory=list)
    s3_accounts: list[S3AccountApply] = Field(default_factory=list)
    s3_users: list[S3UserApply] = Field(default_factory=list)
    s3_connections: list[S3ConnectionApply] = Field(default_factory=list)
    account_links: list[AccountLinkApply] = Field(default_factory=list)


class AdminAutomationItemResult(ApiModel):
    resource: str
    key: str
    action: Literal["created", "updated", "deleted", "skipped", "failed"]
    changed: bool = False
    id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    diff: Optional[dict[str, dict[str, Any]]] = None
    dry_run: bool = False


class AdminAutomationSummary(ApiModel):
    created: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0
    failed: int = 0


class AdminAutomationApplyResponse(ApiModel):
    changed: bool
    success: bool
    summary: AdminAutomationSummary
    results: list[AdminAutomationItemResult]
