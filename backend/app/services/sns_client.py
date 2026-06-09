# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
from typing import Any, Optional
from xml.etree import ElementTree

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _xml_element_value(element: ElementTree.Element) -> Any:
    children = list(element)
    if not children:
        return element.text or ""

    value: dict[str, Any] = {}
    for child in children:
        key = _xml_local_name(child.tag)
        child_value = _xml_element_value(child)
        if key in value:
            existing = value[key]
            if isinstance(existing, list):
                existing.append(child_value)
            else:
                value[key] = [existing, child_value]
        else:
            value[key] = child_value
    return value


def _parse_list_topics_xml(body: bytes | str) -> list[dict[str, Any]]:
    root = ElementTree.fromstring(body)
    topics: list[dict[str, Any]] = []
    for topics_node in root.iter():
        if _xml_local_name(topics_node.tag) != "Topics":
            continue
        for member in list(topics_node):
            if _xml_local_name(member.tag) != "member":
                continue
            entry = _xml_element_value(member)
            if isinstance(entry, dict):
                topics.append(entry)
    return topics


def _response_body_bytes(http_response: Any) -> Optional[bytes]:
    if http_response is None:
        return None
    content = getattr(http_response, "content", None)
    if isinstance(content, bytes):
        return content
    if isinstance(content, str):
        return content.encode()
    text = getattr(http_response, "text", None)
    if isinstance(text, str):
        return text.encode()
    return None


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


def list_topics_raw(
    access_key: Optional[str] = None,
    secret_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> list[dict]:
    client = get_sns_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
    topics: list[dict] = []
    token: Optional[str] = None
    raw_bodies: list[bytes] = []

    def capture_raw_response(**kwargs):
        body = _response_body_bytes(kwargs.get("http_response"))
        if body:
            raw_bodies.append(body)

    client.meta.events.register("after-call.sns.ListTopics", capture_raw_response)
    try:
        while True:
            params = {}
            if token:
                params["NextToken"] = token
            body_count = len(raw_bodies)
            resp = client.list_topics(**params)
            if len(raw_bodies) > body_count:
                topics.extend(_parse_list_topics_xml(raw_bodies[-1]))
            else:
                topics.extend(resp.get("Topics", []))
            token = resp.get("NextToken")
            if not token:
                break
    except ElementTree.ParseError as exc:
        raise RuntimeError(f"Unable to parse raw SNS ListTopics response: {exc}") from exc
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to list raw SNS topics: {exc}") from exc
    finally:
        client.meta.events.unregister("after-call.sns.ListTopics", capture_raw_response)
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
