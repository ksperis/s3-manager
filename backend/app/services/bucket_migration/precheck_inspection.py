# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from botocore.exceptions import BotoCoreError, ClientError

from app.core.sensitive_data import sanitized_error_log_detail
from app.utils.aws_errors import aws_error_code
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config


_ALWAYS_PROBED_FEATURES = frozenset(
    {
        "versioning",
        "object_lock",
        "encryption",
    }
)
_COPY_SETTINGS_ONLY_FEATURES = frozenset(
    {
        "public_access_block",
        "lifecycle",
        "cors",
        "tags",
        "access_logging",
        "bucket_policy",
        "acl",
        "website",
        "notifications",
        "replication",
    }
)
_ENDPOINT_CAPABILITY_BY_FEATURE = {
    "website": "static_website",
    "notifications": "sns",
    "encryption": "sse",
    "replication": "replication",
}


def _normalized_sse_rule(rule: Any) -> tuple[str | None, str | None]:
    if not isinstance(rule, dict):
        return None, None
    apply = rule.get("ApplyServerSideEncryptionByDefault") or {}
    if not isinstance(apply, dict):
        return None, None
    algorithm = str(apply.get("SSEAlgorithm") or "").strip() or None
    kms_key_id = str(apply.get("KMSMasterKeyID") or "").strip() or None
    return algorithm, kms_key_id


def _bucket_acl_is_default_private(acl: Any) -> bool:
    grants = getattr(acl, "grants", None) or []
    owner = str(getattr(acl, "owner", None) or "").strip() or None
    if not grants:
        return True
    if len(grants) != 1:
        return False
    grant = grants[0]
    permission = str(getattr(grant, "permission", "") or "").strip().upper()
    grantee = getattr(grant, "grantee", None)
    grantee_uri = str(getattr(grantee, "uri", "") or "").strip() or None
    grantee_name = str(getattr(grantee, "display_name", "") or "").strip() or None
    return permission == "FULL_CONTROL" and grantee_uri is None and (
        owner is None or grantee_name is None or grantee_name == owner
    )


def _website_is_configured(website: Any) -> bool:
    if website is None:
        return False
    index_document = str(getattr(website, "index_document", "") or "").strip()
    error_document = str(getattr(website, "error_document", "") or "").strip()
    redirect = getattr(website, "redirect_all_requests_to", None)
    redirect_host = str(getattr(redirect, "host_name", "") or "").strip() if redirect is not None else ""
    routing_rules = getattr(website, "routing_rules", None) or []
    return bool(index_document or error_document or redirect_host or routing_rules)


def _logging_is_configured(logging_cfg: Any) -> bool:
    if logging_cfg is None:
        return False
    enabled = bool(getattr(logging_cfg, "enabled", False))
    target_bucket = str(getattr(logging_cfg, "target_bucket", "") or "").strip()
    return bool(enabled and target_bucket)


def _feature_availability_entry(
    *,
    state: str,
    capability: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"state": state}
    if capability:
        payload["capability"] = capability
    if reason:
        payload["reason"] = reason
    return payload


def _is_probe_unavailable_error(exc: Exception) -> bool:
    text = str(exc).strip().lower()
    return any(
        token in text
        for token in (
            "methodnotallowed",
            "method not allowed",
            "notimplemented",
            "not implemented",
            "notsupported",
            "not supported",
            "httpstatuscode': 405",
            "httpstatuscode\": 405",
            "status code: 405",
            "(405)",
        )
    )


class _BucketFeatureProbe:
    def __init__(
        self,
        *,
        policy: set[str],
        endpoint_capabilities: dict[str, bool],
    ) -> None:
        self.policy = policy
        self.endpoint_capabilities = endpoint_capabilities
        self.availability: dict[str, dict[str, Any]] = {}
        self.skipped: list[str] = []

    def mark(
        self,
        feature: str,
        *,
        state: str,
        capability: str | None = None,
        reason: str | None = None,
    ) -> None:
        self.availability[feature] = _feature_availability_entry(
            state=state,
            capability=capability,
            reason=reason,
        )
        if state == "skipped_not_required" and feature not in self.skipped:
            self.skipped.append(feature)

    def fetch(
        self,
        feature: str,
        fetcher: Callable[[], Any],
        *,
        soft_unavailable: bool,
        default: Any,
    ) -> Any:
        should_skip, capability = self._should_skip(feature)
        if should_skip:
            return default
        try:
            value = fetcher()
        except Exception as exc:  # noqa: BLE001
            if soft_unavailable and _is_probe_unavailable_error(exc):
                self.mark(
                    feature,
                    state="unavailable",
                    capability=capability,
                    reason=sanitized_error_log_detail(exc),
                )
                return default
            raise
        self.mark(feature, state="available", capability=capability)
        return value

    def _should_skip(self, feature: str) -> tuple[bool, str | None]:
        capability = _ENDPOINT_CAPABILITY_BY_FEATURE.get(feature)
        if feature not in self.policy:
            self.mark(
                feature,
                state="skipped_not_required",
                capability=capability,
                reason="not_required",
            )
            return True, capability
        if capability and self.endpoint_capabilities.get(capability) is False:
            self.mark(
                feature,
                state="disabled_by_endpoint",
                capability=capability,
                reason="endpoint_capability_disabled",
            )
            return True, capability
        return False, capability


