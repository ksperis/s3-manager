# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from app.models.bucket import (
    BucketLoggingConfiguration,
    BucketProperties,
    BucketWebsiteConfiguration,
)
from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_feature_param_values import (
    encryption_rule_entries,
    extract_cors_rule_values,
    extract_lifecycle_abort_days,
    extract_lifecycle_expiration_days,
    extract_lifecycle_noncurrent_expiration_days,
    extract_lifecycle_transition_days,
    extract_notification_eventbridge_present,
    extract_notification_events,
    extract_notification_filter_values,
    extract_notification_rule_id,
    extract_notification_topic_match_values,
    extract_policy_statement_summary,
    extract_sse_rule_values,
    notification_rule_entries,
)
from app.services.bucket_listing_shared import coerce_filter_bool, coerce_filter_number
from app.utils.normalize import normalize_text

FEATURE_PARAM_UNAVAILABLE = object()
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


def _params_for_source(source: str) -> frozenset[str]:
    return frozenset(param for param, candidate in _FEATURE_PARAM_SOURCE_BY_PARAM.items() if candidate == source)


_LIFECYCLE_PARAMS = _params_for_source("lifecycle")
_CORS_PARAMS = frozenset(param for param in _params_for_source("props") if param.startswith("cors_"))
_NOTIFICATION_ENTRY_PARAMS = _params_for_source("notifications") - {"notification_eventbridge_present"}
_SSE_PARAMS = _params_for_source("encryption")
_GROUPED_PARAMS_BY_FEATURE = {
    "lifecycle_rules": _LIFECYCLE_PARAMS,
    "cors": _CORS_PARAMS,
    "notifications": _NOTIFICATION_ENTRY_PARAMS,
    "server_side_encryption": _SSE_PARAMS,
}
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


def _feature_param_quantifier(rule: BucketFilterRule) -> str:
    return "none" if (rule.quantifier or "").strip().lower() == "none" else "any"


_GroupedEntry = TypeVar("_GroupedEntry")
_GroupedEntryMatcher = Callable[[_GroupedEntry, BucketFilterRule, bool], bool]


def _match_grouped_entry_rule_individual(
    rule: BucketFilterRule,
    entries: list[_GroupedEntry],
    matcher: _GroupedEntryMatcher[_GroupedEntry],
) -> bool:
    force_presence_positive = (rule.op or "").strip().lower() == "has_not"
    matched_any = any(matcher(entry, rule, force_presence_positive) for entry in entries)
    if force_presence_positive:
        return not matched_any
    return matched_any if _feature_param_quantifier(rule) == "any" else not matched_any


