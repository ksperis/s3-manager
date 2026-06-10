# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.db import S3Account
from app.models.bucket import (
    FeatureRuleInventoryBucket,
    FeatureRuleInventoryFeature,
    FeatureRuleInventoryRule,
)
from app.routers.dependencies import get_account_context, get_current_account_admin
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    normalize_bucket_notification_configuration,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.utils.concurrency import bounded_ordered_map

router = APIRouter(prefix="/manager/feature-rules", tags=["manager-feature-rules"])
MANAGER_FEATURE_RULE_INVENTORY_MAX_WORKERS = 8


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _as_record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _display_value(value: Any, *, max_items: int = 3) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        rendered = [_display_value(item, max_items=max_items) for item in value[:max_items]]
        remaining = len(value) - len(rendered)
        suffix = f", +{remaining}" if remaining > 0 else ""
        return ", ".join(item for item in rendered if item) + suffix
    if isinstance(value, dict):
        rendered = [
            f"{key}: {_display_value(entry, max_items=max_items)}"
            for key, entry in list(value.items())[:max_items]
        ]
        remaining = len(value) - len(rendered)
        suffix = f"; +{remaining}" if remaining > 0 else ""
        return "; ".join(item for item in rendered if item) + suffix
    return ""


def _join_parts(parts: list[str | None], *, fallback: str) -> str:
    cleaned = [part for part in parts if part]
    return " · ".join(cleaned) if cleaned else fallback


def _rule_filter_summary(rule: dict[str, Any]) -> str | None:
    top_level_prefix = _string_value(rule.get("Prefix"))
    if top_level_prefix:
        return f"Prefix: {top_level_prefix}"

    filter_value = _as_record(rule.get("Filter"))
    if not filter_value:
        return None

    prefix = _string_value(filter_value.get("Prefix"))
    if prefix:
        return f"Prefix: {prefix}"

    tag = _as_record(filter_value.get("Tag"))
    if tag:
        key = _string_value(tag.get("Key"))
        value = _string_value(tag.get("Value"))
        if key and value:
            return f"Tag: {key}={value}"
        if key:
            return f"Tag: {key}"

    and_filter = _as_record(filter_value.get("And"))
    if and_filter:
        and_prefix = _string_value(and_filter.get("Prefix"))
        tags = []
        for entry in _list_value(and_filter.get("Tags")):
            tag_entry = _as_record(entry)
            if not tag_entry:
                continue
            key = _string_value(tag_entry.get("Key"))
            value = _string_value(tag_entry.get("Value"))
            if key and value:
                tags.append(f"{key}={value}")
            elif key:
                tags.append(key)
        return _join_parts(
            [f"Prefix: {and_prefix}" if and_prefix else None, f"Tags: {', '.join(tags)}" if tags else None],
            fallback="Combined filter",
        )

    return None


def _lifecycle_action_summary(rule: dict[str, Any]) -> str:
    actions: list[str] = []
    expiration = _as_record(rule.get("Expiration"))
    if expiration and expiration.get("Days") is not None:
        actions.append(f"expire current after {expiration.get('Days')}d")
    if expiration and expiration.get("ExpiredObjectDeleteMarker"):
        actions.append("delete expired markers")

    noncurrent = _as_record(rule.get("NoncurrentVersionExpiration"))
    if noncurrent and noncurrent.get("NoncurrentDays") is not None:
        actions.append(f"expire noncurrent after {noncurrent.get('NoncurrentDays')}d")

    multipart = _as_record(rule.get("AbortIncompleteMultipartUpload"))
    if multipart and multipart.get("DaysAfterInitiation") is not None:
        actions.append(f"abort multipart after {multipart.get('DaysAfterInitiation')}d")

    transitions = _list_value(rule.get("Transitions"))
    if transitions:
        actions.append(f"{len(transitions)} transition(s)")

    noncurrent_transitions = _list_value(rule.get("NoncurrentVersionTransitions"))
    if noncurrent_transitions:
        actions.append(f"{len(noncurrent_transitions)} noncurrent transition(s)")

    return " · ".join(actions) if actions else "No actions detected"


def _normalize_lifecycle_rules(rules: list[dict[str, Any]]) -> list[FeatureRuleInventoryRule]:
    normalized: list[FeatureRuleInventoryRule] = []
    for index, raw_rule in enumerate(rules):
        rule = _as_record(raw_rule)
        if not rule:
            continue
        rule_id = (
            _string_value(rule.get("ID"))
            or _string_value(rule.get("Id"))
            or _string_value(rule.get("id"))
            or f"Rule {index + 1}"
        )
        status = _string_value(rule.get("Status")) or _string_value(rule.get("status")) or "Enabled"
        filter_summary = _rule_filter_summary(rule)
        action_summary = _lifecycle_action_summary(rule)
        chips = [status]
        if filter_summary:
            chips.append(filter_summary)
        normalized.append(
            FeatureRuleInventoryRule(
                id=rule_id,
                type="lifecycle",
                title=rule_id,
                summary=_join_parts([filter_summary, action_summary], fallback="Lifecycle rule"),
                chips=chips,
                raw=rule,
            )
        )
    return normalized


