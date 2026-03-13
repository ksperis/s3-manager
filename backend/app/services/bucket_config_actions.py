# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from fastapi import HTTPException, status

from app.db import S3Account
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclUpdate,
    BucketCorsUpdate,
    BucketCreate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.services.bucket_listing_shared import parse_includes
from app.services.buckets_service import BucketsService
from app.services.s3_client import BucketNotEmptyError

_T = TypeVar("_T")


def _map_runtime_error(fn: Callable[[], _T]) -> _T:
    try:
        return fn()
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


def _map_value_and_runtime_errors(fn: Callable[[], _T]) -> _T:
    try:
        return fn()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


def list_bucket_configs(
    *,
    service: BucketsService,
    account: S3Account,
    include: list[str],
    with_stats: bool,
) -> list[Bucket]:
    include_set = parse_includes(include)
    return _map_runtime_error(lambda: service.list_buckets(account, include=include_set, with_stats=with_stats))


def get_bucket_config_stats(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    with_stats: bool,
) -> Bucket:
    return _map_runtime_error(lambda: service.get_bucket_stats(bucket_name, account, with_stats=with_stats))


def create_bucket_config(
    *,
    service: BucketsService,
    account: S3Account,
    payload: BucketCreate,
) -> tuple[dict[str, Any], dict[str, Any]]:
    versioning = payload.versioning if payload.versioning is not None else False
    location_constraint = payload.location_constraint
    _map_runtime_error(
        lambda: service.create_bucket(
            payload.name,
            account,
            versioning=versioning,
            location_constraint=location_constraint,
        )
    )
    response = {
        "message": f"Bucket '{payload.name}' created",
        "name": payload.name,
        "versioning": versioning,
        "location_constraint": location_constraint,
    }
    audit_metadata: dict[str, Any] = {"versioning": versioning}
    if location_constraint:
        audit_metadata["location_constraint"] = location_constraint
    return response, audit_metadata


def delete_bucket_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    force: bool = False,
    not_empty_detail: str | None = None,
) -> tuple[dict[str, str], dict[str, Any]]:
    try:
        service.delete_bucket(bucket_name, account, force=force)
    except BucketNotEmptyError as exc:
        detail = not_empty_detail if isinstance(not_empty_detail, str) and not_empty_detail.strip() else str(exc)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
    return {"message": f"Bucket '{bucket_name}' deleted"}, {"force": force}


def update_bucket_quota_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketQuotaUpdate,
) -> tuple[dict[str, str], dict[str, Any]]:
    _map_value_and_runtime_errors(lambda: service.set_bucket_quota(bucket_name, account, payload))
    return {"message": "Bucket quota updated"}, payload.model_dump(exclude_none=True)


def get_bucket_properties_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketProperties:
    return _map_runtime_error(lambda: service.get_bucket_properties(bucket_name, account))


def update_bucket_versioning_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketVersioningUpdate,
) -> tuple[dict[str, Any], dict[str, Any]]:
    _map_runtime_error(lambda: service.set_versioning(bucket_name, account, enabled=payload.enabled))
    return {
        "message": f"Versioning updated for {bucket_name}",
        "enabled": payload.enabled,
    }, {"enabled": payload.enabled}


def get_bucket_object_lock_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketObjectLock:
    return _map_runtime_error(lambda: service.get_object_lock(bucket_name, account))


def put_bucket_object_lock_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketObjectLockUpdate,
) -> tuple[BucketObjectLock, dict[str, Any]]:
    result = _map_value_and_runtime_errors(lambda: service.set_object_lock(bucket_name, account, payload))
    return result, payload.model_dump(exclude_none=True)


def get_bucket_encryption_config(
    *, service: BucketsService, account: S3Account, bucket_name: str
) -> BucketEncryptionConfiguration:
    return _map_runtime_error(lambda: service.get_bucket_encryption(bucket_name, account))


def put_bucket_encryption_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
) -> tuple[BucketEncryptionConfiguration, dict[str, Any]]:
    result = _map_runtime_error(lambda: service.set_bucket_encryption(bucket_name, account, payload.rules))
    return result, {"rules_count": len(payload.rules or [])}


def delete_bucket_encryption_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_encryption(bucket_name, account))


def get_bucket_policy_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketPolicyOut:
    policy = _map_runtime_error(lambda: service.get_policy(bucket_name, account))
    return BucketPolicyOut(policy=policy)


def put_bucket_policy_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketPolicyIn,
) -> tuple[BucketPolicyOut, dict[str, Any]]:
    _map_runtime_error(lambda: service.put_policy(bucket_name, account, policy=payload.policy))
    return BucketPolicyOut(policy=payload.policy), {"policy_length": len(payload.policy or "")}


def delete_bucket_policy_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_policy(bucket_name, account))


def get_bucket_acl_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketAcl:
    return _map_runtime_error(lambda: service.get_bucket_acl(bucket_name, account))


