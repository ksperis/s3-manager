# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

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


def _normalized_sse_rule(rule: Any) -> tuple[Optional[str], Optional[str]]:
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
    capability: Optional[str] = None,
    reason: Optional[str] = None,
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
        key_marker: Optional[str] = None
        version_marker: Optional[str] = None
        current_count = 0
        noncurrent_count = 0
        delete_marker_count = 0
        sample_version: Optional[dict[str, Any]] = None
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
        probe_policy: Optional[set[str] | frozenset[str]] = None,
    ) -> dict[str, Any]:
        account = ctx.account
        effective_probe_policy = set(probe_policy or self.build_probe_policy(copy_bucket_settings=True))
        endpoint_capabilities = self._endpoint_capabilities(ctx)
        feature_availability: dict[str, dict[str, Any]] = {}
        skipped_features: list[str] = []

        def mark_feature(
            feature: str,
            *,
            state: str,
            capability: Optional[str] = None,
            reason: Optional[str] = None,
        ) -> None:
            feature_availability[feature] = _feature_availability_entry(
                state=state,
                capability=capability,
                reason=reason,
            )
            if state == "skipped_not_required" and feature not in skipped_features:
                skipped_features.append(feature)

        def should_skip_feature(feature: str) -> tuple[bool, Optional[str], Optional[str]]:
            capability = _ENDPOINT_CAPABILITY_BY_FEATURE.get(feature)
            if feature not in effective_probe_policy:
                mark_feature(feature, state="skipped_not_required", capability=capability, reason="not_required")
                return True, capability, "skipped_not_required"
            if capability and endpoint_capabilities.get(capability) is False:
                mark_feature(feature, state="disabled_by_endpoint", capability=capability, reason="endpoint_capability_disabled")
                return True, capability, "disabled_by_endpoint"
            return False, capability, None

        def probe_feature(
            feature: str,
            fetcher: Callable[[], Any],
            *,
            soft_unavailable: bool,
            default: Any,
        ) -> Any:
            should_skip, capability, _skip_reason = should_skip_feature(feature)
            if should_skip:
                return default
            try:
                value = fetcher()
            except Exception as exc:  # noqa: BLE001
                if soft_unavailable and _is_probe_unavailable_error(exc):
                    mark_feature(feature, state="unavailable", capability=capability, reason=str(exc))
                    return default
                raise
            mark_feature(feature, state="available", capability=capability)
            return value

        props = self._service._configuration.get_bucket_properties(bucket_name, account)
        mark_feature("versioning", state="available")
        versioning_status = str(props.versioning_status or "").strip() or None
        object_lock = self._service._configuration.get_bucket_object_lock(bucket_name, account)
        mark_feature("object_lock", state="available")
        encryption = probe_feature(
            "encryption",
            lambda: self._service._configuration.get_bucket_encryption(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        policy = probe_feature(
            "bucket_policy",
            lambda: self._service._configuration.get_policy(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        logging_cfg = probe_feature(
            "access_logging",
            lambda: self._service._configuration.get_bucket_logging(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        tags = probe_feature(
            "tags",
            lambda: self._service._configuration.get_bucket_tags(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        lifecycle = probe_feature(
            "lifecycle",
            lambda: self._service._configuration.get_lifecycle(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        cors = probe_feature(
            "cors",
            lambda: self._service._configuration.get_bucket_cors(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        public_access_block = probe_feature(
            "public_access_block",
            lambda: self._service._configuration.get_public_access_block(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        website = probe_feature(
            "website",
            lambda: self._service._configuration.get_bucket_website(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        notifications = probe_feature(
            "notifications",
            lambda: self._service._configuration.get_bucket_notifications(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        replication = probe_feature(
            "replication",
            lambda: self._service._configuration.get_bucket_replication(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        acl = probe_feature(
            "acl",
            lambda: self._service._configuration.get_bucket_acl(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        version_scan = self.scan_bucket_versions(ctx, bucket_name)

        encryption_rules = list(getattr(encryption, "rules", None) or [])
        algorithms = []
        kms_keys = []
        supported_encryption = True
        unsupported_reason: Optional[str] = None
        for rule in encryption_rules:
            algorithm, kms_key_id = _normalized_sse_rule(rule)
            if algorithm:
                algorithms.append(algorithm)
            if kms_key_id:
                kms_keys.append(kms_key_id)
            if algorithm and algorithm != "AES256":
                supported_encryption = False
                unsupported_reason = f"default encryption algorithm '{algorithm}' is not supported"
            if kms_key_id:
                supported_encryption = False
                unsupported_reason = "default SSE-KMS encryption is not supported"

        unsupported_settings: list[str] = []
        if acl is not None and not _bucket_acl_is_default_private(acl):
            unsupported_settings.append("acl")
        if _website_is_configured(website):
            unsupported_settings.append("website")
        if bool(getattr(notifications, "configuration", None)):
            unsupported_settings.append("notifications")
        replication_cfg = getattr(replication, "configuration", None) or {}
        if isinstance(replication_cfg, dict) and bool(replication_cfg.get("Rules")):
            unsupported_settings.append("replication")

        return {
            "bucket_name": bucket_name,
            "versioning": {
                "status": versioning_status,
                "enabled": str(versioning_status or "").strip().lower() == "enabled",
                "suspended": str(versioning_status or "").strip().lower() == "suspended",
            },
            "version_scan": version_scan,
            "object_lock": {
                "enabled": bool(object_lock and object_lock.enabled),
                "mode": getattr(object_lock, "mode", None),
                "days": getattr(object_lock, "days", None),
                "years": getattr(object_lock, "years", None),
            },
            "encryption": {
                "enabled": bool(encryption_rules),
                "supported": supported_encryption,
                "algorithms": sorted(set(algorithms)),
                "kms_key_ids": sorted(set(kms_keys)),
                "unsupported_reason": unsupported_reason,
                "rule_count": len(encryption_rules),
            },
            "supported_settings": {
                "versioning": bool(versioning_status),
                "object_lock": bool(object_lock and object_lock.enabled),
                "encryption": bool(encryption_rules),
                "public_access_block": bool(public_access_block),
                "lifecycle": bool(getattr(lifecycle, "rules", None) or []) if lifecycle is not None else None,
                "cors": bool(cors or []),
                "tags": bool(tags),
                "access_logging": _logging_is_configured(logging_cfg),
                "bucket_policy": bool(policy),
            },
            "feature_availability": feature_availability,
            "skipped_features": skipped_features,
            "unsupported_settings": unsupported_settings,
        }
