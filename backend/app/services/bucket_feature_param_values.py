# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket import BucketEncryptionConfiguration
from app.services.bucket_listing_shared import coerce_filter_number

_NOTIFICATION_CONFIGURATION_SPECS = (
    ("topic", "TopicConfigurations", "TopicArn"),
    ("queue", "QueueConfigurations", "QueueArn"),
    ("lambda", "LambdaFunctionConfigurations", "LambdaFunctionArn"),
)


def extract_lifecycle_abort_days(rule_entry: dict) -> float | None:
    raw = rule_entry.get("AbortIncompleteMultipartUpload")
    if not isinstance(raw, dict):
        return None
    return coerce_filter_number(raw.get("DaysAfterInitiation"))


def extract_lifecycle_expiration_days(rule_entry: dict) -> float | None:
    expiration = rule_entry.get("Expiration")
    if not isinstance(expiration, dict):
        return None
    return coerce_filter_number(expiration.get("Days"))


def extract_lifecycle_noncurrent_expiration_days(rule_entry: dict) -> float | None:
    noncurrent_expiration = rule_entry.get("NoncurrentVersionExpiration")
    if not isinstance(noncurrent_expiration, dict):
        return None
    return coerce_filter_number(noncurrent_expiration.get("NoncurrentDays"))


def extract_lifecycle_transition_days(rule_entry: dict) -> list[float]:
    values: list[float] = []
    transitions = rule_entry.get("Transitions")
    if isinstance(transitions, list):
        candidates = transitions
    elif isinstance(rule_entry.get("Transition"), dict):
        candidates = [rule_entry.get("Transition")]
    else:
        candidates = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        days = coerce_filter_number(item.get("Days"))
        if days is not None:
            values.append(days)
    return values


