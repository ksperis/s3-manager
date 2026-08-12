# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_client import get_s3_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


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
        code = aws_error_code(exc, lowercase=True)
        if not block and code in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchpublicaccessblockconfiguration", "nosuchpublicaccessblock"}:
            return None
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch public access block for bucket '{bucket_name}': {exc}") from exc


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
        code = aws_error_code(exc, lowercase=True)
        if code in {"objectlockconfigurationnotfounderror", "invalidbucketstate", "nosuchbucket"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"serversideencryptionconfigurationnotfounderror", "nosuchbucket"}:
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
        code = aws_error_code(exc, lowercase=True)
        if code in {"serversideencryptionconfigurationnotfounderror", "nosuchbucket"}:
            return
        raise RuntimeError(f"Unable to delete bucket encryption for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete bucket encryption for '{bucket_name}': {exc}") from exc
    logger.debug("Deleted bucket encryption for bucket %s", bucket_name)