def put_bucket_acl_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketAclUpdate,
) -> tuple[BucketAcl, dict[str, Any]]:
    result = _map_runtime_error(lambda: service.set_bucket_acl(bucket_name, account, payload))
    return result, {"acl": payload.acl}


def get_bucket_public_access_block_config(
    *, service: BucketsService, account: S3Account, bucket_name: str
) -> BucketPublicAccessBlock:
    return _map_runtime_error(lambda: service.get_public_access_block(bucket_name, account))


def put_bucket_public_access_block_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketPublicAccessBlock,
) -> tuple[BucketPublicAccessBlock, dict[str, Any]]:
    result = _map_runtime_error(lambda: service.set_public_access_block(bucket_name, account, payload))
    return result, payload.model_dump(exclude_none=True)


def get_bucket_lifecycle_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketLifecycleConfig:
    return _map_runtime_error(lambda: service.get_lifecycle(bucket_name, account))


def put_bucket_lifecycle_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketLifecycleConfig,
) -> tuple[BucketLifecycleConfig, dict[str, Any]]:
    result = _map_runtime_error(lambda: service.set_lifecycle(bucket_name, account, rules=payload.rules))
    return result, {"rules_count": len(payload.rules or [])}


def delete_bucket_lifecycle_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_lifecycle(bucket_name, account))


def get_bucket_cors_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> dict[str, Any]:
    cors = _map_runtime_error(lambda: service.get_bucket_properties(bucket_name, account).cors_rules)
    return {"rules": cors or []}


def put_bucket_cors_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketCorsUpdate,
) -> tuple[dict[str, Any], dict[str, Any]]:
    _map_runtime_error(lambda: service.set_cors(bucket_name, account, rules=payload.rules))
    return {"rules": payload.rules}, {"rules_count": len(payload.rules or [])}


def delete_bucket_cors_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_cors(bucket_name, account))


def get_bucket_notifications_config(
    *, service: BucketsService, account: S3Account, bucket_name: str
) -> BucketNotificationConfiguration:
    return _map_runtime_error(lambda: service.get_bucket_notifications(bucket_name, account))


def put_bucket_notifications_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketNotificationConfiguration,
) -> tuple[BucketNotificationConfiguration, dict[str, Any]]:
    configuration = payload.configuration or {}
    result = _map_runtime_error(lambda: service.set_bucket_notifications(bucket_name, account, configuration))
    return result, {"keys": list(configuration.keys())}


def delete_bucket_notifications_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_notifications(bucket_name, account))


def get_bucket_replication_config(
    *, service: BucketsService, account: S3Account, bucket_name: str
) -> BucketReplicationConfiguration:
    return _map_runtime_error(lambda: service.get_bucket_replication(bucket_name, account))


def put_bucket_replication_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketReplicationConfiguration,
) -> tuple[BucketReplicationConfiguration, dict[str, Any]]:
    result = _map_value_and_runtime_errors(lambda: service.set_bucket_replication(bucket_name, account, payload))
    configuration = payload.configuration or {}
    rules = configuration.get("Rules")
    rules_count = len(rules) if isinstance(rules, list) else 0
    return result, {"rules_count": rules_count}


def delete_bucket_replication_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_replication(bucket_name, account))


def get_bucket_logging_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketLoggingConfiguration:
    return _map_runtime_error(lambda: service.get_bucket_logging(bucket_name, account))


def put_bucket_logging_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketLoggingConfiguration,
) -> tuple[BucketLoggingConfiguration, dict[str, Any]]:
    result = _map_value_and_runtime_errors(lambda: service.set_bucket_logging(bucket_name, account, payload))
    return result, payload.model_dump(exclude_none=True)


def delete_bucket_logging_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_logging(bucket_name, account))


def get_bucket_website_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> BucketWebsiteConfiguration:
    return _map_runtime_error(lambda: service.get_bucket_website(bucket_name, account))


def put_bucket_website_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
) -> tuple[BucketWebsiteConfiguration, dict[str, Any]]:
    result = _map_value_and_runtime_errors(lambda: service.set_bucket_website(bucket_name, account, payload))
    return result, payload.model_dump(exclude_none=True)


def delete_bucket_website_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_website(bucket_name, account))


def get_bucket_tags_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> dict[str, Any]:
    tags = _map_runtime_error(lambda: service.get_bucket_tags(bucket_name, account))
    return {"tags": [tag.model_dump() for tag in tags]}


def put_bucket_tags_config(
    *,
    service: BucketsService,
    account: S3Account,
    bucket_name: str,
    payload: BucketTagsUpdate,
) -> tuple[dict[str, Any], dict[str, Any]]:
    tags = [{"key": tag.key, "value": tag.value} for tag in payload.tags]
    _map_runtime_error(lambda: service.set_bucket_tags(bucket_name, account, tags=tags))
    return {"tags": payload.tags}, {"tags": tags, "count": len(payload.tags or [])}


def delete_bucket_tags_config(*, service: BucketsService, account: S3Account, bucket_name: str) -> None:
    _map_runtime_error(lambda: service.delete_bucket_tags(bucket_name, account))
