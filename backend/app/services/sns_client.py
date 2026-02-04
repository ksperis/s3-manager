# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def get_sns_client(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
):
    if not endpoint:
        raise RuntimeError("SNS endpoint is not configured")
    return boto3.client(
        "sns",
        endpoint_url=endpoint,
        aws_access_key_id=access_key or settings.seed_s3_access_key,
        aws_secret_access_key=secret_key or settings.seed_s3_secret_key,
        region_name=region or settings.seed_s3_region,
        verify=verify_tls,
        config=Config(signature_version="s3v4"),
    )


def list_topics(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    topics: list[dict] = []
    token: Optional[str] = None
    try:
        while True:
            params = {}
            if token:
                params["NextToken"] = token
            resp = client.list_topics(**params)
            topics.extend(resp.get("Topics", []))
            token = resp.get("NextToken")
            if not token:
                break
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to list SNS topics: {exc}") from exc
    return topics


def create_topic(
    name: str,
    attributes: Optional[dict[str, str]] = None,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> dict:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    attrs: dict[str, str] = dict(attributes or {})
    try:
        params = {"Name": name}
        if attrs:
            params["Attributes"] = attrs
        resp = client.create_topic(**params)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to create SNS topic '{name}': {exc}") from exc
    return resp or {}


def delete_topic(
    topic_arn: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> None:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    try:
        client.delete_topic(TopicArn=topic_arn)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code in {"NotFound", "NotFoundException"}:
            return
        raise RuntimeError(f"Unable to delete SNS topic '{topic_arn}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to delete SNS topic '{topic_arn}': {exc}") from exc


def get_topic_attributes(
    topic_arn: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> dict:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    try:
        resp = client.get_topic_attributes(TopicArn=topic_arn)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if code in {"NotFound", "NotFoundException"}:
            return {}
        raise RuntimeError(f"Unable to fetch SNS topic attributes '{topic_arn}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch SNS topic attributes '{topic_arn}': {exc}") from exc
    return resp.get("Attributes", {}) or {}


def get_topic_policy(
    topic_arn: str,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> Optional[dict]:
    attrs = get_topic_attributes(
        topic_arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls
    )
    raw_policy = attrs.get("Policy")
    if not raw_policy:
        return None
    try:
        return json.loads(raw_policy)
    except json.JSONDecodeError:
        logger.warning("SNS topic %s has non-JSON policy", topic_arn)
        return {"raw": raw_policy}


def set_topic_policy(
    topic_arn: str,
    policy: dict,
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> None:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    try:
        client.set_topic_attributes(
            TopicArn=topic_arn,
            AttributeName="Policy",
            AttributeValue=json.dumps(policy),
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to update SNS topic policy for '{topic_arn}': {exc}") from exc


def set_topic_attributes(
    topic_arn: str,
    attributes: dict[str, str],
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> None:
    if not attributes:
        return
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    for name, value in attributes.items():
        try:
            client.set_topic_attributes(
                TopicArn=topic_arn,
                AttributeName=name,
                AttributeValue=value,
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update SNS topic attribute '{name}' for '{topic_arn}': {exc}") from exc