@dataclass(frozen=True)
class _BucketInspectionValues:
    versioning_status: str | None
    object_lock: Any
    encryption: Any
    policy: Any
    logging: Any
    tags: Any
    lifecycle: Any
    cors: Any
    public_access_block: Any
    website: Any
    notifications: Any
    replication: Any
    acl: Any
    version_scan: dict[str, Any]


def _encryption_profile(encryption: Any) -> dict[str, Any]:
    rules = list(getattr(encryption, "rules", None) or [])
    algorithms: list[str] = []
    kms_keys: list[str] = []
    supported = True
    unsupported_reason: str | None = None
    for rule in rules:
        algorithm, kms_key_id = _normalized_sse_rule(rule)
        if algorithm:
            algorithms.append(algorithm)
        if kms_key_id:
            kms_keys.append(kms_key_id)
        if algorithm and algorithm != "AES256":
            supported = False
            unsupported_reason = (
                f"default encryption algorithm '{algorithm}' is not supported"
            )
        if kms_key_id:
            supported = False
            unsupported_reason = "default SSE-KMS encryption is not supported"
    return {
        "enabled": bool(rules),
        "supported": supported,
        "algorithms": sorted(set(algorithms)),
        "kms_key_ids": sorted(set(kms_keys)),
        "unsupported_reason": unsupported_reason,
        "rule_count": len(rules),
    }


def _unsupported_settings(values: _BucketInspectionValues) -> list[str]:
    unsupported: list[str] = []
    if values.acl is not None and not _bucket_acl_is_default_private(values.acl):
        unsupported.append("acl")
    if _website_is_configured(values.website):
        unsupported.append("website")
    if bool(getattr(values.notifications, "configuration", None)):
        unsupported.append("notifications")
    replication = getattr(values.replication, "configuration", None) or {}
    if isinstance(replication, dict) and bool(replication.get("Rules")):
        unsupported.append("replication")
    return unsupported


def _supported_settings(
    values: _BucketInspectionValues,
    encryption_profile: dict[str, Any],
) -> dict[str, bool | None]:
    lifecycle = (
        bool(getattr(values.lifecycle, "rules", None) or [])
        if values.lifecycle is not None
        else None
    )
    return {
        "versioning": bool(values.versioning_status),
        "object_lock": bool(values.object_lock and values.object_lock.enabled),
        "encryption": bool(encryption_profile["enabled"]),
        "public_access_block": bool(values.public_access_block),
        "lifecycle": lifecycle,
        "cors": bool(values.cors or []),
        "tags": bool(values.tags),
        "access_logging": _logging_is_configured(values.logging),
        "bucket_policy": bool(values.policy),
    }