def dedupe_sorted_day_values(values: list[float]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for raw in values:
        if raw is None:
            continue
        value = int(raw)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    normalized.sort()
    return normalized


def _string_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def notification_rule_entries(configuration: object) -> list[tuple[str, dict]]:
    if not isinstance(configuration, dict):
        return []
    entries: list[tuple[str, dict]] = []
    for entry_type, config_key, _destination_key in _NOTIFICATION_CONFIGURATION_SPECS:
        raw_entries = configuration.get(config_key)
        if not isinstance(raw_entries, list):
            continue
        entries.extend((entry_type, entry) for entry in raw_entries if isinstance(entry, dict))
    return entries


def extract_notification_rule_id(entry: dict) -> str | None:
    for key in ("Id", "ID", "id"):
        if (value := _string_or_none(entry.get(key))) is not None:
            return value
    return None


def _last_notification_identifier(value: str) -> str:
    tail = value.rsplit(":", 1)[-1]
    return tail.rsplit("/", 1)[-1] or tail


def _extract_notification_topic_display_name(entry: dict) -> str | None:
    for key in ("Topic", "TopicName", "topic", "topic_name", "EndpointTopic"):
        if (value := _string_or_none(entry.get(key))) is not None:
            return value
    topic_arn = _string_or_none(entry.get("TopicArn"))
    if not topic_arn:
        return None
    return _last_notification_identifier(topic_arn)


def extract_notification_topic_match_values(entry: dict) -> list[str]:
    values: list[str] = []
    for key in ("Topic", "TopicName", "topic", "topic_name", "EndpointTopic"):
        if (value := _string_or_none(entry.get(key))) is not None:
            values.append(value)
    topic_arn = _string_or_none(entry.get("TopicArn"))
    if topic_arn:
        values.append(topic_arn)
        values.append(_last_notification_identifier(topic_arn))
    return _dedupe_sorted_text_values(values)


def extract_notification_events(entry: dict) -> list[str]:
    raw_events = entry.get("Events")
    if not isinstance(raw_events, list):
        raw_events = entry.get("events")
    if isinstance(raw_events, list):
        return [value for item in raw_events if (value := _string_or_none(item)) is not None]
    value = _string_or_none(raw_events)
    return [value] if value else []


def extract_notification_filter_values(entry: dict, filter_name: str) -> list[str]:
    filters: list[dict] = []
    raw_filter = entry.get("Filter")
    if not isinstance(raw_filter, dict):
        raw_filter = entry.get("filter")
    key_filter = raw_filter.get("Key") if isinstance(raw_filter, dict) else None
    if not isinstance(key_filter, dict) and isinstance(raw_filter, dict):
        key_filter = raw_filter.get("key")
    if isinstance(key_filter, dict):
        raw_rules = key_filter.get("FilterRules")
        if not isinstance(raw_rules, list):
            raw_rules = key_filter.get("filterRules")
        if isinstance(raw_rules, list):
            filters.extend(item for item in raw_rules if isinstance(item, dict))
    raw_rules = entry.get("FilterRules")
    if not isinstance(raw_rules, list):
        raw_rules = entry.get("filterRules")
    if isinstance(raw_rules, list):
        filters.extend(item for item in raw_rules if isinstance(item, dict))

    values: list[str] = []
    for item in filters:
        name = _string_or_none(item.get("Name") or item.get("name"))
        if name is None or name.lower() != filter_name:
            continue
        if (value := _string_or_none(item.get("Value") or item.get("value"))) is not None:
            values.append(value)
    return _dedupe_sorted_text_values(values)


def _dedupe_sorted_text_values(values: list[str]) -> list[str]:
    unique: dict[str, str] = {}
    for value in values:
        text = value.strip()
        if not text:
            continue
        unique.setdefault(text.lower(), text)
    return sorted(unique.values(), key=lambda item: item.lower())


def _text_list_from_keys(entry: dict, keys: tuple[str, ...]) -> list[str]:
    for key in keys:
        raw = entry.get(key)
        if raw is None:
            continue
        if isinstance(raw, list):
            return [value for item in raw if (value := _string_or_none(item)) is not None]
        if (value := _string_or_none(raw)) is not None:
            return [value]
    return []


def extract_cors_rule_values(entry: dict, param: str) -> list[str]:
    if param == "cors_allowed_method":
        return _text_list_from_keys(entry, ("AllowedMethods", "allowedMethods", "allowed_methods", "AllowedMethod"))
    if param == "cors_allowed_origin":
        return _text_list_from_keys(entry, ("AllowedOrigins", "allowedOrigins", "allowed_origins", "AllowedOrigin"))
    return []


def extract_cors_allowed_values(rules: object, param: str) -> list[str]:
    if not isinstance(rules, list):
        return []
    values: list[str] = []
    for entry in rules:
        if isinstance(entry, dict):
            values.extend(extract_cors_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def encryption_rule_entries(configuration: object) -> list[dict]:
    if isinstance(configuration, BucketEncryptionConfiguration):
        raw_rules = configuration.rules
    elif isinstance(configuration, list):
        raw_rules = configuration
    else:
        raw_rules = []
    return [item for item in raw_rules if isinstance(item, dict)]


def _extract_sse_default(entry: dict) -> dict:
    raw = entry.get("ApplyServerSideEncryptionByDefault")
    if not isinstance(raw, dict):
        raw = entry.get("applyServerSideEncryptionByDefault")
    if not isinstance(raw, dict):
        raw = entry.get("apply_server_side_encryption_by_default")
    return raw if isinstance(raw, dict) else {}


def extract_sse_rule_values(entry: dict, param: str) -> list[str]:
    default = _extract_sse_default(entry)
    if param == "sse_algorithm":
        return _text_list_from_keys(default, ("SSEAlgorithm", "sseAlgorithm", "sse_algorithm"))
    if param == "sse_kms_key_id":
        return _text_list_from_keys(default, ("KMSMasterKeyID", "kmsMasterKeyID", "kms_master_key_id", "KMSKeyId"))
    return []


def extract_sse_values(configuration: object, param: str) -> list[str]:
    values: list[str] = []
    for entry in encryption_rule_entries(configuration):
        values.extend(extract_sse_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def extract_notification_eventbridge_present(configuration: object) -> bool | None:
    if not isinstance(configuration, dict):
        return None
    eventbridge = configuration.get("EventBridgeConfiguration")
    if eventbridge is None:
        eventbridge = configuration.get("eventBridgeConfiguration")
    return isinstance(eventbridge, dict)


def extract_notification_topic_names(configuration: object) -> list[str]:
    names: list[str] = []
    for entry_type, entry in notification_rule_entries(configuration):
        if entry_type != "topic":
            continue
        if (name := _extract_notification_topic_display_name(entry)) is not None:
            names.append(name)
    return _dedupe_sorted_text_values(names)


def extract_policy_statement_summary(policy: dict | None) -> tuple[int, bool]:
    if not isinstance(policy, dict):
        return 0, False
    raw_statements = policy.get("Statement")
    if isinstance(raw_statements, list):
        statements = raw_statements
    elif raw_statements is None:
        statements = []
    else:
        statements = [raw_statements]
    has_conditions = any(
        isinstance(item, dict)
        and isinstance(item.get("Condition"), dict)
        and len(item.get("Condition", {}).keys()) > 0
        for item in statements
    )
    return len(statements), has_conditions
