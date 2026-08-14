# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3User as DBS3User
from app.db import StorageEndpoint
from app.models.s3_user import (
    S3User,
    S3UserGroupLink,
    S3UserSummary,
    S3UserUserLink,
)
from app.models.tagging import TagDefinitionSummary


def s3_user_from_db(
    s3_user: DBS3User,
    *,
    user_links: list[S3UserUserLink],
    group_links: list[S3UserGroupLink],
    storage_endpoint: StorageEndpoint,
    quota_max_size_gb: float | None = None,
    quota_max_objects: int | None = None,
    bucket_count: int | None = None,
    tags: list[TagDefinitionSummary] | None = None,
) -> S3User:
    return S3User(
        id=s3_user.id,
        name=s3_user.name,
        rgw_user_uid=s3_user.rgw_user_uid,
        email=s3_user.email,
        created_at=s3_user.created_at,
        user_links=user_links,
        group_links=group_links,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        storage_endpoint_id=storage_endpoint.id,
        storage_endpoint_name=storage_endpoint.name,
        storage_endpoint_url=storage_endpoint.endpoint_url,
        bucket_count=bucket_count,
        allow_bucket_quota_management=bool(
            s3_user.allow_bucket_quota_management
        ),
        allow_access_key_management=bool(s3_user.allow_access_key_management),
        allow_managed_private_connection_provisioning=bool(
            s3_user.allow_managed_private_connection_provisioning
        ),
        tags=tags or [],
    )


def s3_user_summary_from_db(
    s3_user: DBS3User,
    *,
    storage_endpoint: StorageEndpoint,
    tags: list[TagDefinitionSummary] | None = None,
) -> S3UserSummary:
    return S3UserSummary(
        id=s3_user.id,
        name=s3_user.name,
        rgw_user_uid=s3_user.rgw_user_uid,
        storage_endpoint_id=storage_endpoint.id,
        storage_endpoint_name=storage_endpoint.name,
        storage_endpoint_url=storage_endpoint.endpoint_url,
        allow_bucket_quota_management=bool(
            s3_user.allow_bucket_quota_management
        ),
        allow_access_key_management=bool(s3_user.allow_access_key_management),
        allow_managed_private_connection_provisioning=bool(
            s3_user.allow_managed_private_connection_provisioning
        ),
        tags=tags or [],
    )
