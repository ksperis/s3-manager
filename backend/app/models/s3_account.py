# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, model_validator

from app.models.pagination import PaginatedResponse


class AccountUserLink(BaseModel):
    user_id: int
    manager_root_access: Optional[bool] = None
    portal_role_key: Optional[str] = None


class S3Account(BaseModel):
    id: str
    db_id: Optional[int] = None
    name: str
    rgw_account_id: Optional[str] = None
    rgw_user_uid: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    root_user_email: Optional[str] = None
    root_user_id: Optional[int] = None
    email: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    bucket_count: Optional[int] = None
    rgw_user_count: Optional[int] = None
    rgw_user_uids: Optional[list[str]] = None
    rgw_topic_count: Optional[int] = None
    rgw_topics: Optional[list[str]] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None


class S3AccountCreate(BaseModel):
    name: str
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None


class S3AccountImport(BaseModel):
    rgw_account_id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    storage_endpoint_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_import_inputs(self) -> "S3AccountImport":
        has_rgw_id = bool(self.rgw_account_id)
        has_access = bool(self.access_key)
        has_secret = bool(self.secret_key)
        if has_access != has_secret:
            raise ValueError("Both access_key and secret_key must be provided together")
        has_keys = has_access and has_secret
        if not has_rgw_id and not has_keys:
            raise ValueError("Provide either an rgw_account_id or an access/secret key pair")
        return self


class S3AccountUpdate(BaseModel):
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None


class S3AccountSummary(BaseModel):
    id: str
    db_id: Optional[int] = None
    name: str
    rgw_account_id: Optional[str] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None


class PaginatedS3AccountsResponse(PaginatedResponse):
    items: list[S3Account]
