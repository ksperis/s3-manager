# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.db import S3Account
from app.models.topic import Topic
from app.services import sns_client
from app.utils.s3_endpoint import resolve_s3_endpoint

logger = logging.getLogger(__name__)


class TopicsService:
    _CONFIG_EXCLUDED_KEYS = {
        "TopicArn",
        "TopicName",
        "Name",
        "Owner",
        "Policy",
        "User",
        "SubscriptionsConfirmed",
        "SubscriptionsPending",
        "SubscriptionsDeleted",
        "EffectiveDeliveryPolicy",
    }

    def __init__(self) -> None:
        pass

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing RGW/SNS credentials")
        return access_key, secret_key

    def _account_endpoint(self, account: S3Account) -> str:
        endpoint = resolve_s3_endpoint(account)
        if not endpoint:
            raise RuntimeError("S3 endpoint is not configured for this account")
        return endpoint

    def _topic_name_from_arn(self, arn: str) -> str:
        if ":" in arn:
            return arn.split(":")[-1]
        return arn

    def _parse_configurable_attributes(self, attributes: dict) -> Optional[dict]:
        configuration: dict[str, Any] = {}
        for key, value in attributes.items():
            if not isinstance(key, str):
                continue
            if key in self._CONFIG_EXCLUDED_KEYS:
                continue
            parsed = self._coerce_attribute_value(value)
            if parsed is None:
                continue
            configuration[key] = parsed
        return configuration or None

    def _coerce_attribute_value(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (int, float, bool, dict, list)):
            return value
        if isinstance(value, str):
            trimmed = value.strip()
            if not trimmed:
                return ""
            try:
                return json.loads(trimmed)
            except json.JSONDecodeError:
                return value
        return value

    def _topic_from_attributes(self, arn: str, attributes: dict) -> Topic:
        def _to_int(value: Optional[str]) -> Optional[int]:
            if value is None or value == "":
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        return Topic(
            name=self._topic_name_from_arn(arn),
            arn=arn,
            owner=attributes.get("Owner"),
            subscriptions_confirmed=_to_int(attributes.get("SubscriptionsConfirmed")),
            subscriptions_pending=_to_int(attributes.get("SubscriptionsPending")),
            configuration=self._parse_configurable_attributes(attributes),
        )

    def list_topics(self, account: S3Account) -> list[Topic]:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        raw_topics = sns_client.list_topics(access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        items: list[Topic] = []
        for entry in raw_topics:
            arn = entry.get("TopicArn") or entry.get("Arn") or entry.get("topic_arn")
            if not arn:
                logger.debug("Skipping malformed SNS topic entry: %s", entry)
                continue
            attrs = sns_client.get_topic_attributes(arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
            items.append(self._topic_from_attributes(arn, attrs))
        return items

    def _serialize_configuration(self, configuration: Optional[dict]) -> dict[str, str]:
        serialized: dict[str, str] = {}
        if not configuration:
            return serialized
        for key, value in configuration.items():
            if not isinstance(key, str) or not key:
                continue
            if key in self._CONFIG_EXCLUDED_KEYS:
                continue
            if value is None:
                serialized[key] = ""
            elif isinstance(value, str):
                serialized[key] = value
            else:
                serialized[key] = json.dumps(value)
        return serialized

    def create_topic(
        self,
        account: S3Account,
        name: str,
        configuration: Optional[dict] = None,
    ) -> Topic:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        attributes = self._serialize_configuration(configuration)
        resp = sns_client.create_topic(
            name,
            attributes=attributes,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        arn = resp.get("TopicArn") or ""
        if not arn:
            raise RuntimeError("SNS topic was created but ARN was not returned by the gateway")
        attrs = sns_client.get_topic_attributes(arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        return self._topic_from_attributes(arn, attrs)

    def delete_topic(self, account: S3Account, topic_arn: str) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        sns_client.delete_topic(topic_arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def get_topic_policy(self, account: S3Account, topic_arn: str) -> Optional[dict]:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        return sns_client.get_topic_policy(topic_arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def set_topic_policy(self, account: S3Account, topic_arn: str, policy: dict) -> dict:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        sns_client.set_topic_policy(topic_arn, policy, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        updated = self.get_topic_policy(account, topic_arn)
        return updated or {}

    def get_topic_configuration(self, account: S3Account, topic_arn: str) -> dict:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        attrs = sns_client.get_topic_attributes(topic_arn, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        configuration = self._parse_configurable_attributes(attrs or {})
        return configuration or {}

    def set_topic_configuration(
        self,
        account: S3Account,
        topic_arn: str,
        configuration: Optional[dict],
    ) -> dict:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._account_endpoint(account)
        current = self.get_topic_configuration(account, topic_arn)
        serialized_current = self._serialize_configuration(current)
        serialized_desired = self._serialize_configuration(configuration)
        changes: dict[str, str] = {}

        for key, value in serialized_desired.items():
            if serialized_current.get(key) != value:
                changes[key] = value

        for key, value in serialized_current.items():
            if key not in serialized_desired and value != "":
                changes[key] = ""

        if not changes:
            return current or {}

        sns_client.set_topic_attributes(topic_arn, changes, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        updated = self.get_topic_configuration(account, topic_arn)
        return updated or {}


def get_topics_service() -> TopicsService:
    return TopicsService()
