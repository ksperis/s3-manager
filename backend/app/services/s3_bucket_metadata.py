# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


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