class BucketMigrationInspector:
    def __init__(self, service: Any) -> None:
        self._service = service

    def build_probe_policy(self, *, copy_bucket_settings: bool) -> frozenset[str]:
        if copy_bucket_settings:
            return _ALWAYS_PROBED_FEATURES | _COPY_SETTINGS_ONLY_FEATURES
        return _ALWAYS_PROBED_FEATURES

    def _endpoint_capabilities(self, ctx: Any) -> dict[str, bool]:
        account = getattr(ctx, "account", None)
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            return {}
        try:
            features = normalize_features_config(endpoint.provider, endpoint.features_config)
        except Exception:  # noqa: BLE001
            return {}
        raw = features_to_capabilities(features)
        return {str(key): bool(value) for key, value in raw.items()}

    def scan_bucket_versions(self, ctx: Any, bucket_name: str) -> dict[str, Any]:
        client = self._service._context_client(ctx)
        key_marker: str | None = None
        version_marker: str | None = None
        current_count = 0
        noncurrent_count = 0
        delete_marker_count = 0
        sample_version: dict[str, Any] | None = None
        current_sample: list[str] = []
        noncurrent_sample: list[str] = []
        delete_marker_sample: list[str] = []

        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name}
            if key_marker:
                kwargs["KeyMarker"] = key_marker
            if version_marker:
                kwargs["VersionIdMarker"] = version_marker
            try:
                page = client.list_object_versions(**kwargs)
            except ClientError as exc:
                code = aws_error_code(exc, lowercase=True)
                if code in {"notimplemented", "notsupported", "unsupported"}:
                    raise RuntimeError(
                        f"Version listing is not supported for bucket '{bucket_name}': {exc}"
                    ) from exc
                raise RuntimeError(
                    f"Unable to inspect versions in bucket '{bucket_name}': {exc}"
                ) from exc
            except BotoCoreError as exc:
                raise RuntimeError(
                    f"Unable to inspect versions in bucket '{bucket_name}': {exc}"
                ) from exc

            for entry in page.get("Versions", []) or []:
                key = entry.get("Key")
                version_id = entry.get("VersionId")
                if not isinstance(key, str) or not key:
                    continue
                if sample_version is None and isinstance(version_id, str) and version_id:
                    sample_version = {
                        "key": key,
                        "version_id": version_id,
                        "is_latest": bool(entry.get("IsLatest")),
                    }
                is_latest = bool(entry.get("IsLatest"))
                if is_latest:
                    current_count += 1
                    if len(current_sample) < 10:
                        current_sample.append(key)
                else:
                    noncurrent_count += 1
                    if len(noncurrent_sample) < 10:
                        noncurrent_sample.append(key)

            for entry in page.get("DeleteMarkers", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                delete_marker_count += 1
                if len(delete_marker_sample) < 10:
                    delete_marker_sample.append(key)

            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

        return {
            "current_version_count": current_count,
            "noncurrent_version_count": noncurrent_count,
            "delete_marker_count": delete_marker_count,
            "has_noncurrent_versions": noncurrent_count > 0,
            "has_delete_markers": delete_marker_count > 0,
            "sample_version": sample_version,
            "current_version_sample": current_sample,
            "noncurrent_version_sample": noncurrent_sample,
            "delete_marker_sample": delete_marker_sample,
        }

    def inspect_bucket_state(
        self,
        ctx: Any,
        bucket_name: str,
        *,
        probe_policy: set[str] | frozenset[str] | None = None,
    ) -> dict[str, Any]:
        policy = set(
            probe_policy
            or self.build_probe_policy(copy_bucket_settings=True)
        )
        probe = _BucketFeatureProbe(
            policy=policy,
            endpoint_capabilities=self._endpoint_capabilities(ctx),
        )
        values = self._collect_bucket_state(ctx, bucket_name, probe)
        encryption = _encryption_profile(values.encryption)
        normalized_versioning = str(values.versioning_status or "").strip().lower()
        return {
            "bucket_name": bucket_name,
            "versioning": {
                "status": values.versioning_status,
                "enabled": normalized_versioning == "enabled",
                "suspended": normalized_versioning == "suspended",
            },
            "version_scan": values.version_scan,
            "object_lock": {
                "enabled": bool(values.object_lock and values.object_lock.enabled),
                "mode": getattr(values.object_lock, "mode", None),
                "days": getattr(values.object_lock, "days", None),
                "years": getattr(values.object_lock, "years", None),
            },
            "encryption": encryption,
            "supported_settings": _supported_settings(values, encryption),
            "feature_availability": probe.availability,
            "skipped_features": probe.skipped,
            "unsupported_settings": _unsupported_settings(values),
        }

    def _collect_bucket_state(
        self,
        ctx: Any,
        bucket_name: str,
        probe: _BucketFeatureProbe,
    ) -> _BucketInspectionValues:
        account = ctx.account
        configuration = self._service._configuration
        properties = configuration.get_bucket_properties(bucket_name, account)
        probe.mark("versioning", state="available")
        versioning_status = (
            str(properties.versioning_status or "").strip() or None
        )
        object_lock = configuration.get_bucket_object_lock(bucket_name, account)
        probe.mark("object_lock", state="available")
        encryption = probe.fetch(
            "encryption",
            lambda: configuration.get_bucket_encryption(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        policy = probe.fetch(
            "bucket_policy",
            lambda: configuration.get_policy(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        logging_cfg = probe.fetch(
            "access_logging",
            lambda: configuration.get_bucket_logging(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        tags = probe.fetch(
            "tags",
            lambda: configuration.get_bucket_tags(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        lifecycle = probe.fetch(
            "lifecycle",
            lambda: configuration.get_lifecycle(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        cors = probe.fetch(
            "cors",
            lambda: configuration.get_bucket_cors(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        public_access_block = probe.fetch(
            "public_access_block",
            lambda: configuration.get_public_access_block(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        website = probe.fetch(
            "website",
            lambda: configuration.get_bucket_website(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        notifications = probe.fetch(
            "notifications",
            lambda: configuration.get_bucket_notifications(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        replication = probe.fetch(
            "replication",
            lambda: configuration.get_bucket_replication(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        acl = probe.fetch(
            "acl",
            lambda: configuration.get_bucket_acl(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        return _BucketInspectionValues(
            versioning_status=versioning_status,
            object_lock=object_lock,
            encryption=encryption,
            policy=policy,
            logging=logging_cfg,
            tags=tags,
            lifecycle=lifecycle,
            cors=cors,
            public_access_block=public_access_block,
            website=website,
            notifications=notifications,
            replication=replication,
            acl=acl,
            version_scan=self.scan_bucket_versions(ctx, bucket_name),
        )
