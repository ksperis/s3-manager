# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config


_PRECHECK_REPORT_VERSION = 2
_SUPPORTED_BUCKET_SETTINGS = (
    "versioning",
    "object_lock",
    "encryption",
    "public_access_block",
    "lifecycle",
    "cors",
    "tags",
    "access_logging",
    "bucket_policy",
)
_UNSUPPORTED_BUCKET_SETTINGS = (
    "acl",
    "website",
    "notifications",
    "replication",
)
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
}
_FEATURE_LABELS = {
    "versioning": "Versioning",
    "object_lock": "Object lock",
    "encryption": "Encryption",
    "public_access_block": "Public access block",
    "lifecycle": "Lifecycle",
    "cors": "CORS",
    "tags": "Tags",
    "access_logging": "Access logging",
    "bucket_policy": "Bucket policy",
    "acl": "ACL",
    "website": "Website",
    "notifications": "Notifications",
    "replication": "Replication",
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


def _check_entry(
    *,
    code: str,
    severity: str,
    blocking: bool,
    scope: str,
    message: str,
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "level": severity,
        "blocking": bool(blocking),
        "scope": scope,
        "message": message,
        "details": details or None,
    }


def _count_entries(entries: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"errors": 0, "warnings": 0, "infos": 0, "blocking_errors": 0}
    for entry in entries:
        severity = str(entry.get("severity") or entry.get("level") or "").strip().lower()
        if severity == "error":
            summary["errors"] += 1
            if bool(entry.get("blocking")):
                summary["blocking_errors"] += 1
        elif severity == "warning":
            summary["warnings"] += 1
        else:
            summary["infos"] += 1
    return summary


def _feature_label(feature: str) -> str:
    return _FEATURE_LABELS.get(feature, feature.replace("_", " ").strip().title())


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
                code = (
                    str(exc.response.get("Error", {}).get("Code", "")).strip().lower()
                    if hasattr(exc, "response")
                    else ""
                )
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

        props = self._service._buckets.get_bucket_properties(bucket_name, account)
        mark_feature("versioning", state="available")
        versioning_status = str(props.versioning_status or "").strip() or None
        object_lock = self._service._buckets.get_bucket_object_lock(bucket_name, account)
        mark_feature("object_lock", state="available")
        encryption = probe_feature(
            "encryption",
            lambda: self._service._buckets.get_bucket_encryption(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        policy = probe_feature(
            "bucket_policy",
            lambda: self._service._buckets.get_policy(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        logging_cfg = probe_feature(
            "access_logging",
            lambda: self._service._buckets.get_bucket_logging(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        tags = probe_feature(
            "tags",
            lambda: self._service._buckets.get_bucket_tags(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        lifecycle = probe_feature(
            "lifecycle",
            lambda: self._service._buckets.get_lifecycle(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        cors = probe_feature(
            "cors",
            lambda: self._service._buckets.get_bucket_cors(bucket_name, account),
            soft_unavailable=False,
            default=[],
        )
        public_access_block = probe_feature(
            "public_access_block",
            lambda: self._service._buckets.get_public_access_block(bucket_name, account),
            soft_unavailable=False,
            default=None,
        )
        website = probe_feature(
            "website",
            lambda: self._service._buckets.get_bucket_website(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        notifications = probe_feature(
            "notifications",
            lambda: self._service._buckets.get_bucket_notifications(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        replication = probe_feature(
            "replication",
            lambda: self._service._buckets.get_bucket_replication(bucket_name, account),
            soft_unavailable=True,
            default=None,
        )
        acl = probe_feature(
            "acl",
            lambda: self._service._buckets.get_bucket_acl(bucket_name, account),
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


class BucketMigrationVerifier:
    def __init__(self, service: Any) -> None:
        self._service = service

    def compare_buckets_streamed(self, *args: Any, **kwargs: Any) -> Any:
        return self._service._compare_buckets_streamed_impl(*args, **kwargs)

    def strong_verify_size_only_candidates_streamed(self, *args: Any, **kwargs: Any) -> Any:
        return self._service._strong_verify_size_only_candidates_streamed_impl(*args, **kwargs)


class BucketMigrationExecutor:
    def __init__(self, service: Any) -> None:
        self._service = service

    def run_item(self, *args: Any, **kwargs: Any) -> Any:
        return self._service._run_item_impl(*args, **kwargs)


class BucketMigrationPrecheckPlanner:
    def __init__(self, service: Any, inspector: BucketMigrationInspector) -> None:
        self._service = service
        self._inspector = inspector

    def _global_capabilities(self, *, same_endpoint: bool, same_endpoint_copy_requested: bool) -> dict[str, Any]:
        return {
            "supported_strategies": ["current_only", "version_aware"],
            "version_aware_available": True,
            "same_endpoint": bool(same_endpoint),
            "same_endpoint_copy_requested": bool(same_endpoint_copy_requested),
            "supported_bucket_settings": list(_SUPPORTED_BUCKET_SETTINGS),
            "unsupported_bucket_settings": list(_UNSUPPORTED_BUCKET_SETTINGS),
        }

    def _add_feature_availability_checks(
        self,
        profile: Optional[dict[str, Any]],
        *,
        scope_prefix: str,
        add_check: Callable[..., None],
    ) -> None:
        if not isinstance(profile, dict):
            return
        feature_availability = profile.get("feature_availability")
        if not isinstance(feature_availability, dict):
            return
        for feature_name, raw in feature_availability.items():
            if not isinstance(feature_name, str) or not isinstance(raw, dict):
                continue
            state = str(raw.get("state") or "").strip().lower()
            if not state or state == "available":
                continue
            capability = str(raw.get("capability") or "").strip() or None
            reason = str(raw.get("reason") or "").strip() or None
            feature_label = _feature_label(feature_name)
            details = {"feature": feature_name, "state": state}
            if capability:
                details["capability"] = capability
            if reason:
                details["reason"] = reason
            if state == "disabled_by_endpoint":
                add_check(
                    code=f"{scope_prefix}_feature_disabled_on_endpoint",
                    severity="info",
                    blocking=False,
                    scope=f"{scope_prefix}_bucket",
                    message=(
                        f"{feature_label} inspection skipped because endpoint capability "
                        f"'{capability or feature_name}' is disabled."
                    ),
                    details=details,
                )
            elif state == "skipped_not_required":
                add_check(
                    code=f"{scope_prefix}_feature_skipped_not_required",
                    severity="info",
                    blocking=False,
                    scope=f"{scope_prefix}_bucket",
                    message=(
                        f"{feature_label} inspection skipped because it is not required "
                        "when bucket settings copy is disabled."
                    ),
                    details=details,
                )
            elif state == "unavailable":
                add_check(
                    code=f"{scope_prefix}_feature_probe_unavailable",
                    severity="warning",
                    blocking=False,
                    scope=f"{scope_prefix}_bucket",
                    message=f"{feature_label} inspection is unavailable on this endpoint.",
                    details=details,
                )

    def run(self, migration: Any, *, checked_at: Any) -> dict[str, Any]:
        report: dict[str, Any] = {
            "report_version": _PRECHECK_REPORT_VERSION,
            "status": "passed",
            "checked_at": checked_at.isoformat(),
            "contexts": {},
            "items": [],
            "errors": 0,
            "warnings": 0,
            "summary": {},
            "capabilities": {},
            "unsupported_features": [],
        }

        blocking_errors = 0
        warnings = 0
        infos = 0

        source_ctx: Optional[Any] = None
        target_ctx: Optional[Any] = None
        context_entries: list[dict[str, Any]] = []
        try:
            source_ctx = self._service._resolve_context(migration.source_context_id)
            target_ctx = self._service._resolve_context(migration.target_context_id)
            same_endpoint = self._service._is_same_endpoint(source_ctx, target_ctx)
            report["contexts"] = {
                "source": {
                    "context_id": source_ctx.context_id,
                    "endpoint": source_ctx.endpoint,
                    "region": source_ctx.region,
                },
                "target": {
                    "context_id": target_ctx.context_id,
                    "endpoint": target_ctx.endpoint,
                    "region": target_ctx.region,
                },
            }
            report["same_endpoint"] = bool(same_endpoint)
            report["capabilities"] = self._global_capabilities(
                same_endpoint=same_endpoint,
                same_endpoint_copy_requested=bool(migration.use_same_endpoint_copy),
            )
        except Exception as exc:  # noqa: BLE001
            entry = _check_entry(
                code="context_resolution_failed",
                severity="error",
                blocking=True,
                scope="migration",
                message=f"Unable to resolve migration contexts: {exc}",
                details=None,
            )
            context_entries.append(entry)
            report["contexts_error"] = str(exc)
            source_ctx = None
            target_ctx = None
            report["capabilities"] = self._global_capabilities(
                same_endpoint=False,
                same_endpoint_copy_requested=bool(migration.use_same_endpoint_copy),
            )

        if source_ctx is not None and not source_ctx.endpoint:
            context_entries.append(
                _check_entry(
                    code="source_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="source_context",
                    message="Source context endpoint is missing.",
                )
            )
        if target_ctx is not None and not target_ctx.endpoint:
            context_entries.append(
                _check_entry(
                    code="target_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="target_context",
                    message="Target context endpoint is missing.",
                )
            )

        if source_ctx is None or target_ctx is None or context_entries:
            counts = _count_entries(context_entries)
            report["errors"] = counts["errors"]
            report["warnings"] = counts["warnings"]
            report["status"] = "failed"
            report["summary"] = {
                "items": len(migration.items),
                "infos": counts["infos"],
                "warnings": counts["warnings"],
                "errors": counts["errors"],
                "blocking_errors": counts["blocking_errors"],
            }
            report["checks"] = context_entries
            return report

        same_endpoint = bool(report.get("same_endpoint"))
        same_endpoint_copy_enabled = bool(same_endpoint and migration.use_same_endpoint_copy)
        global_same_endpoint_copy_safe = not same_endpoint_copy_enabled
        global_delete_source_safe = True
        global_rollback_safe = True
        global_unsupported_features: set[str] = set()
        probe_policy = self._inspector.build_probe_policy(copy_bucket_settings=bool(migration.copy_bucket_settings))

        for item in sorted(migration.items, key=lambda entry: entry.id):
            checks: list[dict[str, Any]] = []
            source_profile: Optional[dict[str, Any]] = None
            target_profile: Optional[dict[str, Any]] = None
            target_exists: Optional[bool] = None
            source_access_ok = False
            strategy = "current_only"
            source_count: Optional[int] = None
            target_count: Optional[int] = None

            def add_check(
                *,
                code: str,
                severity: str,
                blocking: bool,
                scope: str,
                message: str,
                details: Optional[dict[str, Any]] = None,
            ) -> None:
                checks.append(
                    _check_entry(
                        code=code,
                        severity=severity,
                        blocking=blocking,
                        scope=scope,
                        message=message,
                        details=details,
                    )
                )

            try:
                self._service._precheck_can_list_bucket(source_ctx, item.source_bucket)
                source_access_ok = True
                add_check(
                    code="source_access_ok",
                    severity="info",
                    blocking=False,
                    scope="source_bucket",
                    message="Source bucket is reachable for list/read operations.",
                )
            except Exception as exc:  # noqa: BLE001
                add_check(
                    code="source_access_failed",
                    severity="error",
                    blocking=True,
                    scope="source_bucket",
                    message=f"Source bucket read/list check failed: {exc}",
                )

            if source_access_ok:
                try:
                    source_count = self._service._count_bucket_objects(source_ctx, item.source_bucket)
                    item.source_count = int(source_count)
                    add_check(
                        code="source_count_ok",
                        severity="info",
                        blocking=False,
                        scope="source_bucket",
                        message=f"Source bucket object count: {source_count}.",
                        details={"current_object_count": source_count},
                    )
                except Exception as exc:  # noqa: BLE001
                    item.source_count = None
                    add_check(
                        code="source_count_failed",
                        severity="warning",
                        blocking=False,
                        scope="source_bucket",
                        message=f"Unable to count source bucket objects: {exc}",
                    )

                try:
                    source_profile = self._inspector.inspect_bucket_state(
                        source_ctx,
                        item.source_bucket,
                        probe_policy=probe_policy,
                    )
                    self._add_feature_availability_checks(
                        source_profile,
                        scope_prefix="source",
                        add_check=add_check,
                    )
                except Exception as exc:  # noqa: BLE001
                    add_check(
                        code="source_profile_inspection_failed",
                        severity="error",
                        blocking=True,
                        scope="source_bucket",
                        message=f"Unable to inspect source bucket features: {exc}",
                    )
            else:
                item.source_count = None

            try:
                target_exists = self._service._precheck_bucket_exists(target_ctx, item.target_bucket)
                if target_exists is True:
                    add_check(
                        code="target_exists",
                        severity="warning",
                        blocking=False,
                        scope="target_bucket",
                        message="Target bucket already exists; this item will be skipped.",
                    )
                elif target_exists is False:
                    add_check(
                        code="target_missing",
                        severity="info",
                        blocking=False,
                        scope="target_bucket",
                        message="Target bucket does not exist.",
                    )
                else:
                    add_check(
                        code="target_existence_unknown",
                        severity="error",
                        blocking=True,
                        scope="target_bucket",
                        message="Unable to verify whether target bucket exists.",
                    )
            except Exception as exc:  # noqa: BLE001
                add_check(
                    code="target_existence_failed",
                    severity="error",
                    blocking=True,
                    scope="target_bucket",
                    message=f"Target bucket existence check failed: {exc}",
                )

            if target_exists is True:
                strategy = "skip_existing"
                try:
                    target_count = self._service._count_bucket_objects(target_ctx, item.target_bucket)
                    item.target_count = int(target_count)
                    add_check(
                        code="target_count_ok",
                        severity="info",
                        blocking=False,
                        scope="target_bucket",
                        message=f"Target bucket object count: {target_count}.",
                        details={"current_object_count": target_count},
                    )
                except Exception as exc:  # noqa: BLE001
                    item.target_count = None
                    add_check(
                        code="target_count_failed",
                        severity="warning",
                        blocking=False,
                        scope="target_bucket",
                        message=f"Unable to count target bucket objects: {exc}",
                    )
                try:
                    target_profile = self._inspector.inspect_bucket_state(
                        target_ctx,
                        item.target_bucket,
                        probe_policy=probe_policy,
                    )
                    self._add_feature_availability_checks(
                        target_profile,
                        scope_prefix="target",
                        add_check=add_check,
                    )
                except Exception as exc:  # noqa: BLE001
                    add_check(
                        code="target_profile_inspection_failed",
                        severity="warning",
                        blocking=False,
                        scope="target_bucket",
                        message=f"Unable to inspect existing target bucket features: {exc}",
                    )
            elif target_exists is False:
                item.target_count = 0
            else:
                item.target_count = None

            if source_profile is not None:
                source_profile["current_object_count"] = source_count
                versioning = source_profile.get("versioning") or {}
                version_scan = source_profile.get("version_scan") or {}
                object_lock = source_profile.get("object_lock") or {}
                encryption = source_profile.get("encryption") or {}
                unsupported_settings = list(source_profile.get("unsupported_settings") or [])
                global_unsupported_features.update(unsupported_settings)

                if strategy != "skip_existing":
                    requires_version_aware = bool(
                        versioning.get("enabled")
                        or versioning.get("suspended")
                        or version_scan.get("has_noncurrent_versions")
                        or version_scan.get("has_delete_markers")
                    )
                    requires_object_lock_governance = bool(
                        object_lock.get("enabled")
                        or object_lock.get("mode")
                        or object_lock.get("days") is not None
                        or object_lock.get("years") is not None
                    )
                    if requires_version_aware:
                        strategy = "version_aware"
                    if requires_object_lock_governance:
                        strategy = "version_aware"
                        add_check(
                            code="object_lock_governance_not_supported",
                            severity="error",
                            blocking=True,
                            scope="source_bucket",
                            message=(
                                "Source bucket uses object-lock governance semantics that are outside the "
                                "supported perimeter of version-aware migration."
                            ),
                            details={
                                "versioning_status": versioning.get("status"),
                                "has_noncurrent_versions": bool(version_scan.get("has_noncurrent_versions")),
                                "has_delete_markers": bool(version_scan.get("has_delete_markers")),
                                "object_lock_enabled": bool(object_lock.get("enabled")),
                                "object_lock_mode": object_lock.get("mode"),
                                "object_lock_days": object_lock.get("days"),
                                "object_lock_years": object_lock.get("years"),
                            },
                        )
                    elif requires_version_aware:
                        add_check(
                            code="version_aware_supported",
                            severity="info",
                            blocking=False,
                            scope="source_bucket",
                            message=(
                                "Source bucket requires version-aware migration and will replicate object "
                                "history and delete markers."
                            ),
                            details={
                                "versioning_status": versioning.get("status"),
                                "has_noncurrent_versions": bool(version_scan.get("has_noncurrent_versions")),
                                "has_delete_markers": bool(version_scan.get("has_delete_markers")),
                            },
                        )

                    if bool(encryption.get("enabled")) and not bool(encryption.get("supported")):
                        add_check(
                            code="unsupported_default_encryption",
                            severity="error",
                            blocking=True,
                            scope="source_bucket",
                            message=(
                                "Source bucket default encryption is not supported by the migration worker."
                            ),
                            details={
                                "algorithms": encryption.get("algorithms"),
                                "kms_key_ids": encryption.get("kms_key_ids"),
                                "reason": encryption.get("unsupported_reason"),
                            },
                        )

                    if bool(encryption.get("enabled")) and bool(encryption.get("supported")):
                        if migration.copy_bucket_settings:
                            add_check(
                                code="default_encryption_supported",
                                severity="info",
                                blocking=False,
                                scope="source_bucket",
                                message="Default SSE-S3 bucket encryption is supported for bucket settings copy.",
                                details={"algorithms": encryption.get("algorithms")},
                            )
                        else:
                            add_check(
                                code="default_encryption_not_copied",
                                severity="warning",
                                blocking=False,
                                scope="source_bucket",
                                message=(
                                    "Source bucket uses default SSE-S3 encryption, but bucket settings copy is disabled."
                                ),
                                details={"algorithms": encryption.get("algorithms")},
                            )

                    if migration.copy_bucket_settings and unsupported_settings:
                        add_check(
                            code="unsupported_bucket_settings_configured",
                            severity="error",
                            blocking=True,
                            scope="source_bucket",
                            message=(
                                "Source bucket uses settings that are outside the supported migration perimeter "
                                "for bucket settings copy."
                            ),
                            details={"unsupported_settings": unsupported_settings},
                        )
                    elif unsupported_settings:
                        add_check(
                            code="unsupported_bucket_settings_ignored",
                            severity="warning",
                            blocking=False,
                            scope="source_bucket",
                            message=(
                                "Source bucket uses settings outside the supported migration perimeter, "
                                "but bucket settings copy is disabled."
                            ),
                            details={"unsupported_settings": unsupported_settings},
                        )

                    if strategy == "version_aware" and not requires_object_lock_governance:
                        try:
                            self._service._precheck_version_aware_source_access(
                                source_ctx,
                                item.source_bucket,
                                source_profile,
                            )
                            add_check(
                                code="version_aware_source_access_validated",
                                severity="info",
                                blocking=False,
                                scope="source_bucket",
                                message=(
                                    "Version-aware source access is validated for explicit version reads "
                                    "and version tags."
                                ),
                            )
                        except Exception as exc:  # noqa: BLE001
                            add_check(
                                code="version_aware_source_access_failed",
                                severity="error",
                                blocking=True,
                                scope="source_bucket",
                                message=f"Version-aware source access precheck failed: {exc}",
                            )

            same_endpoint_copy_safe = not same_endpoint_copy_enabled
            if same_endpoint_copy_enabled and target_exists is not True and source_access_ok:
                try:
                    probe = self._service._precheck_same_endpoint_copy_source_access(
                        source_ctx,
                        target_ctx,
                        item.source_bucket,
                        auto_grant=bool(migration.auto_grant_source_read_for_copy),
                        strategy=strategy,
                        source_profile=source_profile,
                    )
                    if probe == "source_empty":
                        same_endpoint_copy_safe = False
                        add_check(
                            code="same_endpoint_copy_unvalidated",
                            severity="error",
                            blocking=True,
                            scope="same_endpoint_copy",
                            message=(
                                "Source bucket is empty; same-endpoint x-amz-copy-source permissions "
                                "cannot be validated in fail-closed mode."
                            ),
                        )
                    elif probe == "validated_with_temporary_grant":
                        same_endpoint_copy_safe = True
                        add_check(
                            code="same_endpoint_copy_validated_with_grant",
                            severity="info",
                            blocking=False,
                            scope="same_endpoint_copy",
                            message=(
                                "Same-endpoint x-amz-copy-source permissions were validated with "
                                "a temporary source-read grant."
                            ),
                        )
                    else:
                        same_endpoint_copy_safe = True
                        add_check(
                            code="same_endpoint_copy_validated",
                            severity="info",
                            blocking=False,
                            scope="same_endpoint_copy",
                            message="Same-endpoint x-amz-copy-source permissions are valid.",
                        )
                except Exception as exc:  # noqa: BLE001
                    same_endpoint_copy_safe = False
                    add_check(
                        code="same_endpoint_copy_failed",
                        severity="error",
                        blocking=True,
                        scope="same_endpoint_copy",
                        message=f"Same-endpoint x-amz-copy-source precheck failed: {exc}",
                    )

            requires_cutover = bool(target_exists is not True)
            if requires_cutover:
                try:
                    self._service._precheck_policy_roundtrip(source_ctx.account, item.source_bucket)
                    add_check(
                        code="source_read_only_policy_validated",
                        severity="info",
                        blocking=False,
                        scope="source_policy",
                        message="Read-only cutover policy can be applied on source bucket.",
                    )
                except Exception as exc:  # noqa: BLE001
                    add_check(
                        code="source_read_only_policy_failed",
                        severity="error",
                        blocking=True,
                        scope="source_policy",
                        message=f"Read-only policy precheck failed: {exc}",
                    )

            if migration.lock_target_writes and target_exists is not True:
                try:
                    self._service._precheck_target_lock_with_probe_bucket(target_ctx, migration_id=migration.id)
                    add_check(
                        code="target_write_lock_validated",
                        severity="info",
                        blocking=False,
                        scope="target_policy",
                        message="Target write-lock policy roundtrip is validated for migration worker access.",
                    )
                except Exception as exc:  # noqa: BLE001
                    add_check(
                        code="target_write_lock_failed",
                        severity="error",
                        blocking=True,
                        scope="target_policy",
                        message=f"Target write-lock precheck failed: {exc}",
                    )

            delete_source_safe = True
            if migration.delete_source:
                if strategy == "version_aware" and any(
                    bool((source_profile or {}).get("object_lock", {}).get(field))
                    for field in ("enabled", "mode", "days", "years")
                ):
                    delete_source_safe = False
                    add_check(
                        code="delete_source_object_lock_not_supported",
                        severity="error",
                        blocking=True,
                        scope="delete_source",
                        message=(
                            "Source deletion is blocked because object-lock governance is not supported "
                            "by the version-aware migration worker."
                        ),
                    )
                else:
                    add_check(
                        code="delete_source_supported",
                        severity="info",
                        blocking=False,
                        scope="delete_source",
                        message="Source deletion is compatible with the planned migration strategy.",
                    )

            rollback_safe = strategy in {"current_only", "skip_existing", "version_aware"} and not any(
                bool((source_profile or {}).get("object_lock", {}).get(field))
                for field in ("enabled", "mode", "days", "years")
            )
            if not rollback_safe:
                add_check(
                    code="rollback_not_safe",
                    severity="error",
                    blocking=True,
                    scope="rollback",
                    message=(
                        "Rollback safety cannot be guaranteed for this bucket with the current migration engine."
                    ),
                )

            counts = _count_entries(checks)
            blocking = counts["blocking_errors"] > 0
            infos += counts["infos"]
            warnings += counts["warnings"]
            blocking_errors += counts["blocking_errors"]
            global_same_endpoint_copy_safe = global_same_endpoint_copy_safe and same_endpoint_copy_safe
            global_delete_source_safe = global_delete_source_safe and delete_source_safe
            global_rollback_safe = global_rollback_safe and rollback_safe

            item.source_count = source_count
            item.target_count = target_count if target_exists is True else item.target_count
            item.source_snapshot_json = self._service._json_dumps_safe(source_profile)
            item.target_snapshot_json = self._service._json_dumps_safe(target_profile)
            execution_plan = {
                "report_version": _PRECHECK_REPORT_VERSION,
                "strategy": strategy,
                "supported": not blocking,
                "blocked": blocking,
                "delete_source_safe": delete_source_safe,
                "rollback_safe": rollback_safe,
                "same_endpoint_copy_safe": same_endpoint_copy_safe,
                "blocking_codes": [
                    entry["code"]
                    for entry in checks
                    if str(entry.get("severity") or "").lower() == "error" and bool(entry.get("blocking"))
                ],
            }
            item.execution_plan_json = self._service._json_dumps_safe(execution_plan)
            item.updated_at = checked_at

            report["items"].append(
                {
                    "item_id": item.id,
                    "source_bucket": item.source_bucket,
                    "target_bucket": item.target_bucket,
                    "strategy": strategy,
                    "blocking": blocking,
                    "delete_source_safe": delete_source_safe,
                    "rollback_safe": rollback_safe,
                    "same_endpoint_copy_safe": same_endpoint_copy_safe,
                    "source_object_count": source_count,
                    "target_object_count": target_count,
                    "source_profile": source_profile,
                    "target_profile": target_profile,
                    "checks": checks,
                    "messages": checks,
                    "errors": counts["errors"],
                    "warnings": counts["warnings"],
                }
            )

        report["same_endpoint_copy_safe"] = global_same_endpoint_copy_safe
        report["delete_source_safe"] = global_delete_source_safe
        report["rollback_safe"] = global_rollback_safe
        report["unsupported_features"] = sorted(global_unsupported_features)
        report["errors"] = blocking_errors
        report["warnings"] = warnings
        report["status"] = "failed" if blocking_errors > 0 else "passed"
        report["summary"] = {
            "items": len(report["items"]),
            "infos": infos,
            "warnings": warnings,
            "errors": blocking_errors,
            "blocking_errors": blocking_errors,
            "strategies": {
                "current_only": len([item for item in report["items"] if item.get("strategy") == "current_only"]),
                "version_aware": len([item for item in report["items"] if item.get("strategy") == "version_aware"]),
                "skip_existing": len([item for item in report["items"] if item.get("strategy") == "skip_existing"]),
            },
        }
        return report
