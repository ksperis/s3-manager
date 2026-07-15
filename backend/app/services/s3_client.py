# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field

import boto3
from botocore.exceptions import BotoCoreError, ClientError, ParamValidationError
from botocore.parsers import ResponseParserError
from typing import Iterable, Callable, Any, Optional
import logging
from time import perf_counter

from app.core.config import get_settings
from app.services.aws_client_config import StorageRequestProfile, build_aws_config

settings = get_settings()
logger = logging.getLogger(__name__)


class BucketNotEmptyError(RuntimeError):
    """Raised when attempting to delete a non-empty bucket without force."""


@dataclass(frozen=True)
class BucketContentPurgeFailure:
    stage: str
    message: str
    key: str | None = None
    version_id: str | None = None
    count: int = 0


@dataclass(frozen=True)
class BucketContentPurgeProgress:
    bucket_name: str
    stage: str
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    message: str | None = None


@dataclass(frozen=True)
class BucketContentPurgeResult:
    bucket_name: str
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    missing_bucket: bool = False
    failures_sample: list[BucketContentPurgeFailure] = field(default_factory=list)


@dataclass(frozen=True)
class BucketContentCountResult:
    bucket_name: str
    listed_objects: int = 0
    listed_versions: int = 0
    limit: int = 0
    exceeded_limit: bool = False
    missing_bucket: bool = False


class BucketContentPurgeCancelled(RuntimeError):
    pass


def get_s3_client(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
    user_agent_extra: Optional[str] = None,
    request_profile: StorageRequestProfile = "interactive",
):
    if not endpoint:
        raise RuntimeError("S3 endpoint is not configured")
    s3_config = None
    if force_path_style:
        s3_config = {"addressing_style": "path"}
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key or settings.seed_s3_access_key,
        aws_secret_access_key=secret_key or settings.seed_s3_secret_key,
        aws_session_token=session_token,
        region_name=region or settings.seed_s3_region,
        verify=verify_tls,
        config=build_aws_config(
            request_profile=request_profile,
            s3=s3_config,
            user_agent_extra=user_agent_extra,
        ),
    )
    return LoggedS3Client(client)


class LoggedS3Client:
    def __init__(self, client: Any) -> None:
        self._client = client

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._client, name)
        if not callable(attr):
            return attr

        def wrapper(*args: Any, **kwargs: Any):
            endpoint = getattr(getattr(self._client, "_endpoint", None), "host", "unknown")
            start = perf_counter()
            try:
                result = attr(*args, **kwargs)
            except Exception as exc:
                duration_ms = (perf_counter() - start) * 1000
                logger.warning(
                    "S3 API call failed method=%s endpoint=%s duration_ms=%.2f error=%s",
                    name,
                    endpoint,
                    duration_ms,
                    exc,
                )
                raise
            duration_ms = (perf_counter() - start) * 1000
            logger.debug(
                "S3 API call method=%s endpoint=%s duration_ms=%.2f status=ok",
                name,
                endpoint,
                duration_ms,
            )
            return result

        return wrapper


def _normalize_public_access_block_config(config: Optional[dict]) -> dict:
    normalized = {
        "BlockPublicAcls": False,
        "IgnorePublicAcls": False,
        "BlockPublicPolicy": False,
        "RestrictPublicBuckets": False,
    }
    if not config:
        return normalized
    for key in normalized:
        if key in config and config[key] is not None:
            normalized[key] = bool(config[key])
    return normalized