def _match_grouped_entry_rules_all(
    rules: list[BucketFilterRule],
    entries: list[_GroupedEntry],
    matcher: _GroupedEntryMatcher[_GroupedEntry],
) -> bool:
    positive_rules: list[BucketFilterRule] = []
    forbidden_rules: list[BucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    if positive_rules and not any(
        all(matcher(entry, rule, False) for rule in positive_rules)
        for entry in entries
    ):
        return False

    for rule in forbidden_rules:
        force_presence_positive = (rule.op or "").strip().lower() == "has_not"
        if any(matcher(entry, rule, force_presence_positive) for entry in entries):
            return False
    return True


def _lifecycle_rule_matches_param(
    lifecycle_rule: dict,
    rule: BucketFilterRule,
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


def _match_lifecycle_param_rule_individual(rule: BucketFilterRule, lifecycle_rules: list[dict]) -> bool:
    return _match_grouped_entry_rule_individual(
        rule,
        lifecycle_rules,
        _lifecycle_rule_matches_param,
    )


def _match_lifecycle_param_rules_all(
    rules: list[BucketFilterRule],
    lifecycle_rules: list[dict],
) -> bool:
    return _match_grouped_entry_rules_all(
        rules,
        lifecycle_rules,
        _lifecycle_rule_matches_param,
    )


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


def _cors_rule_matches_param(
    entry: dict,
    rule: BucketFilterRule,
    force_presence_positive: bool = False,
) -> bool:
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    values = extract_cors_rule_values(entry, rule.param or "")
    if op in {"has", "has_not"}:
        return _match_presence_values(values, op, rule.value)
    return _match_text_candidates(values, op, rule.value)


def _match_cors_param_rule_individual(rule: BucketFilterRule, cors_rules: list[dict]) -> bool:
    return _match_grouped_entry_rule_individual(
        rule,
        cors_rules,
        _cors_rule_matches_param,
    )


def _match_cors_param_rules_all(
    rules: list[BucketFilterRule],
    cors_rules: list[dict],
) -> bool:
    return _match_grouped_entry_rules_all(
        rules,
        cors_rules,
        _cors_rule_matches_param,
    )


def _sse_rule_matches_param(
    entry: dict,
    rule: BucketFilterRule,
    _force_presence_positive: bool = False,
) -> bool:
    values = extract_sse_rule_values(entry, rule.param or "")
    return _match_text_candidates(values, (rule.op or "").strip().lower(), rule.value)


def _match_sse_param_rule_individual(rule: BucketFilterRule, configuration: object) -> bool:
    return _match_grouped_entry_rule_individual(
        rule,
        encryption_rule_entries(configuration),
        _sse_rule_matches_param,
    )


def _match_sse_param_rules_all(
    rules: list[BucketFilterRule],
    configuration: object,
) -> bool:
    return _match_grouped_entry_rules_all(
        rules,
        encryption_rule_entries(configuration),
        _sse_rule_matches_param,
    )


def _notification_rule_matches_param(
    notification_entry: tuple[str, dict],
    rule: BucketFilterRule,
    force_presence_positive: bool = False,
) -> bool:
    entry_type, entry = notification_entry
    param = rule.param
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    if param == "notification_rule_id":
        return _match_text_value(extract_notification_rule_id(entry), op, rule.value)
    if param == "notification_rule_type":
        return _match_presence_values([entry_type], op, rule.value)
    if param == "notification_topic_name":
        if entry_type != "topic":
            return False
        return _match_text_candidates(extract_notification_topic_match_values(entry), op, rule.value)
    if param == "notification_event":
        return _match_presence_values(extract_notification_events(entry), op, rule.value)
    if param == "notification_filter_prefix":
        return _match_presence_values(extract_notification_filter_values(entry, "prefix"), op, rule.value)
    if param == "notification_filter_suffix":
        return _match_presence_values(extract_notification_filter_values(entry, "suffix"), op, rule.value)
    return False


def _match_notification_param_rule_individual(rule: BucketFilterRule, configuration: object) -> bool:
    entries = notification_rule_entries(configuration)
    return _match_grouped_entry_rule_individual(
        rule,
        entries,
        _notification_rule_matches_param,
    )


def _match_notification_param_rules_all(
    rules: list[BucketFilterRule],
    configuration: object,
) -> bool:
    entries = notification_rule_entries(configuration)
    return _match_grouped_entry_rules_all(
        rules,
        entries,
        _notification_rule_matches_param,
    )


def _apply_scalar_quantifier(rule: BucketFilterRule, result: bool) -> bool:
    return result if _feature_param_quantifier(rule) == "any" else not result


def _match_properties_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketProperties):
        return False
    props = source_data
    param = rule.param
    if param == "object_lock_mode":
        value = props.object_lock.mode if props.object_lock else None
        result = _match_text_value(value, op, rule.value)
    elif param == "object_lock_retention_days":
        value = props.object_lock.days if props.object_lock else None
        result = _match_numeric_value(coerce_filter_number(value), op, rule.value)
    elif param == "object_lock_retention_years":
        value = props.object_lock.years if props.object_lock else None
        result = _match_numeric_value(coerce_filter_number(value), op, rule.value)
    elif param == "bpa_block_public_acls":
        value = props.public_access_block.block_public_acls if props.public_access_block else None
        result = _match_bool_value(value, op, rule.value)
    elif param == "bpa_ignore_public_acls":
        value = props.public_access_block.ignore_public_acls if props.public_access_block else None
        result = _match_bool_value(value, op, rule.value)
    elif param == "bpa_block_public_policy":
        value = props.public_access_block.block_public_policy if props.public_access_block else None
        result = _match_bool_value(value, op, rule.value)
    elif param == "bpa_restrict_public_buckets":
        value = props.public_access_block.restrict_public_buckets if props.public_access_block else None
        result = _match_bool_value(value, op, rule.value)
    elif param in _CORS_PARAMS:
        rules = props.cors_rules if isinstance(props.cors_rules, list) else []
        return _match_cors_param_rule_individual(rule, [item for item in rules if isinstance(item, dict)])
    else:
        return False
    return _apply_scalar_quantifier(rule, result)


def _match_logging_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketLoggingConfiguration):
        return False
    target_bucket = (source_data.target_bucket or "").strip()
    target_prefix = (source_data.target_prefix or "").strip()
    if rule.param == "logging_enabled":
        result = _match_bool_value(bool(source_data.enabled and target_bucket), op, rule.value)
    elif rule.param == "logging_target_bucket":
        result = _match_text_value(target_bucket or None, op, rule.value)
    elif rule.param == "logging_target_prefix":
        result = _match_text_value(target_prefix or None, op, rule.value)
    else:
        return False
    return _apply_scalar_quantifier(rule, result)


