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