def list_buckets(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        response = client.list_buckets()
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to list buckets: {exc}") from exc
    buckets = response.get("Buckets", [])
    logger.debug("Listed %s buckets", len(buckets))
    return [{"name": b.get("Name"), "creation_date": b.get("CreationDate")} for b in buckets]


def create_bucket(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
    location_constraint: Optional[str] = None,
    object_lock_enabled: bool = False,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        effective_location = (location_constraint or "").strip() or (region or settings.seed_s3_region)
        create_kwargs: dict[str, Any] = {"Bucket": bucket_name}
        if effective_location and effective_location != "us-east-1":
            create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": effective_location}
        if object_lock_enabled:
            create_kwargs["ObjectLockEnabledForBucket"] = True
        client.create_bucket(**create_kwargs)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to create bucket '{bucket_name}': {exc}") from exc
    logger.debug("Created bucket %s", bucket_name)


def set_bucket_versioning(
    bucket_name: str,
    enabled: bool = True,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    status = "Enabled" if enabled else "Suspended"
    try:
        client.put_bucket_versioning(Bucket=bucket_name, VersioningConfiguration={"Status": status})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update versioning for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Set versioning for bucket %s to %s", bucket_name, status)


def set_bucket_public_access_block(
    bucket_name: str,
    block: bool = True,
    configuration: Optional[dict] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    block_state = bool(configuration) if configuration is not None else block
    try:
        if configuration is None:
            if not block:
                configuration = {}
            else:
                # Ceph RGW rejects PutObject when BlockPublicAcls is enabled, so only enforce policy-level blocks by default.
                configuration = {
                    "BlockPublicAcls": False,
                    "IgnorePublicAcls": False,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
        if configuration:
            # Ceph RGW rejects PutObject when BlockPublicAcls is enabled, so only enforce policy-level blocks.
            client.put_public_access_block(
                Bucket=bucket_name,
                PublicAccessBlockConfiguration=_normalize_public_access_block_config(configuration),
            )
        else:
            client.delete_public_access_block(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if not block and code.lower() in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
            return
        raise RuntimeError(f"Unable to update public access block for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to update public access block for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Set public access block for bucket %s to %s", bucket_name, block_state)


def get_bucket_public_access_block(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_public_access_block(Bucket=bucket_name)
        config = resp.get("PublicAccessBlockConfiguration") or {}
        if not config:
            return None
        normalized = _normalize_public_access_block_config(config)
        return {
            "block_public_acls": normalized["BlockPublicAcls"],
            "ignore_public_acls": normalized["IgnorePublicAcls"],
            "block_public_policy": normalized["BlockPublicPolicy"],
            "restrict_public_buckets": normalized["RestrictPublicBuckets"],
        }
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
            return None
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc


def get_bucket_versioning(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[str]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_versioning(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch versioning for bucket '{bucket_name}': {exc}") from exc
    return resp.get("Status")


def get_bucket_object_lock(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_object_lock_configuration(Bucket=bucket_name)
        config = resp.get("ObjectLockConfiguration") or {}
        if not config:
            return None
        rule = config.get("Rule") or {}
        retention = rule.get("DefaultRetention") or {}
        enabled_raw = config.get("ObjectLockEnabled")
        enabled = str(enabled_raw).lower() == "enabled" if enabled_raw is not None else None
        return {
            "enabled": enabled,
            "mode": retention.get("Mode"),
            "days": retention.get("Days"),
            "years": retention.get("Years"),
        }
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"objectlockconfigurationnotfounderror", "invalidbucketstate", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch object lock config for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch object lock config for bucket '{bucket_name}': {exc}") from exc


def get_bucket_acl(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> dict:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        return client.get_bucket_acl(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch ACL for bucket '{bucket_name}': {exc}") from exc


def put_bucket_acl(
    bucket_name: str,
    acl: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_acl(Bucket=bucket_name, ACL=acl)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update ACL for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated ACL for bucket %s", bucket_name)


def put_bucket_tags(
    bucket_name: str,
    tags: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    tag_set = [
        {"Key": str(tag.get("key") or ""), "Value": str(tag.get("value") or "")}
        for tag in tags
        if str(tag.get("key") or "").strip()
    ]
    try:
        if tag_set:
            client.put_bucket_tagging(Bucket=bucket_name, Tagging={"TagSet": tag_set})
        else:
            client.delete_bucket_tagging(Bucket=bucket_name)
    except ClientError as exc:
        raise RuntimeError(f"Unable to update bucket tags for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to update bucket tags for '{bucket_name}': {exc}") from exc


def get_bucket_tags(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_tagging(Bucket=bucket_name)
        tag_set = resp.get("TagSet", []) or []
        if not isinstance(tag_set, list):
            return []
        tags: list[dict] = []
        for tag in tag_set:
            if not isinstance(tag, dict):
                continue
            key = str(tag.get("Key") or "").strip()
            if not key:
                continue
            tags.append({"key": key, "value": str(tag.get("Value") or "")})
        return tags
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchtags", "nosuchtagset", "nosuchtagseterror", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch bucket tags for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket tags for '{bucket_name}': {exc}") from exc


def delete_bucket_tags(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_tagging(Bucket=bucket_name)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to delete bucket tags for '{bucket_name}': {exc}") from exc


def get_bucket_logging(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_logging(Bucket=bucket_name)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch bucket logging for '{bucket_name}': {exc}") from exc
    config = resp.get("LoggingEnabled") or {}
    if not config:
        return None
    return {
        "target_bucket": config.get("TargetBucket"),
        "target_prefix": config.get("TargetPrefix"),
        "target_grants": config.get("TargetGrants"),
    }


def put_bucket_logging(
    bucket_name: str,
    logging_config: Optional[dict] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    status: dict = {}
    if logging_config:
        status["LoggingEnabled"] = logging_config
    try:
        client.put_bucket_logging(Bucket=bucket_name, BucketLoggingStatus=status)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update bucket logging for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket logging for %s", bucket_name)


def get_bucket_notifications(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> dict:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_notification_configuration(Bucket=bucket_name)
        resp.pop("ResponseMetadata", None)
        return resp or {}
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to fetch bucket notifications for '{bucket_name}': {exc}") from exc


def put_bucket_notifications(
    bucket_name: str,
    config: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_notification_configuration(
            Bucket=bucket_name,
            NotificationConfiguration=config or {},
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update bucket notifications for '{bucket_name}': {exc}") from exc
    logger.debug("Updated notifications for bucket %s", bucket_name)


def get_bucket_replication(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> dict:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_replication(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"}:
            return {}
        raise RuntimeError(f"Unable to fetch bucket replication for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket replication for '{bucket_name}': {exc}") from exc
    config = resp.get("ReplicationConfiguration") or {}
    return config if isinstance(config, dict) else {}


def put_bucket_replication(
    bucket_name: str,
    configuration: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_replication(
            Bucket=bucket_name,
            ReplicationConfiguration=configuration,
        )
    except ParamValidationError as exc:
        raise ValueError(f"Invalid bucket replication configuration: {exc}") from exc
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket replication for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket replication for %s", bucket_name)


def delete_bucket_replication(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_replication(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket replication for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket replication for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket replication for %s", bucket_name)


def put_bucket_object_lock(
    bucket_name: str,
    enabled: Optional[bool] = None,
    mode: Optional[str] = None,
    days: Optional[int] = None,
    years: Optional[int] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    config: dict = {}
    if enabled is not None:
        config["ObjectLockEnabled"] = "Enabled" if enabled else "Disabled"
    retention: dict = {}
    if mode:
        retention["Mode"] = mode.upper()
    if days is not None:
        retention["Days"] = int(days)
    if years is not None:
        retention["Years"] = int(years)
    if retention:
        config["Rule"] = {"DefaultRetention": retention}
    if not config:
        raise RuntimeError("No object lock configuration supplied.")
    try:
        client.put_object_lock_configuration(Bucket=bucket_name, ObjectLockConfiguration=config)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set object lock config for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated object lock configuration for bucket %s", bucket_name)


def get_bucket_lifecycle(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_lifecycle_configuration(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch lifecycle for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch lifecycle for bucket '{bucket_name}': {exc}") from exc
    return resp.get("Rules", []) or []


def put_bucket_lifecycle(
    bucket_name: str,
    rules: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_lifecycle_configuration(Bucket=bucket_name, LifecycleConfiguration={"Rules": rules})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set lifecycle for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Updated lifecycle for bucket %s", bucket_name)


def delete_bucket_lifecycle(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_lifecycle(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted lifecycle for bucket %s", bucket_name)


def get_bucket_encryption(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_encryption(Bucket=bucket_name)
        config = resp.get("ServerSideEncryptionConfiguration") or {}
        return config.get("Rules", []) or []
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"serversideencryptionconfigurationnotfounderror", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch bucket encryption for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket encryption for '{bucket_name}': {exc}") from exc


def put_bucket_encryption(
    bucket_name: str,
    rules: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_encryption(
            Bucket=bucket_name,
            ServerSideEncryptionConfiguration={"Rules": rules},
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket encryption for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket encryption for bucket %s", bucket_name)


def delete_bucket_encryption(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_encryption(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"serversideencryptionconfigurationnotfounderror", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket encryption for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket encryption for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket encryption for bucket %s", bucket_name)


def get_bucket_cors(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_cors(Bucket=bucket_name)
        return resp.get("CORSRules", []) or []
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchcorsconfiguration", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc


def put_bucket_cors(
    bucket_name: str,
    rules: list[dict],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration={"CORSRules": rules})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket CORS for '{bucket_name}': {exc}") from exc
    logger.debug("Updated CORS for bucket %s", bucket_name)


def delete_bucket_cors(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_cors(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchcorsconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket CORS for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket CORS for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted CORS for bucket %s", bucket_name)


def get_bucket_website(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_website(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchwebsiteconfiguration", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    config: dict = {}
    for key in ("IndexDocument", "ErrorDocument", "RedirectAllRequestsTo", "RoutingRules"):
        if resp.get(key) is not None:
            config[key] = resp.get(key)
    return config or None


def put_bucket_website(
    bucket_name: str,
    configuration: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_website(Bucket=bucket_name, WebsiteConfiguration=configuration)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket website for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket website for bucket %s", bucket_name)


def delete_bucket_website(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_website(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchwebsiteconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket website for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket website for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket website for bucket %s", bucket_name)


def get_bucket_policy(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> Optional[dict]:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_bucket_policy(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchbucketpolicy", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    policy_str = resp.get("Policy")
    if not policy_str:
        return None
    try:
        return json.loads(policy_str)
    except json.JSONDecodeError:
        return {"raw": policy_str}


def put_bucket_policy(
    bucket_name: str,
    policy: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(policy))
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket policy for '{bucket_name}': {exc}") from exc
    logger.debug("Updated policy for bucket %s", bucket_name)


def delete_bucket_policy(
    bucket_name: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        client.delete_bucket_policy(Bucket=bucket_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code.lower() in {"nosuchbucketpolicy", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket policy for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket policy for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted policy for bucket %s", bucket_name)


def _delete_objects(client, bucket_name: str, items: Iterable[dict]) -> None:
    _delete_objects_count(client, bucket_name, items)


def _delete_objects_count(client, bucket_name: str, items: Iterable[dict]) -> int:
    chunk = []
    deleted = 0
    for item in items:
        chunk.append(item)
        if len(chunk) == 1000:
            deleted += _delete_objects_chunk(client, bucket_name, chunk)
            chunk = []
    if chunk:
        deleted += _delete_objects_chunk(client, bucket_name, chunk)
    return deleted


def _is_delete_objects_parse_error(exc: Exception) -> bool:
    if isinstance(exc, ResponseParserError):
        return True
    text = str(exc).strip().lower()
    return "unable to parse response" in text or "invalid xml received" in text


def _delete_object_kwargs(bucket_name: str, item: dict) -> dict[str, str]:
    kwargs = {"Bucket": bucket_name, "Key": str(item.get("Key") or "")}
    version_id = str(item.get("VersionId") or "").strip()
    if version_id:
        kwargs["VersionId"] = version_id
    return kwargs


def _delete_objects_individually(
    client,
    bucket_name: str,
    chunk: list[dict],
    *,
    after_batch_fallback: bool = False,
) -> int:
    failures: list[str] = []
    for item in chunk:
        kwargs = _delete_object_kwargs(bucket_name, item)
        key = kwargs["Key"]
        version_id = kwargs.get("VersionId")
        try:
            client.delete_object(**kwargs)
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
            if code in {"nosuchkey", "nosuchversion", "notfound"}:
                continue
            label = f"{key} (version {version_id})" if version_id else key
            failures.append(f"{label}: {exc}")
        except (BotoCoreError, ResponseParserError) as exc:
            label = f"{key} (version {version_id})" if version_id else key
            failures.append(f"{label}: {exc}")
    if failures:
        sample = failures[:3]
        extra = f" (+{len(failures) - 3} more)" if len(failures) > 3 else ""
        context = " after batch fallback" if after_batch_fallback else ""
        raise RuntimeError(
            f"Unable to delete {len(failures)} object(s) in bucket '{bucket_name}'{context}: "
            f"{', '.join(sample)}{extra}"
        )
    return len(chunk)


def _delete_objects_chunk(client, bucket_name: str, chunk: list[dict]) -> int:
    try:
        resp = client.delete_objects(Bucket=bucket_name, Delete={"Objects": chunk})
    except ResponseParserError as exc:
        logger.warning(
            "DeleteObjects returned invalid XML for bucket %s; retrying %s object(s) individually: %s",
            bucket_name,
            len(chunk),
            exc,
        )
        return _delete_objects_individually(client, bucket_name, chunk, after_batch_fallback=True)
    except (ClientError, BotoCoreError) as exc:
        if _is_delete_objects_parse_error(exc):
            logger.warning(
                "DeleteObjects returned an unparseable response for bucket %s; retrying %s object(s) individually: %s",
                bucket_name,
                len(chunk),
                exc,
            )
            return _delete_objects_individually(client, bucket_name, chunk, after_batch_fallback=True)
        raise
    errors = resp.get("Errors", []) if isinstance(resp, dict) else []
    if errors:
        sample = []
        for err in errors[:3]:
            key = err.get("Key", "unknown")
            version_id = err.get("VersionId")
            code = err.get("Code", "Error")
            message = err.get("Message", "")
            suffix = f" ({message})" if message else ""
            if version_id:
                sample.append(f"{code} for {key} (version {version_id}){suffix}")
            else:
                sample.append(f"{code} for {key}{suffix}")
        extra = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
        raise RuntimeError(
            f"Unable to delete {len(errors)} object(s) in bucket '{bucket_name}': {', '.join(sample)}{extra}"
        )
    return len(chunk)


def _bucket_missing_error(exc: Exception) -> bool:
    if not isinstance(exc, ClientError):
        return False
    code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
    return code in {"nosuchbucket", "notfound"}


def _version_listing_absent_error(exc: Exception) -> bool:
    if not isinstance(exc, ClientError):
        return False
    code = str(exc.response.get("Error", {}).get("Code", "")).strip().lower() if hasattr(exc, "response") else ""
    return code in {"nosuchbucket", "nosuchversion", "notfound"}


def _format_delete_failure(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
        code = str(error.get("Code") or "").strip()
        message = str(error.get("Message") or "").strip()
        parts = [part for part in (code, message) if part and part.lower() != "none"]
        return ": ".join(parts) if parts else str(exc)
    return str(exc)


def count_bucket_purge_entries(
    client: Any,
    bucket_name: str,
    *,
    include_versions: bool = True,
    limit: int = 10000,
    progress_callback: Callable[[BucketContentPurgeProgress], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    tolerate_missing_bucket: bool = False,
) -> BucketContentCountResult:
    """Count deletable bucket entries up to limit + 1 without deleting them."""
    effective_limit = max(0, int(limit))
    stop_after = effective_limit + 1
    listed_objects = 0
    listed_versions = 0

    def check_cancel() -> None:
        if cancel_check:
            cancel_check()

    def emit(stage: str, message: str | None = None) -> None:
        if progress_callback:
            progress_callback(
                BucketContentPurgeProgress(
                    bucket_name=bucket_name,
                    stage=stage,
                    listed_objects=listed_objects,
                    listed_versions=listed_versions,
                    message=message,
                )
            )

    def build_result(*, exceeded_limit: bool = False, missing_bucket: bool = False) -> BucketContentCountResult:
        return BucketContentCountResult(
            bucket_name=bucket_name,
            listed_objects=listed_objects,
            listed_versions=listed_versions,
            limit=effective_limit,
            exceeded_limit=exceeded_limit,
            missing_bucket=missing_bucket,
        )

    def add_limited_count(current_count: int, page_count: int) -> int:
        remaining = max(0, stop_after - current_count)
        return min(page_count, remaining)

    emit("list", f"Counting objects in {bucket_name}...")
    continuation_token = None
    while True:
        check_cancel()
        list_kwargs = {"Bucket": bucket_name, "MaxKeys": 1000}
        if continuation_token:
            list_kwargs["ContinuationToken"] = continuation_token
        try:
            page = client.list_objects_v2(**list_kwargs)
        except ClientError as exc:
            if tolerate_missing_bucket and _bucket_missing_error(exc):
                return build_result(missing_bucket=True)
            raise
        object_count = len([obj for obj in (page.get("Contents", []) or []) if obj.get("Key")])
        listed_objects += add_limited_count(listed_objects + listed_versions, object_count)
        emit("list")
        if listed_objects + listed_versions > effective_limit:
            return build_result(exceeded_limit=True)
        continuation_token = page.get("NextContinuationToken")
        if not continuation_token:
            break

    if include_versions:
        emit("versions", f"Counting object versions in {bucket_name}...")
        key_marker = None
        version_marker = None
        while True:
            check_cancel()
            list_kwargs = {"Bucket": bucket_name}
            if key_marker:
                list_kwargs["KeyMarker"] = key_marker
            if version_marker:
                list_kwargs["VersionIdMarker"] = version_marker
            try:
                page = client.list_object_versions(**list_kwargs)
            except ClientError as exc:
                if _version_listing_absent_error(exc):
                    break
                raise
            version_count = 0
            for entry in page.get("Versions", []) or []:
                if entry.get("Key") and entry.get("VersionId"):
                    version_count += 1
            for entry in page.get("DeleteMarkers", []) or []:
                if entry.get("Key") and entry.get("VersionId"):
                    version_count += 1
            listed_versions += add_limited_count(listed_objects + listed_versions, version_count)
            emit("versions")
            if listed_objects + listed_versions > effective_limit:
                return build_result(exceeded_limit=True)
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

    return build_result()


def purge_bucket_contents(
    client: Any,
    bucket_name: str,
    *,
    parallelism: int = 10,
    include_versions: bool = True,
    individual_deletes: bool = False,
    progress_callback: Callable[[BucketContentPurgeProgress], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    tolerate_missing_bucket: bool = False,
) -> BucketContentPurgeResult:
    worker_count = max(1, min(int(parallelism or 10), 64))
    failure_sample_limit = 500
    listed_objects = 0
    listed_versions = 0
    deleted_objects = 0
    deleted_versions = 0
    failed_count = 0
    failures: list[BucketContentPurgeFailure] = []

    def check_cancel() -> None:
        if cancel_check:
            cancel_check()

    def emit(stage: str, message: str | None = None) -> None:
        if progress_callback:
            progress_callback(
                BucketContentPurgeProgress(
                    bucket_name=bucket_name,
                    stage=stage,
                    listed_objects=listed_objects,
                    listed_versions=listed_versions,
                    deleted_objects=deleted_objects,
                    deleted_versions=deleted_versions,
                    failed_count=failed_count,
                    message=message,
                )
            )

    def add_failure(stage: str, exc: Exception, *, items: list[dict] | None = None) -> None:
        nonlocal failed_count
        failed_count += len(items or []) or 1
        if len(failures) >= failure_sample_limit:
            return
        first = (items or [{}])[0] if items is not None else {}
        failures.append(
            BucketContentPurgeFailure(
                stage=stage,
                message=_format_delete_failure(exc),
                key=str(first.get("Key") or "") or None,
                version_id=str(first.get("VersionId") or "") or None,
                count=len(items or []),
            )
        )

    def delete_batch(stage: str, items: list[dict]) -> tuple[str, int, list[dict] | None, Exception | None]:
        check_cancel()
        try:
            if individual_deletes:
                deleted = _delete_objects_individually(client, bucket_name, items)
            else:
                deleted = _delete_objects_count(client, bucket_name, items)
            return stage, deleted, None, None
        except Exception as exc:  # noqa: BLE001
            return stage, 0, items, exc

    def drain(pending: set, *, wait_all: bool = False) -> set:
        nonlocal deleted_objects, deleted_versions
        if not pending:
            return pending
        done, remaining = wait(
            pending,
            timeout=1.0 if wait_all else None,
            return_when=FIRST_COMPLETED if not wait_all else FIRST_COMPLETED,
        )
        for future in done:
            stage, deleted, items, exc = future.result()
            if stage == "versions":
                deleted_versions += deleted
            else:
                deleted_objects += deleted
            if exc is not None:
                add_failure(stage, exc, items=items)
        emit("delete")
        return remaining

    def submit_or_wait(executor: ThreadPoolExecutor, pending: set, stage: str, items: list[dict]) -> set:
        pending.add(executor.submit(delete_batch, stage, items))
        while len(pending) >= worker_count * 2:
            check_cancel()
            pending = drain(pending)
        return pending

    def submit_items(executor: ThreadPoolExecutor, pending: set, stage: str, items: list[dict]) -> set:
        chunk_size = 1 if individual_deletes else 1000
        for start in range(0, len(items), chunk_size):
            pending = submit_or_wait(executor, pending, stage, items[start : start + chunk_size])
        return pending

    emit("list", f"Listing objects in {bucket_name}...")
    with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-purge-delete") as executor:
        pending: set = set()
        continuation_token = None
        while True:
            check_cancel()
            list_kwargs = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                list_kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**list_kwargs)
            except ClientError as exc:
                if tolerate_missing_bucket and _bucket_missing_error(exc):
                    return BucketContentPurgeResult(bucket_name=bucket_name, missing_bucket=True)
                raise
            contents = page.get("Contents", []) or []
            objects = [{"Key": obj["Key"]} for obj in contents if obj.get("Key")]
            if objects:
                listed_objects += len(objects)
                pending = submit_items(executor, pending, "objects", objects)
            continuation_token = page.get("NextContinuationToken")
            emit("list")
            if not continuation_token:
                break
        while pending:
            check_cancel()
            pending = drain(pending, wait_all=True)

        if include_versions:
            emit("versions", f"Listing object versions in {bucket_name}...")
            key_marker = None
            version_marker = None
            while True:
                check_cancel()
                list_kwargs = {"Bucket": bucket_name}
                if key_marker:
                    list_kwargs["KeyMarker"] = key_marker
                if version_marker:
                    list_kwargs["VersionIdMarker"] = version_marker
                try:
                    page = client.list_object_versions(**list_kwargs)
                except ClientError as exc:
                    if _version_listing_absent_error(exc):
                        break
                    raise
                version_objects: list[dict] = []
                for entry in page.get("Versions", []) or []:
                    key = entry.get("Key")
                    version_id = entry.get("VersionId")
                    if key and version_id:
                        version_objects.append({"Key": key, "VersionId": version_id})
                for entry in page.get("DeleteMarkers", []) or []:
                    key = entry.get("Key")
                    version_id = entry.get("VersionId")
                    if key and version_id:
                        version_objects.append({"Key": key, "VersionId": version_id})
                if version_objects:
                    listed_versions += len(version_objects)
                    pending = submit_items(executor, pending, "versions", version_objects)
                key_marker = page.get("NextKeyMarker")
                version_marker = page.get("NextVersionIdMarker")
                emit("versions")
                if not key_marker and not version_marker:
                    break
            while pending:
                check_cancel()
                pending = drain(pending, wait_all=True)

    emit("completed", f"Purged {bucket_name}.")
    return BucketContentPurgeResult(
        bucket_name=bucket_name,
        listed_objects=listed_objects,
        listed_versions=listed_versions,
        deleted_objects=deleted_objects,
        deleted_versions=deleted_versions,
        failed_count=failed_count,
        failures_sample=failures,
    )


def _delete_versions(client, bucket_name: str) -> None:
    key_marker = None
    version_marker = None
    while True:
        list_kwargs = {"Bucket": bucket_name}
        if key_marker:
            list_kwargs["KeyMarker"] = key_marker
        if version_marker:
            list_kwargs["VersionIdMarker"] = version_marker
        page = client.list_object_versions(**list_kwargs)
        objects = []
        for version in page.get("Versions", []):
            objects.append({"Key": version["Key"], "VersionId": version["VersionId"]})
        for marker in page.get("DeleteMarkers", []):
            objects.append({"Key": marker["Key"], "VersionId": marker["VersionId"]})
        if objects:
            _delete_objects(client, bucket_name, objects)
        key_marker = page.get("NextKeyMarker")
        version_marker = page.get("NextVersionIdMarker")
        if not key_marker and not version_marker:
            break


def delete_bucket(
    bucket_name: str,
    force: bool = False,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    session_token: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> None:
    client = get_s3_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )
    try:
        resp = client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to inspect bucket '{bucket_name}': {exc}") from exc

    has_objects = (resp.get("KeyCount") or 0) > 0 or bool(resp.get("Contents"))
    if has_objects and not force:
        raise BucketNotEmptyError(
            f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
        )

    if force:
        try:
            purge_result = purge_bucket_contents(client, bucket_name, parallelism=10, include_versions=True)
            if purge_result.failed_count > 0:
                sample_failures = purge_result.failures_sample[:3]
                sample = ", ".join(failure.message for failure in sample_failures)
                extra = f" (+{purge_result.failed_count - len(sample_failures)} more)" if purge_result.failed_count > len(sample_failures) else ""
                raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {sample}{extra}")
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
            if error_code.lower() not in {"nosuchbucket", "nosuchversion"}:
                raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to purge bucket contents in '{bucket_name}': {exc}") from exc

    try:
        client.delete_bucket(Bucket=bucket_name)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if error_code.lower() == "bucketnotempty":
            raise BucketNotEmptyError(
                f"Bucket '{bucket_name}' is not empty. Retry with force=true to delete all objects."
            ) from exc
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket %s (force=%s)", bucket_name, force)