def _match_website_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketWebsiteConfiguration):
        return False
    index_document = (source_data.index_document or "").strip()
    error_document = (source_data.error_document or "").strip()
    redirect_host = (
        (source_data.redirect_all_requests_to.host_name or "").strip()
        if source_data.redirect_all_requests_to
        else ""
    )
    routing_rules = source_data.routing_rules if isinstance(source_data.routing_rules, list) else []
    if rule.param == "website_index_present":
        result = _match_bool_value(bool(index_document), op, rule.value)
    elif rule.param == "website_index_document":
        result = _match_text_value(index_document or None, op, rule.value)
    elif rule.param == "website_error_document":
        result = _match_text_value(error_document or None, op, rule.value)
    elif rule.param == "website_redirect_host_present":
        result = _match_bool_value(bool(redirect_host), op, rule.value)
    elif rule.param == "website_redirect_host":
        result = _match_text_value(redirect_host or None, op, rule.value)
    elif rule.param == "website_routing_rule_count":
        result = _match_numeric_value(float(len(routing_rules)), op, rule.value)
    else:
        return False
    return _apply_scalar_quantifier(rule, result)


def _match_policy_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    policy = source_data if isinstance(source_data, dict) else None
    statement_count, has_conditions = extract_policy_statement_summary(policy)
    if rule.param == "policy_statement_count":
        result = _match_numeric_value(float(statement_count), op, rule.value)
    elif rule.param == "policy_has_conditions":
        result = _match_bool_value(has_conditions, op, rule.value)
    else:
        return False
    return _apply_scalar_quantifier(rule, result)


def _match_notification_scalar_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if rule.param != "notification_eventbridge_present":
        return False
    result = _match_bool_value(extract_notification_eventbridge_present(source_data), op, rule.value)
    return _apply_scalar_quantifier(rule, result)


_SCALAR_SOURCE_MATCHERS: dict[str, Callable[[BucketFilterRule, object, str], bool]] = {
    "props": _match_properties_param_rule,
    "logging": _match_logging_param_rule,
    "website": _match_website_param_rule,
    "policy": _match_policy_param_rule,
    "notifications": _match_notification_scalar_param_rule,
}


def _match_feature_param_rule(rule: BucketFilterRule, snapshot: dict[str, object]) -> bool:
    param = rule.param
    op = (rule.op or "").strip().lower()
    if not rule.feature or not param or not op:
        return False
    source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(param)
    if not source:
        return False
    source_data = snapshot.get(source, FEATURE_PARAM_UNAVAILABLE)
    if source_data is FEATURE_PARAM_UNAVAILABLE:
        return False

    if param in _LIFECYCLE_PARAMS:
        lifecycle_rules = source_data if isinstance(source_data, list) else []
        normalized_rules = [item for item in lifecycle_rules if isinstance(item, dict)]
        return _match_lifecycle_param_rule_individual(rule, normalized_rules)
    if param in _NOTIFICATION_ENTRY_PARAMS:
        return _match_notification_param_rule_individual(rule, source_data)
    if param in _SSE_PARAMS:
        return _match_sse_param_rule_individual(rule, source_data)

    matcher = _SCALAR_SOURCE_MATCHERS.get(source)
    return matcher(rule, source_data, op) if matcher else False


