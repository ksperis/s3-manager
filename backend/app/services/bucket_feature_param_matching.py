# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketLoggingConfiguration,
    BucketProperties,
    BucketWebsiteConfiguration,
)
from app.models.ceph_admin import CephAdminBucketFilterRule, CephAdminBucketSummary
from app.services.bucket_listing_shared import coerce_filter_bool, coerce_filter_number
from app.services.bucket_notification_state import account_sns_feature_enabled
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.normalize import normalize_text

BUCKET_FEATURE_PARAM_MAX_WORKERS = 6

_FEATURE_PARAM_UNAVAILABLE = object()
_FEATURE_PARAM_SOURCE_BY_PARAM: dict[str, str] = {
    "lifecycle_rule_id": "lifecycle",
    "lifecycle_rule_status": "lifecycle",
    "lifecycle_rule_type": "lifecycle",
    "lifecycle_expiration_days": "lifecycle",
    "lifecycle_noncurrent_expiration_days": "lifecycle",
    "lifecycle_transition_days": "lifecycle",
    "lifecycle_abort_multipart_present": "lifecycle",
    "lifecycle_abort_multipart_days": "lifecycle",
    "object_lock_mode": "props",
    "object_lock_retention_days": "props",
    "object_lock_retention_years": "props",
    "bpa_block_public_acls": "props",
    "bpa_ignore_public_acls": "props",
    "bpa_block_public_policy": "props",
    "bpa_restrict_public_buckets": "props",
    "cors_allowed_method": "props",
    "cors_allowed_origin": "props",
    "logging_enabled": "logging",
    "logging_target_bucket": "logging",
    "logging_target_prefix": "logging",
    "website_index_present": "website",
    "website_index_document": "website",
    "website_error_document": "website",
    "website_redirect_host_present": "website",
    "website_redirect_host": "website",
    "website_routing_rule_count": "website",
    "policy_statement_count": "policy",
    "policy_has_conditions": "policy",
    "notification_rule_id": "notifications",
    "notification_rule_type": "notifications",
    "notification_topic_name": "notifications",
    "notification_event": "notifications",
    "notification_filter_prefix": "notifications",
    "notification_filter_suffix": "notifications",
    "notification_eventbridge_present": "notifications",
    "sse_algorithm": "encryption",
    "sse_kms_key_id": "encryption",
}
_NOTIFICATION_CONFIGURATION_SPECS = (
    ("topic", "TopicConfigurations", "TopicArn"),
    ("queue", "QueueConfigurations", "QueueArn"),
    ("lambda", "LambdaFunctionConfigurations", "LambdaFunctionArn"),
)


def bucket_identity_key(bucket: CephAdminBucketSummary) -> str:
    return f"{bucket.tenant or ''}:{bucket.name}"


