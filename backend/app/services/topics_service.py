# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Any, Optional
from urllib.parse import parse_qsl

from app.db import S3Account, StorageProvider
from app.models.topic import Topic, TopicSubscription
from app.services import sns_client
from app.utils.s3_endpoint import resolve_s3_client_options

logger = logging.getLogger(__name__)


class TopicsService:
    _CONFIG_EXCLUDED_KEYS = {
        "TopicArn",
        "TopicName",
        "Name",
        "Owner",
        "Policy",
        "Version",
        "Statement",
        "Id",
        "User",
        "EndPoint",
        "EndpointAddress",
        "EndpointArgs",
        "EndpointTopic",
        "SubscriptionsConfirmed",
        "SubscriptionsPending",
        "SubscriptionsDeleted",
        "EffectiveDeliveryPolicy",
        "HasStoredSecret",
    }
    _SUBSCRIPTION_DIRECT_KEYS = {
        "TopicArn",
        "Arn",
        "topic_arn",
        "Name",
        "TopicName",
        "EndPoint",
        "EndpointAddress",
        "EndpointArgs",
        "EndpointTopic",
        "Persistent",
        "persistent",
    }

    def __init__(self) -> None:
        pass

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing SNS credentials")
        return access_key, secret_key

    def _client_kwargs(self, account: S3Account) -> dict:
        endpoint, region, _, verify_tls = resolve_s3_client_options(account)
        if not endpoint:
            raise RuntimeError("S3 endpoint is not configured for this account")
        return {
            "endpoint": endpoint,
            "region": region,
            "verify_tls": verify_tls,
        }

    def _topic_name_from_arn(self, arn: str) -> str:
        if ":" in arn:
            return arn.split(":")[-1]
        return arn

    def _is_ceph_endpoint(self, account: S3Account) -> bool:
        endpoint = getattr(account, "storage_endpoint", None)
        provider = getattr(endpoint, "provider", None)
        provider_value = getattr(provider, "value", provider)
        return str(provider_value or "").strip().lower() == StorageProvider.CEPH.value

    def _parse_configurable_attributes(self, attributes: dict) -> Optional[dict]:
        configuration: dict[str, Any] = {}
        configuration.update(self._parse_endpoint_configuration(attributes.get("EndPoint")))
        for key, value in attributes.items():
            if not isinstance(key, str):
                continue
            if key in self._CONFIG_EXCLUDED_KEYS:
                continue
            parsed = self._coerce_attribute_value(value)
            if parsed is None or parsed == "":
                continue
            configuration[key] = parsed
        return configuration or None

    def _parse_endpoint_configuration(self, value: Any) -> dict[str, Any]:
        endpoint = self._coerce_attribute_value(value)
        if not isinstance(endpoint, dict):
            return {}

        configuration: dict[str, Any] = {}
        endpoint_address = endpoint.get("EndpointAddress")
        if endpoint_address:
            configuration["push-endpoint"] = str(endpoint_address)

        for key, raw_arg_value in self._parse_endpoint_args(endpoint.get("EndpointArgs")).items():
            if not isinstance(key, str) or not key:
                continue
            if key in self._CONFIG_EXCLUDED_KEYS:
                continue
            parsed = self._coerce_attribute_value(raw_arg_value)
            if parsed is None or parsed == "":
                continue
            configuration[key] = parsed

        return configuration

    def _parse_endpoint_args(self, value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        parsed = self._coerce_attribute_value(value)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            args: dict[str, Any] = {}
            for item in parsed:
                if isinstance(item, (list, tuple)) and len(item) == 2:
                    key, arg_value = item
                    if isinstance(key, str):
                        args[key] = arg_value
            return args
        if isinstance(parsed, str):
            return {key: arg_value for key, arg_value in parse_qsl(parsed, keep_blank_values=True) if key}
        return {}

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

    def _to_int(self, value: Any) -> Optional[int]:
        if value is None or value == "":
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _to_bool(self, value: Any) -> Optional[bool]:
        parsed = self._coerce_attribute_value(value)
        if isinstance(parsed, bool):
            return parsed
        if isinstance(parsed, (int, float)):
            return bool(parsed)
        if isinstance(parsed, str):
            normalized = parsed.strip().lower()
            if normalized in {"true", "1", "yes", "on"}:
                return True
            if normalized in {"false", "0", "no", "off"}:
                return False
        return None

    def _topic_from_attributes(
        self,
        arn: str,
        attributes: dict,
        *,
        name: Optional[str] = None,
        subscriptions: Optional[list[TopicSubscription]] = None,
    ) -> Topic:
        return Topic(
            name=name or self._topic_name_from_arn(arn),
            arn=arn,
            owner=attributes.get("Owner"),
            subscriptions_confirmed=self._to_int(attributes.get("SubscriptionsConfirmed")),
            subscriptions_pending=self._to_int(attributes.get("SubscriptionsPending")),
            subscriptions=subscriptions or [],
            configuration=self._parse_configurable_attributes(attributes),
        )

    def _entry_arn(self, entry: dict[str, Any]) -> Optional[str]:
        arn = entry.get("TopicArn") or entry.get("Arn") or entry.get("topic_arn")
        return str(arn) if arn else None

    def _entry_name(self, entry: dict[str, Any], arn: str) -> str:
        name = entry.get("Name") or entry.get("TopicName")
        if name:
            return str(name)
        return self._topic_name_from_arn(arn)

    def _is_ceph_notification_entry(self, entry: dict[str, Any], arn: str) -> bool:
        return self._entry_name(entry, arn).startswith("notif.")

    def _bucket_from_notification_name(self, name: str) -> Optional[str]:
        if not name.startswith("notif."):
            return None
        suffix = name.removeprefix("notif.")
        bucket, _, _topic = suffix.partition("_")
        return bucket or None

    def _is_sensitive_metadata_key(self, key: str) -> bool:
        normalized = key.replace("-", "_").lower()
        if normalized == "hasstoredsecret":
            return True
        return any(token in normalized for token in ("password", "secret", "token", "access_key"))

    def _clean_subscription_dict(self, values: dict[str, Any]) -> dict[str, Any]:
        cleaned: dict[str, Any] = {}
        for key, value in values.items():
            if not isinstance(key, str) or not key:
                continue
            if self._is_sensitive_metadata_key(key):
                continue
            parsed = self._coerce_attribute_value(value)
            if parsed is None or parsed == "":
                continue
            cleaned[key] = parsed
        return cleaned

    def _string_or_none(self, value: Any) -> Optional[str]:
        parsed = self._coerce_attribute_value(value)
        if parsed is None or parsed == "":
            return None
        return str(parsed)

    def _subscription_from_ceph_entry(self, entry: dict[str, Any], arn: str) -> TopicSubscription:
        name = self._entry_name(entry, arn)
        endpoint = self._coerce_attribute_value(entry.get("EndPoint"))
        endpoint_map = endpoint if isinstance(endpoint, dict) else {}
        endpoint_args = self._clean_subscription_dict(
            self._parse_endpoint_args(entry.get("EndpointArgs") or endpoint_map.get("EndpointArgs"))
        )
        endpoint_address = self._string_or_none(entry.get("EndpointAddress") or endpoint_map.get("EndpointAddress"))
        endpoint_topic = self._string_or_none(entry.get("EndpointTopic") or endpoint_map.get("EndpointTopic"))
        persistent = self._to_bool(
            entry.get("Persistent")
            if entry.get("Persistent") is not None
            else entry.get("persistent", endpoint_args.get("persistent"))
        )
        metadata = self._clean_subscription_dict(
            {
                key: value
                for key, value in entry.items()
                if isinstance(key, str) and key not in self._SUBSCRIPTION_DIRECT_KEYS
            }
        )
        metadata.update(
            self._clean_subscription_dict(
                {
                    key: value
                    for key, value in endpoint_map.items()
                    if isinstance(key, str) and key not in {"EndpointAddress", "EndpointArgs", "EndpointTopic"}
                }
            )
        )
        return TopicSubscription(
            name=name,
            bucket=self._bucket_from_notification_name(name),
            endpoint_address=endpoint_address,
            endpoint_topic=endpoint_topic,
            endpoint_args=endpoint_args,
            persistent=persistent,
            metadata=metadata,
        )

    def _list_standard_topics(self, access_key: str, secret_key: str, client_kwargs: dict) -> list[Topic]:
        raw_topics = sns_client.list_topics(access_key=access_key, secret_key=secret_key, **client_kwargs)
        items: list[Topic] = []
        for entry in raw_topics:
            arn = self._entry_arn(entry)
            if not arn:
                logger.debug("Skipping malformed SNS topic entry: %s", entry)
                continue
            attrs = sns_client.get_topic_attributes(
                arn, access_key=access_key, secret_key=secret_key, **client_kwargs
            )
            items.append(self._topic_from_attributes(arn, attrs))
        return items

    def _list_ceph_topics(self, access_key: str, secret_key: str, client_kwargs: dict) -> list[Topic]:
        raw_topics = sns_client.list_topics_raw(access_key=access_key, secret_key=secret_key, **client_kwargs)
        ordered_arns: list[str] = []
        topic_names: dict[str, str] = {}
        subscriptions_by_arn: dict[str, list[TopicSubscription]] = {}
        for entry in raw_topics:
            arn = self._entry_arn(entry)
            if not arn:
                logger.debug("Skipping malformed Ceph SNS topic entry: %s", entry)
                continue
            if arn not in ordered_arns:
                ordered_arns.append(arn)
            if self._is_ceph_notification_entry(entry, arn):
                subscriptions_by_arn.setdefault(arn, []).append(self._subscription_from_ceph_entry(entry, arn))
                continue
            topic_names.setdefault(arn, self._entry_name(entry, arn))

        items: list[Topic] = []
        for arn in ordered_arns:
            attrs = sns_client.get_topic_attributes(
                arn, access_key=access_key, secret_key=secret_key, **client_kwargs
            )
            items.append(
                self._topic_from_attributes(
                    arn,
                    attrs,
                    name=topic_names.get(arn),
                    subscriptions=subscriptions_by_arn.get(arn, []),
                )
            )
        return items

    def list_topics(self, account: S3Account) -> list[Topic]:
        access_key, secret_key = self._account_credentials(account)
        client_kwargs = self._client_kwargs(account)
        if self._is_ceph_endpoint(account):
            return self._list_ceph_topics(access_key, secret_key, client_kwargs)
        return self._list_standard_topics(access_key, secret_key, client_kwargs)

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
        attributes = self._serialize_configuration(configuration)
        resp = sns_client.create_topic(
            name,
            attributes=attributes,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        arn = resp.get("TopicArn") or ""
        if not arn:
            raise RuntimeError("SNS topic was created but ARN was not returned by the gateway")
        attrs = sns_client.get_topic_attributes(
            arn, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        return self._topic_from_attributes(arn, attrs)

    def delete_topic(self, account: S3Account, topic_arn: str) -> None:
        access_key, secret_key = self._account_credentials(account)
        sns_client.delete_topic(topic_arn, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account))

    def get_topic_policy(self, account: S3Account, topic_arn: str) -> Optional[dict]:
        access_key, secret_key = self._account_credentials(account)
        return sns_client.get_topic_policy(
            topic_arn, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def set_topic_policy(self, account: S3Account, topic_arn: str, policy: dict) -> dict:
        access_key, secret_key = self._account_credentials(account)
        sns_client.set_topic_policy(
            topic_arn, policy, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        updated = self.get_topic_policy(account, topic_arn)
        return updated or {}

    def get_topic_configuration(self, account: S3Account, topic_arn: str) -> dict:
        access_key, secret_key = self._account_credentials(account)
        attrs = sns_client.get_topic_attributes(
            topic_arn, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        configuration = self._parse_configurable_attributes(attrs or {})
        return configuration or {}

    def set_topic_configuration(
        self,
        account: S3Account,
        topic_arn: str,
        configuration: Optional[dict],
    ) -> dict:
        access_key, secret_key = self._account_credentials(account)
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

        sns_client.set_topic_attributes(
            topic_arn, changes, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        updated = self.get_topic_configuration(account, topic_arn)
        return updated or {}


def get_topics_service() -> TopicsService:
    return TopicsService()
