# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def get_sts_client(
    access_key: Optional[str],
    secret_key: Optional[str],
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
):
    client = boto3.client(
        "sts",
        endpoint_url=endpoint or settings.sts_endpoint or settings.s3_endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        aws_session_token=session_token,
        region_name=settings.s3_region,
    )
    return client


def assume_role(
    role_arn: str,
    session_name: str,
    duration_seconds: int,
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
) -> Tuple[str, str, str, datetime]:
    client = get_sts_client(access_key, secret_key, endpoint=endpoint)
    try:
        resp = client.assume_role(
            RoleArn=role_arn,
            RoleSessionName=session_name,
            DurationSeconds=duration_seconds,
        )
        creds = resp.get("Credentials") or {}
        access = creds.get("AccessKeyId")
        secret = creds.get("SecretAccessKey")
        token = creds.get("SessionToken")
        expiration_raw = creds.get("Expiration")
        if not access or not secret or not token:
            raise RuntimeError("STS assume role did not return credentials")
        if isinstance(expiration_raw, datetime):
            expiration = expiration_raw
        else:
            expiration = datetime.fromisoformat(str(expiration_raw)) if expiration_raw else datetime.now(tz=timezone.utc)
        return access, secret, token, expiration
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to assume role {role_arn}: {exc}") from exc


def get_session_token(
    session_name: str,
    duration_seconds: int,
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
) -> Tuple[str, str, str, datetime]:
    client = get_sts_client(access_key, secret_key, endpoint=endpoint, session_token=session_token)
    try:
        resp = client.get_session_token(DurationSeconds=duration_seconds)
        creds = resp.get("Credentials") or {}
        access = creds.get("AccessKeyId")
        secret = creds.get("SecretAccessKey")
        token = creds.get("SessionToken")
        expiration_raw = creds.get("Expiration")
        if not access or not secret or not token:
            raise RuntimeError("STS get session token did not return credentials")
        if isinstance(expiration_raw, datetime):
            expiration = expiration_raw
        else:
            expiration = datetime.fromisoformat(str(expiration_raw)) if expiration_raw else datetime.now(tz=timezone.utc)
        return access, secret, token, expiration
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to get session token: {exc}") from exc
