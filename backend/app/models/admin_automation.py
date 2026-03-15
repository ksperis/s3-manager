# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.db import StorageProvider


ApplyState = Literal["present", "absent"]


class StorageEndpointMatch(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    endpoint_url: Optional[str] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "StorageEndpointMatch":
        if not (self.id or self.name or self.endpoint_url):
            raise ValueError("storage_endpoints.match requires id, name, or endpoint_url")
        return self


class StorageEndpointSpec(BaseModel):
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    verify_tls: Optional[bool] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    set_default: Optional[bool] = None


class StorageEndpointApply(BaseModel):
    state: ApplyState = "present"
    match: StorageEndpointMatch
    spec: Optional[StorageEndpointSpec] = None
    update_secrets: bool = False


class UiUserMatch(BaseModel):
    id: Optional[int] = None
    email: Optional[EmailStr] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "UiUserMatch":
        if not (self.id or self.email):
            raise ValueError("ui_users.match requires id or email")
        return self


class UiUserSpec(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_root: Optional[bool] = None
    s3_user_ids: Optional[list[int]] = None
    s3_connection_ids: Optional[list[int]] = None


class UiUserApply(BaseModel):
    state: ApplyState = "present"
    match: UiUserMatch
    spec: Optional[UiUserSpec] = None
    set_password: bool = False


class S3AccountMatch(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    rgw_account_id: Optional[str] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "S3AccountMatch":
        if not (self.id or self.name or self.rgw_account_id):
            raise ValueError("s3_accounts.match requires id, name, or rgw_account_id")
        return self


class S3AccountSpec(BaseModel):
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


class S3AccountApply(BaseModel):
    state: ApplyState = "present"
    action: Literal["create", "register"] = "create"
    match: S3AccountMatch
    spec: Optional[S3AccountSpec] = None


class S3UserMatch(BaseModel):
    id: Optional[int] = None
    uid: Optional[str] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "S3UserMatch":
        if not (self.id or self.uid):
            raise ValueError("s3_users.match requires id or uid")
        return self


class S3UserSpec(BaseModel):
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


class S3UserApply(BaseModel):
    state: ApplyState = "present"
    action: Literal["create", "register"] = "create"
    match: S3UserMatch
    spec: Optional[S3UserSpec] = None


class S3ConnectionMatch(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "S3ConnectionMatch":
        if not (self.id or self.name):
            raise ValueError("s3_connections.match requires id or name")
        return self


class S3ConnectionSpec(BaseModel):
    name: Optional[str] = None
    visibility: Optional[Literal["private", "shared", "public"]] = None
    storage_endpoint_id: Optional[int] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    provider_hint: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    is_public: Optional[bool] = None
    is_shared: Optional[bool] = None
    access_manager: Optional[bool] = None
    access_browser: Optional[bool] = None
    credential_owner_type: Optional[str] = None
    credential_owner_identifier: Optional[str] = None
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None


class S3ConnectionApply(BaseModel):
    state: ApplyState = "present"
    match: S3ConnectionMatch
    spec: Optional[S3ConnectionSpec] = None
    update_credentials: bool = False


class AccountLinkUserRef(BaseModel):
    id: Optional[int] = None
    email: Optional[EmailStr] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "AccountLinkUserRef":
        if not (self.id or self.email):
            raise ValueError("account_links.user requires id or email")
        return self


class AccountLinkAccountRef(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    rgw_account_id: Optional[str] = None

    @model_validator(mode="after")
    def _ensure_match(self) -> "AccountLinkAccountRef":
        if not (self.id or self.name or self.rgw_account_id):
            raise ValueError("account_links.account requires id, name, or rgw_account_id")
        return self


class AccountLinkApply(BaseModel):
    state: ApplyState = "present"
    user: AccountLinkUserRef
    account: AccountLinkAccountRef
    account_admin: Optional[bool] = None


class AdminAutomationApplyRequest(BaseModel):
    dry_run: bool = False
    continue_on_error: bool = False
    storage_endpoints: list[StorageEndpointApply] = Field(default_factory=list)
    ui_users: list[UiUserApply] = Field(default_factory=list)
    s3_accounts: list[S3AccountApply] = Field(default_factory=list)
    s3_users: list[S3UserApply] = Field(default_factory=list)
    s3_connections: list[S3ConnectionApply] = Field(default_factory=list)
    account_links: list[AccountLinkApply] = Field(default_factory=list)


class AdminAutomationItemResult(BaseModel):
    resource: str
    key: str
    action: Literal["created", "updated", "deleted", "skipped", "failed"]
    changed: bool = False
    id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    diff: Optional[dict[str, dict[str, Any]]] = None
    dry_run: bool = False


class AdminAutomationSummary(BaseModel):
    created: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0
    failed: int = 0


class AdminAutomationApplyResponse(BaseModel):
    changed: bool
    success: bool
    summary: AdminAutomationSummary
    results: list[AdminAutomationItemResult]


class _AdminAutomationSingleRequest(BaseModel):
    dry_run: bool = False
    continue_on_error: bool = False


class StorageEndpointApplyRequest(_AdminAutomationSingleRequest):
    item: StorageEndpointApply


class UiUserApplyRequest(_AdminAutomationSingleRequest):
    item: UiUserApply


class S3AccountApplyRequest(_AdminAutomationSingleRequest):
    item: S3AccountApply


class S3UserApplyRequest(_AdminAutomationSingleRequest):
    item: S3UserApply


class AccountLinkApplyRequest(_AdminAutomationSingleRequest):
    item: AccountLinkApply


class S3ConnectionApplyRequest(_AdminAutomationSingleRequest):
    item: S3ConnectionApply
