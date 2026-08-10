# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import S3Account as DBS3Account
from app.db import StorageEndpoint
from app.models.s3_account import (
    AccountGroupLink,
    AccountUserLink,
    S3Account,
    S3AccountSummary,
)
from app.models.tagging import TagDefinitionSummary


def s3_account_from_db(
    account: DBS3Account,
    *,
    public_id: str | None = None,
    quota_max_size_gb: float | None = None,
    quota_max_objects: int | None = None,
    used_bytes: int | None = None,
    used_objects: int | None = None,
    bucket_count: int | None = None,
    rgw_user_count: int | None = None,
    rgw_user_uids: list[str] | None = None,
    rgw_topic_count: int | None = None,
    rgw_topics: list[str] | None = None,
    user_links: list[AccountUserLink],
    group_links: list[AccountGroupLink],
    storage_endpoint: StorageEndpoint,
    storage_endpoint_capabilities: dict[str, bool],
    tags: list[TagDefinitionSummary] | None = None,
) -> S3Account:
    return S3Account(
        id=public_id or str(account.rgw_account_id or account.id),
        db_id=account.id,
        name=account.name,
        rgw_account_id=account.rgw_account_id,
        rgw_user_uid=account.rgw_user_uid,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        email=account.email,
        used_bytes=used_bytes,
        used_objects=used_objects,
        bucket_count=bucket_count,
        rgw_user_count=rgw_user_count,
        rgw_user_uids=rgw_user_uids,
        rgw_topic_count=rgw_topic_count,
        rgw_topics=rgw_topics,
        user_links=user_links,
        group_links=group_links,
        storage_endpoint_id=storage_endpoint.id,
        storage_endpoint_name=storage_endpoint.name,
        storage_endpoint_url=storage_endpoint.endpoint_url,
        storage_endpoint_is_default=bool(storage_endpoint.is_default),
        storage_endpoint_capabilities=storage_endpoint_capabilities,
        allow_bucket_quota_management=bool(account.allow_bucket_quota_management),
        tags=tags or [],
    )


def s3_account_summary_from_db(
    account: DBS3Account,
    *,
    public_id: str | None = None,
    user_links: list[AccountUserLink],
    group_links: list[AccountGroupLink],
    storage_endpoint: StorageEndpoint,
    storage_endpoint_capabilities: dict[str, bool],
    tags: list[TagDefinitionSummary] | None = None,
) -> S3AccountSummary:
    return S3AccountSummary(
        id=public_id or str(account.rgw_account_id or account.id),
        db_id=account.id,
        name=account.name,
        rgw_account_id=account.rgw_account_id,
        user_links=user_links,
        group_links=group_links,
        storage_endpoint_id=storage_endpoint.id,
        storage_endpoint_name=storage_endpoint.name,
        storage_endpoint_url=storage_endpoint.endpoint_url,
        storage_endpoint_is_default=bool(storage_endpoint.is_default),
        storage_endpoint_capabilities=storage_endpoint_capabilities,
        allow_bucket_quota_management=bool(account.allow_bucket_quota_management),
        tags=tags or [],
    )