def _match_text_value(left: str | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = normalize_text(str(right_raw or ""))
    if not right:
        return False
    left_norm = normalize_text(left)
    if op == "eq":
        return left_norm == right
    if op == "neq":
        return left_norm != right
    if op == "contains":
        return right in left_norm
    if op == "starts_with":
        return left_norm.startswith(right)
    if op == "ends_with":
        return left_norm.endswith(right)
    return False


def _match_numeric_value(left: float | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = coerce_filter_number(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left == right
    if op == "neq":
        return left != right
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "lt":
        return left < right
    if op == "lte":
        return left <= right
    return False


def _match_bool_value(left: bool | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = coerce_filter_bool(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left is right
    if op == "neq":
        return left is not right
    return False


def _extract_lifecycle_rule_id(rule_entry: dict) -> str | None:
    raw = rule_entry.get("ID")
    if raw is None:
        raw = rule_entry.get("Id")
    if raw is None:
        raw = rule_entry.get("id")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _extract_lifecycle_rule_status(rule_entry: dict) -> str | None:
    raw = rule_entry.get("Status")
    if raw is None:
        raw = rule_entry.get("status")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


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


def _extract_lifecycle_rule_types(rule_entry: dict) -> list[str]:
    types: list[str] = []

    expiration = rule_entry.get("Expiration")
    if isinstance(expiration, dict):
        if expiration.get("Days") is not None or expiration.get("Date") is not None:
            types.append("expiration")
        if expiration.get("ExpiredObjectDeleteMarker") is True:
            types.append("delete_markers")

    noncurrent_expiration = rule_entry.get("NoncurrentVersionExpiration")
    if isinstance(noncurrent_expiration, dict) and noncurrent_expiration.get("NoncurrentDays") is not None:
        types.append("noncurrent_expiration")

    abort_incomplete = rule_entry.get("AbortIncompleteMultipartUpload")
    if isinstance(abort_incomplete, dict) and abort_incomplete.get("DaysAfterInitiation") is not None:
        types.append("abort_multipart")

    transitions = rule_entry.get("Transitions")
    if isinstance(transitions, list) and len(transitions) > 0:
        types.append("transition")
    elif isinstance(rule_entry.get("Transition"), dict):
        types.append("transition")

    noncurrent_transitions = rule_entry.get("NoncurrentVersionTransitions")
    if isinstance(noncurrent_transitions, list) and len(noncurrent_transitions) > 0:
        types.append("noncurrent_transition")
    elif isinstance(rule_entry.get("NoncurrentVersionTransition"), dict):
        types.append("noncurrent_transition")

    return types


def _feature_param_quantifier(rule: CephAdminBucketFilterRule) -> str:
    return "none" if (rule.quantifier or "").strip().lower() == "none" else "any"


def _lifecycle_rule_matches_param(
    lifecycle_rule: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    param = rule.param
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    if param == "lifecycle_rule_id":
        return _match_text_value(_extract_lifecycle_rule_id(lifecycle_rule), op, rule.value)
    if param == "lifecycle_rule_status":
        return _match_text_value(_extract_lifecycle_rule_status(lifecycle_rule), op, rule.value)
    if param == "lifecycle_rule_type":
        rule_types = _extract_lifecycle_rule_types(lifecycle_rule)
        if op == "has":
            return any(_match_text_value(value, "eq", rule.value) for value in rule_types)
        if op == "has_not":
            return not any(_match_text_value(value, "eq", rule.value) for value in rule_types)
        return False
    if param == "lifecycle_abort_multipart_present":
        present = extract_lifecycle_abort_days(lifecycle_rule) is not None
        if op == "has":
            return present
        if op == "has_not":
            return not present
        return False
    if param == "lifecycle_expiration_days":
        return _match_numeric_value(extract_lifecycle_expiration_days(lifecycle_rule), op, rule.value)
    if param == "lifecycle_noncurrent_expiration_days":
        return _match_numeric_value(extract_lifecycle_noncurrent_expiration_days(lifecycle_rule), op, rule.value)
    if param == "lifecycle_transition_days":
        transition_days = extract_lifecycle_transition_days(lifecycle_rule)
        return any(_match_numeric_value(days, op, rule.value) for days in transition_days)
    if param == "lifecycle_abort_multipart_days":
        return _match_numeric_value(extract_lifecycle_abort_days(lifecycle_rule), op, rule.value)
    return False


def _match_lifecycle_param_rule_individual(rule: CephAdminBucketFilterRule, lifecycle_rules: list[dict]) -> bool:
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(_lifecycle_rule_matches_param(item, rule, force_presence_positive=True) for item in lifecycle_rules)
    matched_any = any(_lifecycle_rule_matches_param(item, rule) for item in lifecycle_rules)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_lifecycle_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    lifecycle_rules: list[dict],
) -> bool:
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(
            all(_lifecycle_rule_matches_param(item, rule) for rule in positive_rules)
            for item in lifecycle_rules
        )

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(
                _lifecycle_rule_matches_param(item, rule, force_presence_positive=True)
                for item in lifecycle_rules
            )
        else:
            forbidden_match = any(_lifecycle_rule_matches_param(item, rule) for item in lifecycle_rules)
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _string_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _notification_rule_entries(configuration: object) -> list[tuple[str, dict]]:
    if not isinstance(configuration, dict):
        return []
    entries: list[tuple[str, dict]] = []
    for entry_type, config_key, _destination_key in _NOTIFICATION_CONFIGURATION_SPECS:
        raw_entries = configuration.get(config_key)
        if not isinstance(raw_entries, list):
            continue
        entries.extend((entry_type, entry) for entry in raw_entries if isinstance(entry, dict))
    return entries


def _extract_notification_rule_id(entry: dict) -> str | None:
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


def _extract_notification_topic_match_values(entry: dict) -> list[str]:
    values: list[str] = []
    for key in ("Topic", "TopicName", "topic", "topic_name", "EndpointTopic"):
        if (value := _string_or_none(entry.get(key))) is not None:
            values.append(value)
    topic_arn = _string_or_none(entry.get("TopicArn"))
    if topic_arn:
        values.append(topic_arn)
        values.append(_last_notification_identifier(topic_arn))
    return _dedupe_sorted_text_values(values)


def _extract_notification_events(entry: dict) -> list[str]:
    raw_events = entry.get("Events")
    if not isinstance(raw_events, list):
        raw_events = entry.get("events")
    if isinstance(raw_events, list):
        return [value for item in raw_events if (value := _string_or_none(item)) is not None]
    value = _string_or_none(raw_events)
    return [value] if value else []


def _extract_notification_filter_values(entry: dict, filter_name: str) -> list[str]:
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


def _match_text_candidates(values: list[str], op: str, right_raw: object) -> bool:
    if op == "neq":
        return not any(_match_text_value(value, "eq", right_raw) for value in values)
    return any(_match_text_value(value, op, right_raw) for value in values)


def _match_presence_values(values: list[str], op: str, right_raw: object) -> bool:
    if op == "has":
        return any(_match_text_value(value, "eq", right_raw) for value in values)
    if op == "has_not":
        return not any(_match_text_value(value, "eq", right_raw) for value in values)
    return False


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


def _extract_cors_rule_values(entry: dict, param: str) -> list[str]:
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
            values.extend(_extract_cors_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def _cors_rule_matches_param(
    entry: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    values = _extract_cors_rule_values(entry, rule.param or "")
    if op in {"has", "has_not"}:
        return _match_presence_values(values, op, rule.value)
    return _match_text_candidates(values, op, rule.value)


def _match_cors_param_rule_individual(rule: CephAdminBucketFilterRule, cors_rules: list[dict]) -> bool:
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(_cors_rule_matches_param(item, rule, force_presence_positive=True) for item in cors_rules)
    matched_any = any(_cors_rule_matches_param(item, rule) for item in cors_rules)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_cors_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    cors_rules: list[dict],
) -> bool:
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(all(_cors_rule_matches_param(item, rule) for rule in positive_rules) for item in cors_rules)

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(_cors_rule_matches_param(item, rule, force_presence_positive=True) for item in cors_rules)
        else:
            forbidden_match = any(_cors_rule_matches_param(item, rule) for item in cors_rules)
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _encryption_rule_entries(configuration: object) -> list[dict]:
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


def _extract_sse_rule_values(entry: dict, param: str) -> list[str]:
    default = _extract_sse_default(entry)
    if param == "sse_algorithm":
        return _text_list_from_keys(default, ("SSEAlgorithm", "sseAlgorithm", "sse_algorithm"))
    if param == "sse_kms_key_id":
        return _text_list_from_keys(default, ("KMSMasterKeyID", "kmsMasterKeyID", "kms_master_key_id", "KMSKeyId"))
    return []


def extract_sse_values(configuration: object, param: str) -> list[str]:
    values: list[str] = []
    for entry in _encryption_rule_entries(configuration):
        values.extend(_extract_sse_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def _sse_rule_matches_param(entry: dict, rule: CephAdminBucketFilterRule) -> bool:
    values = _extract_sse_rule_values(entry, rule.param or "")
    return _match_text_candidates(values, (rule.op or "").strip().lower(), rule.value)


def _match_sse_param_rule_individual(rule: CephAdminBucketFilterRule, configuration: object) -> bool:
    entries = _encryption_rule_entries(configuration)
    matched_any = any(_sse_rule_matches_param(item, rule) for item in entries)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_sse_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    configuration: object,
) -> bool:
    entries = _encryption_rule_entries(configuration)
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        if _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(all(_sse_rule_matches_param(item, rule) for rule in positive_rules) for item in entries)

    forbidden_ok = True
    for rule in forbidden_rules:
        if any(_sse_rule_matches_param(item, rule) for item in entries):
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _notification_rule_matches_param(
    entry_type: str,
    entry: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    param = rule.param
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    if param == "notification_rule_id":
        return _match_text_value(_extract_notification_rule_id(entry), op, rule.value)
    if param == "notification_rule_type":
        return _match_presence_values([entry_type], op, rule.value)
    if param == "notification_topic_name":
        if entry_type != "topic":
            return False
        return _match_text_candidates(_extract_notification_topic_match_values(entry), op, rule.value)
    if param == "notification_event":
        return _match_presence_values(_extract_notification_events(entry), op, rule.value)
    if param == "notification_filter_prefix":
        return _match_presence_values(_extract_notification_filter_values(entry, "prefix"), op, rule.value)
    if param == "notification_filter_suffix":
        return _match_presence_values(_extract_notification_filter_values(entry, "suffix"), op, rule.value)
    return False


def _match_notification_param_rule_individual(rule: CephAdminBucketFilterRule, configuration: object) -> bool:
    entries = _notification_rule_entries(configuration)
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(
            _notification_rule_matches_param(entry_type, entry, rule, force_presence_positive=True)
            for entry_type, entry in entries
        )
    matched_any = any(_notification_rule_matches_param(entry_type, entry, rule) for entry_type, entry in entries)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_notification_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    configuration: object,
) -> bool:
    entries = _notification_rule_entries(configuration)
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(
            all(_notification_rule_matches_param(entry_type, entry, rule) for rule in positive_rules)
            for entry_type, entry in entries
        )

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(
                _notification_rule_matches_param(entry_type, entry, rule, force_presence_positive=True)
                for entry_type, entry in entries
            )
        else:
            forbidden_match = any(
                _notification_rule_matches_param(entry_type, entry, rule)
                for entry_type, entry in entries
            )
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _extract_notification_eventbridge_present(configuration: object) -> bool | None:
    if not isinstance(configuration, dict):
        return None
    eventbridge = configuration.get("EventBridgeConfiguration")
    if eventbridge is None:
        eventbridge = configuration.get("eventBridgeConfiguration")
    return isinstance(eventbridge, dict)


def extract_notification_topic_names(configuration: object) -> list[str]:
    names: list[str] = []
    for entry_type, entry in _notification_rule_entries(configuration):
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
        isinstance(item, dict) and isinstance(item.get("Condition"), dict) and len(item.get("Condition", {}).keys()) > 0
        for item in statements
    )
    return len(statements), has_conditions


def _match_feature_param_rule(rule: CephAdminBucketFilterRule, snapshot: dict[str, object]) -> bool:
    feature = rule.feature
    param = rule.param
    op = (rule.op or "").strip().lower()
    if not feature or not param or not op:
        return False
    source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(param)
    if not source:
        return False
    source_data = snapshot.get(source, _FEATURE_PARAM_UNAVAILABLE)
    if source_data is _FEATURE_PARAM_UNAVAILABLE:
        return False

    if param in {
        "lifecycle_rule_id",
        "lifecycle_rule_status",
        "lifecycle_rule_type",
        "lifecycle_expiration_days",
        "lifecycle_noncurrent_expiration_days",
        "lifecycle_transition_days",
        "lifecycle_abort_multipart_present",
        "lifecycle_abort_multipart_days",
    }:
        lifecycle_rules = source_data if isinstance(source_data, list) else []
        return _match_lifecycle_param_rule_individual(rule, [item for item in lifecycle_rules if isinstance(item, dict)])
    if param in {
        "notification_rule_id",
        "notification_rule_type",
        "notification_topic_name",
        "notification_event",
        "notification_filter_prefix",
        "notification_filter_suffix",
    }:
        return _match_notification_param_rule_individual(rule, source_data)
    if param in {"sse_algorithm", "sse_kms_key_id"}:
        return _match_sse_param_rule_individual(rule, source_data)

    quantifier = _feature_param_quantifier(rule)

    def apply_scalar(result: bool) -> bool:
        return result if quantifier == "any" else (not result)

    if not isinstance(source_data, BucketProperties) and source == "props":
        return False
    if source == "props":
        props = source_data if isinstance(source_data, BucketProperties) else None
        if props is None:
            return False
        if param == "object_lock_mode":
            value = props.object_lock.mode if props.object_lock else None
            return apply_scalar(_match_text_value(value, op, rule.value))
        if param == "object_lock_retention_days":
            days = props.object_lock.days if props.object_lock else None
            return apply_scalar(_match_numeric_value(coerce_filter_number(days), op, rule.value))
        if param == "object_lock_retention_years":
            years = props.object_lock.years if props.object_lock else None
            return apply_scalar(_match_numeric_value(coerce_filter_number(years), op, rule.value))
        if param == "bpa_block_public_acls":
            value = props.public_access_block.block_public_acls if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_ignore_public_acls":
            value = props.public_access_block.ignore_public_acls if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_block_public_policy":
            value = props.public_access_block.block_public_policy if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_restrict_public_buckets":
            value = props.public_access_block.restrict_public_buckets if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param in {"cors_allowed_method", "cors_allowed_origin"}:
            rules = props.cors_rules if isinstance(props.cors_rules, list) else []
            return _match_cors_param_rule_individual(rule, [item for item in rules if isinstance(item, dict)])
        return False

    if source == "logging":
        if not isinstance(source_data, BucketLoggingConfiguration):
            return False
        target_bucket = (source_data.target_bucket or "").strip() if source_data.target_bucket else ""
        target_prefix = (source_data.target_prefix or "").strip() if source_data.target_prefix else ""
        if param == "logging_enabled":
            enabled = bool(source_data.enabled and target_bucket)
            return apply_scalar(_match_bool_value(enabled, op, rule.value))
        if param == "logging_target_bucket":
            return apply_scalar(_match_text_value(target_bucket or None, op, rule.value))
        if param == "logging_target_prefix":
            return apply_scalar(_match_text_value(target_prefix or None, op, rule.value))
        return False

    if source == "website":
        if not isinstance(source_data, BucketWebsiteConfiguration):
            return False
        index_document = (source_data.index_document or "").strip() if source_data.index_document else ""
        error_document = (source_data.error_document or "").strip() if source_data.error_document else ""
        redirect_host = ""
        if source_data.redirect_all_requests_to and source_data.redirect_all_requests_to.host_name:
            redirect_host = source_data.redirect_all_requests_to.host_name.strip()
        routing_rules = source_data.routing_rules if isinstance(source_data.routing_rules, list) else []
        if param == "website_index_present":
            index_present = bool(index_document)
            return apply_scalar(_match_bool_value(index_present, op, rule.value))
        if param == "website_index_document":
            return apply_scalar(_match_text_value(index_document or None, op, rule.value))
        if param == "website_error_document":
            return apply_scalar(_match_text_value(error_document or None, op, rule.value))
        if param == "website_redirect_host_present":
            redirect_present = bool(redirect_host)
            return apply_scalar(_match_bool_value(redirect_present, op, rule.value))
        if param == "website_redirect_host":
            return apply_scalar(_match_text_value(redirect_host or None, op, rule.value))
        if param == "website_routing_rule_count":
            return apply_scalar(_match_numeric_value(float(len(routing_rules)), op, rule.value))
        return False

    if source == "policy":
        policy = source_data if isinstance(source_data, dict) else None
        statement_count, has_conditions = extract_policy_statement_summary(policy)
        if param == "policy_statement_count":
            return apply_scalar(_match_numeric_value(float(statement_count), op, rule.value))
        if param == "policy_has_conditions":
            return apply_scalar(_match_bool_value(has_conditions, op, rule.value))
        return False

    if source == "notifications":
        if param == "notification_eventbridge_present":
            return apply_scalar(_match_bool_value(_extract_notification_eventbridge_present(source_data), op, rule.value))
        return False

    return False


def match_bucket_feature_param_rules(
    rules: list[CephAdminBucketFilterRule],
    match_mode: str,
    snapshot: dict[str, object],
) -> bool:
    if not rules:
        return True
    lifecycle_rules = [rule for rule in rules if rule.feature == "lifecycle_rules"]
    cors_rules = [rule for rule in rules if rule.feature == "cors" and rule.param in {"cors_allowed_method", "cors_allowed_origin"}]
    notification_entry_rules = [
        rule
        for rule in rules
        if rule.feature == "notifications" and rule.param != "notification_eventbridge_present"
    ]
    sse_rules = [rule for rule in rules if rule.feature == "server_side_encryption"]
    non_grouped_rules = [
        rule
        for rule in rules
        if rule.feature != "lifecycle_rules"
        and not (rule.feature == "cors" and rule.param in {"cors_allowed_method", "cors_allowed_origin"})
        and not (rule.feature == "notifications" and rule.param != "notification_eventbridge_present")
        and rule.feature != "server_side_encryption"
    ]
    results: list[bool] = []

    if lifecycle_rules:
        lifecycle_source = snapshot.get("lifecycle", _FEATURE_PARAM_UNAVAILABLE)
        if lifecycle_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(lifecycle_source, list):
            lifecycle_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(lifecycle_result)
        else:
            normalized = [item for item in lifecycle_source if isinstance(item, dict)]
            if match_mode == "all":
                results.append(_match_lifecycle_param_rules_all(lifecycle_rules, normalized))
            else:
                results.extend(_match_lifecycle_param_rule_individual(rule, normalized) for rule in lifecycle_rules)

    if cors_rules:
        props_source = snapshot.get("props", _FEATURE_PARAM_UNAVAILABLE)
        if props_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(props_source, BucketProperties):
            cors_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(cors_result)
        else:
            raw_rules = props_source.cors_rules if isinstance(props_source.cors_rules, list) else []
            normalized = [item for item in raw_rules if isinstance(item, dict)]
            if match_mode == "all":
                results.append(_match_cors_param_rules_all(cors_rules, normalized))
            else:
                results.extend(_match_cors_param_rule_individual(rule, normalized) for rule in cors_rules)

    if notification_entry_rules:
        notification_source = snapshot.get("notifications", _FEATURE_PARAM_UNAVAILABLE)
        if notification_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(notification_source, dict):
            notification_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(notification_result)
        elif match_mode == "all":
            results.append(_match_notification_param_rules_all(notification_entry_rules, notification_source))
        else:
            results.extend(_match_notification_param_rule_individual(rule, notification_source) for rule in notification_entry_rules)

    if sse_rules:
        encryption_source = snapshot.get("encryption", _FEATURE_PARAM_UNAVAILABLE)
        if encryption_source is _FEATURE_PARAM_UNAVAILABLE:
            sse_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(sse_result)
        elif match_mode == "all":
            results.append(_match_sse_param_rules_all(sse_rules, encryption_source))
        else:
            results.extend(_match_sse_param_rule_individual(rule, encryption_source) for rule in sse_rules)

    results.extend(_match_feature_param_rule(rule, snapshot) for rule in non_grouped_rules)
    return all(results) if match_mode == "all" else any(results)


def _required_feature_param_sources(rules: list[CephAdminBucketFilterRule]) -> set[str]:
    required: set[str] = set()
    for rule in rules:
        if not rule.param:
            continue
        source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(rule.param)
        if source:
            required.add(source)
    return required


def _load_feature_param_snapshot_for_bucket(
    bucket: CephAdminBucketSummary,
    required_sources: set[str],
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
) -> dict[str, object]:
    snapshot: dict[str, object] = {}
    if "props" in required_sources:
        try:
            snapshot["props"] = service.get_bucket_properties(bucket.name, account)
        except RuntimeError:
            snapshot["props"] = _FEATURE_PARAM_UNAVAILABLE
    if "lifecycle" in required_sources:
        try:
            snapshot["lifecycle"] = service.get_lifecycle(bucket.name, account).rules or []
        except RuntimeError:
            snapshot["lifecycle"] = _FEATURE_PARAM_UNAVAILABLE
    if "logging" in required_sources:
        try:
            snapshot["logging"] = service.get_bucket_logging(bucket.name, account)
        except RuntimeError:
            snapshot["logging"] = _FEATURE_PARAM_UNAVAILABLE
    if "website" in required_sources:
        try:
            snapshot["website"] = service.get_bucket_website(bucket.name, account)
        except RuntimeError:
            snapshot["website"] = _FEATURE_PARAM_UNAVAILABLE
    if "policy" in required_sources:
        try:
            snapshot["policy"] = service.get_policy(bucket.name, account)
        except RuntimeError:
            snapshot["policy"] = _FEATURE_PARAM_UNAVAILABLE
    if "notifications" in required_sources:
        if not account_sns_feature_enabled(account):
            snapshot["notifications"] = _FEATURE_PARAM_UNAVAILABLE
        else:
            try:
                snapshot["notifications"] = service.get_bucket_notifications(bucket.name, account).configuration or {}
            except RuntimeError:
                snapshot["notifications"] = _FEATURE_PARAM_UNAVAILABLE
    if "encryption" in required_sources:
        try:
            snapshot["encryption"] = service.get_bucket_encryption(bucket.name, account)
        except RuntimeError:
            snapshot["encryption"] = _FEATURE_PARAM_UNAVAILABLE
    return snapshot


def load_bucket_feature_param_snapshots(
    buckets: list[CephAdminBucketSummary],
    rules: list[CephAdminBucketFilterRule],
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "feature_param_enrichment",
    progress_message: str = "Loading bucket feature parameters",
    progress_start: int = 82,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    snapshots: dict[str, dict[str, object]] = {}
    if not buckets:
        return snapshots, set()
    required_sources = _required_feature_param_sources(rules)
    if not required_sources:
        available = {bucket_identity_key(bucket) for bucket in buckets}
        return snapshots, available

    def load_one(bucket: CephAdminBucketSummary) -> tuple[str, dict[str, object]]:
        return bucket_identity_key(bucket), _load_feature_param_snapshot_for_bucket(bucket, required_sources, service, account)

    max_workers = min(BUCKET_FEATURE_PARAM_MAX_WORKERS, len(buckets))
    total = len(buckets)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        for index, bucket in enumerate(buckets, start=1):
            invoke_cancel_check(cancel_check)
            key, snapshot = load_one(bucket)
            snapshots[key] = snapshot
            emit_progress(index)
            invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in buckets]
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(cancel_check)
                key, snapshot = future.result()
                snapshots[key] = snapshot
                emit_progress(index)
                invoke_cancel_check(cancel_check)

    available_keys: set[str] = set()
    for key, snapshot in snapshots.items():
        if all(snapshot.get(source, _FEATURE_PARAM_UNAVAILABLE) is not _FEATURE_PARAM_UNAVAILABLE for source in required_sources):
            available_keys.add(key)
    return snapshots, available_keys