def _normalize_lifecycle_group_source(source_data: object) -> object:
    if not isinstance(source_data, list):
        return FEATURE_PARAM_UNAVAILABLE
    return [item for item in source_data if isinstance(item, dict)]


def _normalize_cors_group_source(source_data: object) -> object:
    if not isinstance(source_data, BucketProperties):
        return FEATURE_PARAM_UNAVAILABLE
    raw_rules = source_data.cors_rules if isinstance(source_data.cors_rules, list) else []
    return [item for item in raw_rules if isinstance(item, dict)]


def _normalize_notification_group_source(source_data: object) -> object:
    return source_data if isinstance(source_data, dict) else FEATURE_PARAM_UNAVAILABLE


def _identity_group_source(source_data: object) -> object:
    return source_data


_GroupedRulesMatcher = Callable[[list[BucketFilterRule], Any], bool]
_GroupedRuleMatcher = Callable[[BucketFilterRule, Any], bool]
_GroupedRuleSpec = tuple[
    str,
    Callable[[object], object],
    _GroupedRulesMatcher,
    _GroupedRuleMatcher,
]
_GROUPED_RULE_SPECS: dict[str, _GroupedRuleSpec] = {
    "lifecycle_rules": (
        "lifecycle",
        _normalize_lifecycle_group_source,
        _match_lifecycle_param_rules_all,
        _match_lifecycle_param_rule_individual,
    ),
    "cors": (
        "props",
        _normalize_cors_group_source,
        _match_cors_param_rules_all,
        _match_cors_param_rule_individual,
    ),
    "notifications": (
        "notifications",
        _normalize_notification_group_source,
        _match_notification_param_rules_all,
        _match_notification_param_rule_individual,
    ),
    "server_side_encryption": (
        "encryption",
        _identity_group_source,
        _match_sse_param_rules_all,
        _match_sse_param_rule_individual,
    ),
}


def _match_grouped_param_rules(
    rules: list[BucketFilterRule],
    match_mode: str,
    source_data: object,
    normalize_source: Callable[[object], object],
    match_all: _GroupedRulesMatcher,
    match_one: _GroupedRuleMatcher,
) -> list[bool]:
    if not rules or source_data is FEATURE_PARAM_UNAVAILABLE:
        return [] if not rules else [False]
    normalized_source = normalize_source(source_data)
    if normalized_source is FEATURE_PARAM_UNAVAILABLE:
        return [False]
    if match_mode == "all":
        return [match_all(rules, normalized_source)]
    return [match_one(rule, normalized_source) for rule in rules]


def match_bucket_feature_param_rules(
    rules: list[BucketFilterRule],
    match_mode: str,
    snapshot: dict[str, object],
) -> bool:
    if not rules:
        return True
    grouped_rules: dict[str, list[BucketFilterRule]] = {
        feature: [] for feature in _GROUPED_RULE_SPECS
    }
    non_grouped_rules: list[BucketFilterRule] = []
    for rule in rules:
        feature = rule.feature or ""
        grouped_params = _GROUPED_PARAMS_BY_FEATURE.get(feature)
        if grouped_params and rule.param in grouped_params:
            grouped_rules[feature].append(rule)
        else:
            non_grouped_rules.append(rule)

    results: list[bool] = []

    for feature, (source, normalize_source, match_all, match_one) in _GROUPED_RULE_SPECS.items():
        results.extend(
            _match_grouped_param_rules(
                grouped_rules[feature],
                match_mode,
                snapshot.get(source, FEATURE_PARAM_UNAVAILABLE),
                normalize_source,
                match_all,
                match_one,
            )
        )

    results.extend(_match_feature_param_rule(rule, snapshot) for rule in non_grouped_rules)
    return all(results) if match_mode == "all" else any(results)


def required_feature_param_sources(rules: list[BucketFilterRule]) -> set[str]:
    required: set[str] = set()
    for rule in rules:
        if not rule.param:
            continue
        source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(rule.param)
        if source:
            required.add(source)
    return required
