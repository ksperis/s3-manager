# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from typing import Any, Optional
import logging
from time import perf_counter

from app.core.config import get_settings
from app.services.aws_client_config import StorageRequestProfile, build_aws_config
from app.utils.aws_errors import aws_error_code

settings = get_settings()
logger = logging.getLogger(__name__)


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
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchtags", "nosuchtagset", "nosuchtagseterror", "nosuchbucket"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchlifecycleconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete lifecycle for bucket '{bucket_name}': {exc}") from exc
    logger.debug("Deleted lifecycle for bucket %s", bucket_name)
