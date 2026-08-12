# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError, ParamValidationError

from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


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
        code = aws_error_code(exc, lowercase=True)
        if code in {"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket replication for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket replication for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket replication for %s", bucket_name)