def _policy_statements(policy: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not policy:
        return []
    raw_statements = policy.get("Statement") or policy.get("statement")
    if isinstance(raw_statements, list):
        return [statement for statement in raw_statements if _is_record(statement)]
    if _is_record(raw_statements):
        return [raw_statements]
    return []


def _statement_field(statement: dict[str, Any], field: str) -> Any:
    lower_camel = f"{field[0].lower()}{field[1:]}"
    return statement.get(field) or statement.get(lower_camel) or statement.get(field.lower())


def _normalize_policy_rules(policy: dict[str, Any] | None) -> list[FeatureRuleInventoryRule]:
    normalized: list[FeatureRuleInventoryRule] = []
    for index, statement in enumerate(_policy_statements(policy)):
        sid = _string_value(statement.get("Sid")) or _string_value(statement.get("sid")) or f"Statement {index + 1}"
        effect = _string_value(statement.get("Effect")) or _string_value(statement.get("effect")) or "-"
        principal = (
            statement.get("Principal")
            or statement.get("principal")
            or statement.get("NotPrincipal")
            or statement.get("notPrincipal")
            or statement.get("notprincipal")
        )
        action = _statement_field(statement, "Action")
        not_action = _statement_field(statement, "NotAction")
        resource = _statement_field(statement, "Resource")
        not_resource = _statement_field(statement, "NotResource")
        action_label = "NotAction" if action is None and not_action is not None else "Action"
        resource_label = "NotResource" if resource is None and not_resource is not None else "Resource"
        action_value = action if action is not None else not_action
        resource_value = resource if resource is not None else not_resource
        has_condition = _is_record(statement.get("Condition") or statement.get("condition"))
        chips = [effect]
        if has_condition:
            chips.append("Condition")
        normalized.append(
            FeatureRuleInventoryRule(
                id=sid,
                type="policy",
                title=f"{effect} {sid}",
                summary=_join_parts(
                    [
                        f"Principal: {_display_value(principal)}" if principal is not None else None,
                        f"{action_label}: {_display_value(action_value)}" if action_value is not None else None,
                        f"{resource_label}: {_display_value(resource_value)}" if resource_value is not None else None,
                    ],
                    fallback="Bucket policy statement",
                ),
                chips=chips,
                raw=statement,
            )
        )
    return normalized


def _normalize_cors_rules(rules: list[dict[str, Any]]) -> list[FeatureRuleInventoryRule]:
    normalized: list[FeatureRuleInventoryRule] = []
    for index, raw_rule in enumerate(rules):
        rule = _as_record(raw_rule)
        if not rule:
            continue
        methods = _display_value(rule.get("AllowedMethods") or rule.get("allowedMethods") or [])
        origins = _display_value(rule.get("AllowedOrigins") or rule.get("allowedOrigins") or [])
        headers = _display_value(rule.get("AllowedHeaders") or rule.get("allowedHeaders") or [])
        expose = _display_value(rule.get("ExposeHeaders") or rule.get("exposeHeaders") or [])
        max_age = rule.get("MaxAgeSeconds") or rule.get("maxAgeSeconds")
        chips = []
        if methods:
            chips.append(methods)
        normalized.append(
            FeatureRuleInventoryRule(
                id=f"Rule {index + 1}",
                type="cors",
                title=origins or f"CORS rule {index + 1}",
                summary=_join_parts(
                    [
                        f"Allowed headers: {headers}" if headers else None,
                        f"Exposed headers: {expose}" if expose else None,
                        f"Max age: {max_age}s" if max_age is not None else None,
                    ],
                    fallback="No header or max-age details",
                ),
                chips=chips,
                raw=rule,
            )
        )
    return normalized


def _notification_filter_summary(rule: dict[str, Any]) -> str | None:
    raw_filter = _as_record(rule.get("Filter"))
    key = _as_record(raw_filter.get("Key")) if raw_filter else None
    filter_rules = _list_value(key.get("FilterRules") if key else None)
    parts: list[str] = []
    for entry in filter_rules:
        item = _as_record(entry)
        if not item:
            continue
        name = _string_value(item.get("Name"))
        value = _string_value(item.get("Value"))
        if name and value:
            parts.append(f"{name}: {value}")
    return ", ".join(parts) if parts else None


def _notification_destination(config_type: str, rule: dict[str, Any]) -> str:
    field_by_type = {
        "topic": "TopicArn",
        "queue": "QueueArn",
        "lambda": "LambdaFunctionArn",
    }
    value = _string_value(rule.get(field_by_type.get(config_type, "")))
    if not value:
        return "-"
    return value.rsplit(":", 1)[-1] or value


def _normalize_notification_entry(config_type: str, raw_rule: dict[str, Any], index: int) -> FeatureRuleInventoryRule:
    rule_id = _string_value(raw_rule.get("Id")) or _string_value(raw_rule.get("ID")) or f"{config_type.title()} {index + 1}"
    events = _display_value(raw_rule.get("Events") or [])
    destination = _notification_destination(config_type, raw_rule)
    filter_summary = _notification_filter_summary(raw_rule)
    chips = [config_type.title()]
    if filter_summary:
        chips.append(filter_summary)
    return FeatureRuleInventoryRule(
        id=rule_id,
        type=config_type,
        title=f"{config_type.title()} {destination}",
        summary=_join_parts(
            [
                f"Events: {events}" if events else None,
                f"Destination: {destination}" if destination and destination != "-" else None,
                f"Filter: {filter_summary}" if filter_summary else None,
            ],
            fallback=f"{config_type.title()} notification",
        ),
        chips=chips,
        raw=raw_rule,
    )


def _normalize_notification_rules(configuration: dict[str, Any]) -> list[FeatureRuleInventoryRule]:
    normalized_config = normalize_bucket_notification_configuration(configuration)
    rules: list[FeatureRuleInventoryRule] = []
    specs = [
        ("topic", "TopicConfigurations"),
        ("queue", "QueueConfigurations"),
        ("lambda", "LambdaFunctionConfigurations"),
    ]
    for config_type, key in specs:
        for index, raw_entry in enumerate(_list_value(normalized_config.get(key))):
            entry = _as_record(raw_entry)
            if entry:
                rules.append(_normalize_notification_entry(config_type, entry, index))

    raw_event_bridge = configuration.get("EventBridgeConfiguration")
    if _is_record(raw_event_bridge):
        event_bridge_raw = {"EventBridgeConfiguration": raw_event_bridge}
        rules.append(
            FeatureRuleInventoryRule(
                id="EventBridge",
                type="eventbridge",
                title="EventBridge",
                summary="Send bucket events to EventBridge",
                chips=["EventBridge"],
                raw=event_bridge_raw,
            )
        )
    return rules


def _bucket_result(
    *,
    bucket_name: str,
    feature: FeatureRuleInventoryFeature,
    rules: list[FeatureRuleInventoryRule],
) -> FeatureRuleInventoryBucket:
    return FeatureRuleInventoryBucket(
        bucket_name=bucket_name,
        feature=feature,
        status="configured" if rules else "empty",
        rules=rules,
    )


def _unavailable_bucket(bucket_name: str, feature: FeatureRuleInventoryFeature, error: str) -> FeatureRuleInventoryBucket:
    return FeatureRuleInventoryBucket(
        bucket_name=bucket_name,
        feature=feature,
        status="unavailable",
        rules=[],
        error=error,
    )


@router.get("", response_model=list[FeatureRuleInventoryBucket])
def list_feature_rule_inventory(
    feature: FeatureRuleInventoryFeature = Query(..., description="Bucket feature to inventory."),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(get_current_account_admin),
) -> list[FeatureRuleInventoryBucket]:
    try:
        buckets = service.list_buckets(account, with_stats=False)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

    if feature == "notifications" and not account_sns_feature_enabled(account):
        return [
            _unavailable_bucket(
                bucket.name,
                feature,
                "SNS notifications are disabled for this endpoint.",
            )
            for bucket in buckets
        ]

    def load_bucket_rules(bucket) -> FeatureRuleInventoryBucket:  # noqa: ANN001
        try:
            if feature == "lifecycle":
                lifecycle = service.get_lifecycle(bucket.name, account)
                return _bucket_result(
                    bucket_name=bucket.name,
                    feature=feature,
                    rules=_normalize_lifecycle_rules(lifecycle.rules or []),
                )
            if feature == "policy":
                return _bucket_result(
                    bucket_name=bucket.name,
                    feature=feature,
                    rules=_normalize_policy_rules(service.get_policy(bucket.name, account)),
                )
            if feature == "cors":
                return _bucket_result(
                    bucket_name=bucket.name,
                    feature=feature,
                    rules=_normalize_cors_rules(service.get_bucket_cors(bucket.name, account) or []),
                )
            notifications = service.get_bucket_notifications(bucket.name, account)
            return _bucket_result(
                bucket_name=bucket.name,
                feature=feature,
                rules=_normalize_notification_rules(notifications.configuration or {}),
            )
        except RuntimeError as exc:
            return _unavailable_bucket(bucket.name, feature, str(exc))

    return bounded_ordered_map(
        buckets,
        load_bucket_rules,
        max_workers=MANAGER_FEATURE_RULE_INVENTORY_MAX_WORKERS,
        thread_name_prefix=f"manager-feature-rule-{feature}",
    )
