# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.core.sensitive_data import sanitized_error_log_detail

from .precheck_inspection import BucketMigrationInspector


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


@dataclass(frozen=True)
class _SourceInspection:
    access_ok: bool
    object_count: int | None
    profile: dict[str, Any] | None


@dataclass(frozen=True)
class _TargetInspection:
    exists: bool | None
    object_count: int | None
    profile: dict[str, Any] | None


@dataclass(frozen=True)
class _SourcePlan:
    strategy: str
    unsupported_features: frozenset[str]


@dataclass(frozen=True)
class _ItemSafety:
    same_endpoint_copy_safe: bool
    delete_source_safe: bool
    rollback_safe: bool


@dataclass(frozen=True)
class _PlannedItem:
    report: dict[str, Any]
    infos: int
    warnings: int
    blocking_errors: int
    same_endpoint_copy_safe: bool
    delete_source_safe: bool
    rollback_safe: bool
    unsupported_features: frozenset[str]


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

    def _inspect_source_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> _SourceInspection:
        try:
            self._service._precheck_can_list_bucket(context, item.source_bucket)
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="source_access_failed",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=f"Source bucket read/list check failed: {exc}",
            )
            return _SourceInspection(access_ok=False, object_count=None, profile=None)

        add_check(
            code="source_access_ok",
            severity="info",
            blocking=False,
            scope="source_bucket",
            message="Source bucket is reachable for list/read operations.",
        )

        object_count: int | None = None
        try:
            object_count = int(self._service._count_bucket_objects(context, item.source_bucket))
            add_check(
                code="source_count_ok",
                severity="info",
                blocking=False,
                scope="source_bucket",
                message=f"Source bucket object count: {object_count}.",
                details={"current_object_count": object_count},
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="source_count_failed",
                severity="warning",
                blocking=False,
                scope="source_bucket",
                message=f"Unable to count source bucket objects: {exc}",
            )

        profile: dict[str, Any] | None = None
        try:
            profile = self._inspector.inspect_bucket_state(
                context,
                item.source_bucket,
                probe_policy=probe_policy,
            )
            self._add_feature_availability_checks(
                profile,
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
        return _SourceInspection(access_ok=True, object_count=object_count, profile=profile)

    def _inspect_target_bucket(
        self,
        context: Any,
        item: Any,
        *,
        probe_policy: Any,
        add_check: Callable[..., None],
    ) -> _TargetInspection:
        target_exists: bool | None = None
        try:
            target_exists = self._service._precheck_bucket_exists(context, item.target_bucket)
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

        if target_exists is not True:
            return _TargetInspection(
                exists=target_exists,
                object_count=0 if target_exists is False else None,
                profile=None,
            )

        object_count: int | None = None
        try:
            object_count = int(self._service._count_bucket_objects(context, item.target_bucket))
            add_check(
                code="target_count_ok",
                severity="info",
                blocking=False,
                scope="target_bucket",
                message=f"Target bucket object count: {object_count}.",
                details={"current_object_count": object_count},
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="target_count_failed",
                severity="warning",
                blocking=False,
                scope="target_bucket",
                message=f"Unable to count target bucket objects: {exc}",
            )

        profile: dict[str, Any] | None = None
        try:
            profile = self._inspector.inspect_bucket_state(
                context,
                item.target_bucket,
                probe_policy=probe_policy,
            )
            self._add_feature_availability_checks(
                profile,
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
        return _TargetInspection(exists=True, object_count=object_count, profile=profile)

    def _plan_source_bucket(
        self,
        context: Any,
        item: Any,
        migration: Any,
        *,
        profile: dict[str, Any] | None,
        object_count: int | None,
        initial_strategy: str,
        add_check: Callable[..., None],
    ) -> _SourcePlan:
        if profile is None:
            return _SourcePlan(
                strategy=initial_strategy,
                unsupported_features=frozenset(),
            )

        profile["current_object_count"] = object_count
        unsupported_settings = list(profile.get("unsupported_settings") or [])
        unsupported_features = frozenset(
            str(setting) for setting in unsupported_settings
        )
        if initial_strategy == "skip_existing":
            return _SourcePlan(
                strategy=initial_strategy,
                unsupported_features=unsupported_features,
            )

        versioning = profile.get("versioning") or {}
        version_scan = profile.get("version_scan") or {}
        object_lock = profile.get("object_lock") or {}
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
        strategy = (
            "version_aware"
            if requires_version_aware or requires_object_lock_governance
            else initial_strategy
        )
        self._add_source_strategy_check(
            versioning=versioning,
            version_scan=version_scan,
            object_lock=object_lock,
            requires_version_aware=requires_version_aware,
            requires_object_lock_governance=requires_object_lock_governance,
            add_check=add_check,
        )
        self._add_source_encryption_check(
            profile.get("encryption") or {},
            migration=migration,
            add_check=add_check,
        )
        self._add_unsupported_settings_check(
            unsupported_settings,
            copy_bucket_settings=bool(migration.copy_bucket_settings),
            add_check=add_check,
        )

        if strategy == "version_aware" and not requires_object_lock_governance:
            self._validate_version_aware_source_access(
                context,
                item,
                profile,
                add_check=add_check,
            )

        return _SourcePlan(
            strategy=strategy,
            unsupported_features=unsupported_features,
        )

    def _add_source_strategy_check(
        self,
        *,
        versioning: dict[str, Any],
        version_scan: dict[str, Any],
        object_lock: dict[str, Any],
        requires_version_aware: bool,
        requires_object_lock_governance: bool,
        add_check: Callable[..., None],
    ) -> None:
        common_details = {
            "versioning_status": versioning.get("status"),
            "has_noncurrent_versions": bool(
                version_scan.get("has_noncurrent_versions")
            ),
            "has_delete_markers": bool(
                version_scan.get("has_delete_markers")
            ),
        }
        if requires_object_lock_governance:
            add_check(
                code="object_lock_governance_not_supported",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=(
                    "Source bucket uses object-lock governance semantics that are "
                    "outside the supported perimeter of version-aware migration."
                ),
                details={
                    **common_details,
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
                    "Source bucket requires version-aware migration and will "
                    "replicate object history and delete markers."
                ),
                details=common_details,
            )

    def _add_source_encryption_check(
        self,
        encryption: dict[str, Any],
        *,
        migration: Any,
        add_check: Callable[..., None],
    ) -> None:
        if not bool(encryption.get("enabled")):
            return
        if not bool(encryption.get("supported")):
            add_check(
                code="unsupported_default_encryption",
                severity="error",
                blocking=True,
                scope="source_bucket",
                message=(
                    "Source bucket default encryption is not supported by the "
                    "migration worker."
                ),
                details={
                    "algorithms": encryption.get("algorithms"),
                    "kms_key_ids": encryption.get("kms_key_ids"),
                    "reason": encryption.get("unsupported_reason"),
                },
            )
            return
        add_check(
            code=(
                "default_encryption_supported"
                if migration.copy_bucket_settings
                else "default_encryption_not_copied"
            ),
            severity="info" if migration.copy_bucket_settings else "warning",
            blocking=False,
            scope="source_bucket",
            message=(
                "Default SSE-S3 bucket encryption is supported for bucket settings copy."
                if migration.copy_bucket_settings
                else (
                    "Source bucket uses default SSE-S3 encryption, but bucket "
                    "settings copy is disabled."
                )
            ),
            details={"algorithms": encryption.get("algorithms")},
        )

    def _add_unsupported_settings_check(
        self,
        unsupported_settings: list[Any],
        *,
        copy_bucket_settings: bool,
        add_check: Callable[..., None],
    ) -> None:
        if not unsupported_settings:
            return
        add_check(
            code=(
                "unsupported_bucket_settings_configured"
                if copy_bucket_settings
                else "unsupported_bucket_settings_ignored"
            ),
            severity="error" if copy_bucket_settings else "warning",
            blocking=copy_bucket_settings,
            scope="source_bucket",
            message=(
                "Source bucket uses settings that are outside the supported migration "
                "perimeter for bucket settings copy."
                if copy_bucket_settings
                else (
                    "Source bucket uses settings outside the supported migration "
                    "perimeter, but bucket settings copy is disabled."
                )
            ),
            details={"unsupported_settings": unsupported_settings},
        )

    def _validate_version_aware_source_access(
        self,
        context: Any,
        item: Any,
        profile: dict[str, Any],
        *,
        add_check: Callable[..., None],
    ) -> None:
        try:
            self._service._precheck_version_aware_source_access(
                context,
                item.source_bucket,
                profile,
            )
            add_check(
                code="version_aware_source_access_validated",
                severity="info",
                blocking=False,
                scope="source_bucket",
                message=(
                    "Version-aware source access is validated for explicit version "
                    "reads and version tags."
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

    def _evaluate_item_safety(
        self,
        source_context: Any,
        target_context: Any,
        item: Any,
        migration: Any,
        *,
        source_access_ok: bool,
        source_profile: dict[str, Any] | None,
        target_exists: bool | None,
        strategy: str,
        same_endpoint_copy_enabled: bool,
        add_check: Callable[..., None],
    ) -> _ItemSafety:
        same_endpoint_copy_safe = self._check_same_endpoint_copy_safety(
            source_context,
            target_context,
            item,
            migration,
            source_access_ok=source_access_ok,
            source_profile=source_profile,
            target_exists=target_exists,
            strategy=strategy,
            enabled=same_endpoint_copy_enabled,
            add_check=add_check,
        )
        requires_cutover = target_exists is not True
        if requires_cutover:
            self._check_cutover_policies(
                source_context,
                target_context,
                item,
                migration,
                add_check=add_check,
            )
        delete_source_safe, rollback_safe = self._check_destructive_safety(
            source_profile,
            migration=migration,
            strategy=strategy,
            add_check=add_check,
        )
        return _ItemSafety(
            same_endpoint_copy_safe=same_endpoint_copy_safe,
            delete_source_safe=delete_source_safe,
            rollback_safe=rollback_safe,
        )

    def _check_same_endpoint_copy_safety(
        self,
        source_context: Any,
        target_context: Any,
        item: Any,
        migration: Any,
        *,
        source_access_ok: bool,
        source_profile: dict[str, Any] | None,
        target_exists: bool | None,
        strategy: str,
        enabled: bool,
        add_check: Callable[..., None],
    ) -> bool:
        if not enabled:
            return True
        if target_exists is True or not source_access_ok:
            return False
        try:
            probe = self._service._precheck_same_endpoint_copy_source_access(
                source_context,
                target_context,
                item.source_bucket,
                auto_grant=bool(
                    migration.auto_grant_source_read_for_copy
                ),
                strategy=strategy,
                source_profile=source_profile,
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="same_endpoint_copy_failed",
                severity="error",
                blocking=True,
                scope="same_endpoint_copy",
                message=(
                    "Same-endpoint x-amz-copy-source precheck failed: "
                    f"{exc}"
                ),
            )
            return False
        if probe == "source_empty":
            add_check(
                code="same_endpoint_copy_unvalidated",
                severity="error",
                blocking=True,
                scope="same_endpoint_copy",
                message=(
                    "Source bucket is empty; same-endpoint x-amz-copy-source "
                    "permissions cannot be validated in fail-closed mode."
                ),
            )
            return False
        if probe == "validated_with_temporary_grant":
            add_check(
                code="same_endpoint_copy_validated_with_grant",
                severity="info",
                blocking=False,
                scope="same_endpoint_copy",
                message=(
                    "Same-endpoint x-amz-copy-source permissions were validated "
                    "with a temporary source-read grant."
                ),
            )
            return True
        add_check(
            code="same_endpoint_copy_validated",
            severity="info",
            blocking=False,
            scope="same_endpoint_copy",
            message="Same-endpoint x-amz-copy-source permissions are valid.",
        )
        return True

    def _check_cutover_policies(
        self,
        source_context: Any,
        target_context: Any,
        item: Any,
        migration: Any,
        *,
        add_check: Callable[..., None],
    ) -> None:
        try:
            self._service._precheck_policy_roundtrip(
                source_context.account,
                item.source_bucket,
            )
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

        if not migration.lock_target_writes:
            return
        try:
            self._service._precheck_target_lock_with_probe_bucket(
                target_context,
                migration_id=migration.id,
            )
            add_check(
                code="target_write_lock_validated",
                severity="info",
                blocking=False,
                scope="target_policy",
                message=(
                    "Target write-lock policy roundtrip is validated for migration "
                    "worker access."
                ),
            )
        except Exception as exc:  # noqa: BLE001
            add_check(
                code="target_write_lock_failed",
                severity="error",
                blocking=True,
                scope="target_policy",
                message=f"Target write-lock precheck failed: {exc}",
            )

    def _check_destructive_safety(
        self,
        source_profile: dict[str, Any] | None,
        *,
        migration: Any,
        strategy: str,
        add_check: Callable[..., None],
    ) -> tuple[bool, bool]:
        object_lock = (source_profile or {}).get("object_lock", {})
        object_lock_configured = any(
            bool(object_lock.get(field))
            for field in ("enabled", "mode", "days", "years")
        )
        delete_source_safe = True
        if migration.delete_source:
            delete_source_safe = not (
                strategy == "version_aware" and object_lock_configured
            )
            add_check(
                code=(
                    "delete_source_supported"
                    if delete_source_safe
                    else "delete_source_object_lock_not_supported"
                ),
                severity="info" if delete_source_safe else "error",
                blocking=not delete_source_safe,
                scope="delete_source",
                message=(
                    "Source deletion is compatible with the planned migration strategy."
                    if delete_source_safe
                    else (
                        "Source deletion is blocked because object-lock governance "
                        "is not supported by the version-aware migration worker."
                    )
                ),
            )

        rollback_safe = (
            strategy in {"current_only", "skip_existing", "version_aware"}
            and not object_lock_configured
        )
        if not rollback_safe:
            add_check(
                code="rollback_not_safe",
                severity="error",
                blocking=True,
                scope="rollback",
                message=(
                    "Rollback safety cannot be guaranteed for this bucket with the "
                    "current migration engine."
                ),
            )
        return delete_source_safe, rollback_safe

    def _new_report(self, *, checked_at: Any) -> dict[str, Any]:
        return {
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

    def _resolve_contexts(
        self,
        migration: Any,
        report: dict[str, Any],
    ) -> tuple[Any | None, Any | None, list[dict[str, Any]]]:
        entries: list[dict[str, Any]] = []
        try:
            source_ctx = self._service._resolve_context(
                migration.source_context_id
            )
            target_ctx = self._service._resolve_context(
                migration.target_context_id
            )
            same_endpoint = self._service._is_same_endpoint(
                source_ctx,
                target_ctx,
            )
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
                same_endpoint_copy_requested=bool(
                    migration.use_same_endpoint_copy
                ),
            )
        except Exception as exc:  # noqa: BLE001
            entries.append(
                _check_entry(
                    code="context_resolution_failed",
                    severity="error",
                    blocking=True,
                    scope="migration",
                    message=(
                        "Unable to resolve migration contexts: "
                        f"{sanitized_error_log_detail(exc)}"
                    ),
                )
            )
            report["contexts_error"] = sanitized_error_log_detail(exc)
            report["capabilities"] = self._global_capabilities(
                same_endpoint=False,
                same_endpoint_copy_requested=bool(
                    migration.use_same_endpoint_copy
                ),
            )
            return None, None, entries

        if not source_ctx.endpoint:
            entries.append(
                _check_entry(
                    code="source_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="source_context",
                    message="Source context endpoint is missing.",
                )
            )
        if not target_ctx.endpoint:
            entries.append(
                _check_entry(
                    code="target_endpoint_missing",
                    severity="error",
                    blocking=True,
                    scope="target_context",
                    message="Target context endpoint is missing.",
                )
            )
        return source_ctx, target_ctx, entries

    def _context_failure_report(
        self,
        report: dict[str, Any],
        migration: Any,
        entries: list[dict[str, Any]],
    ) -> dict[str, Any]:
        counts = _count_entries(entries)
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
        report["checks"] = entries
        return report

    def _plan_item(
        self,
        source_ctx: Any,
        target_ctx: Any,
        item: Any,
        migration: Any,
        *,
        checked_at: Any,
        probe_policy: Any,
        same_endpoint_copy_enabled: bool,
    ) -> _PlannedItem:
        checks: list[dict[str, Any]] = []

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

        source = self._inspect_source_bucket(
            source_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        target = self._inspect_target_bucket(
            target_ctx,
            item,
            probe_policy=probe_policy,
            add_check=add_check,
        )
        item.source_count = source.object_count
        item.target_count = target.object_count
        source_plan = self._plan_source_bucket(
            source_ctx,
            item,
            migration,
            profile=source.profile,
            object_count=source.object_count,
            initial_strategy=(
                "skip_existing" if target.exists is True else "current_only"
            ),
            add_check=add_check,
        )
        safety = self._evaluate_item_safety(
            source_ctx,
            target_ctx,
            item,
            migration,
            source_access_ok=source.access_ok,
            source_profile=source.profile,
            target_exists=target.exists,
            strategy=source_plan.strategy,
            same_endpoint_copy_enabled=same_endpoint_copy_enabled,
            add_check=add_check,
        )
        counts = _count_entries(checks)
        blocking = counts["blocking_errors"] > 0
        self._store_item_plan(
            item,
            checked_at=checked_at,
            source_profile=source.profile,
            target_profile=target.profile,
            strategy=source_plan.strategy,
            safety=safety,
            blocking=blocking,
            checks=checks,
        )
        return _PlannedItem(
            report={
                "item_id": item.id,
                "source_bucket": item.source_bucket,
                "target_bucket": item.target_bucket,
                "strategy": source_plan.strategy,
                "blocking": blocking,
                "delete_source_safe": safety.delete_source_safe,
                "rollback_safe": safety.rollback_safe,
                "same_endpoint_copy_safe": safety.same_endpoint_copy_safe,
                "source_object_count": source.object_count,
                "target_object_count": target.object_count,
                "source_profile": source.profile,
                "target_profile": target.profile,
                "checks": checks,
                "messages": checks,
                "errors": counts["errors"],
                "warnings": counts["warnings"],
            },
            infos=counts["infos"],
            warnings=counts["warnings"],
            blocking_errors=counts["blocking_errors"],
            same_endpoint_copy_safe=safety.same_endpoint_copy_safe,
            delete_source_safe=safety.delete_source_safe,
            rollback_safe=safety.rollback_safe,
            unsupported_features=source_plan.unsupported_features,
        )

    def _store_item_plan(
        self,
        item: Any,
        *,
        checked_at: Any,
        source_profile: dict[str, Any] | None,
        target_profile: dict[str, Any] | None,
        strategy: str,
        safety: _ItemSafety,
        blocking: bool,
        checks: list[dict[str, Any]],
    ) -> None:
        item.source_snapshot_json = self._service._json_dumps_safe(
            source_profile
        )
        item.target_snapshot_json = self._service._json_dumps_safe(
            target_profile
        )
        execution_plan = {
            "report_version": _PRECHECK_REPORT_VERSION,
            "strategy": strategy,
            "supported": not blocking,
            "blocked": blocking,
            "delete_source_safe": safety.delete_source_safe,
            "rollback_safe": safety.rollback_safe,
            "same_endpoint_copy_safe": safety.same_endpoint_copy_safe,
            "blocking_codes": [
                entry["code"]
                for entry in checks
                if str(entry.get("severity") or "").lower() == "error"
                and bool(entry.get("blocking"))
            ],
        }
        item.execution_plan_json = self._service._json_dumps_safe(
            execution_plan
        )
        item.updated_at = checked_at

    def _finalize_report(
        self,
        report: dict[str, Any],
        *,
        infos: int,
        warnings: int,
        blocking_errors: int,
        same_endpoint_copy_safe: bool,
        delete_source_safe: bool,
        rollback_safe: bool,
        unsupported_features: set[str],
    ) -> dict[str, Any]:
        report["same_endpoint_copy_safe"] = same_endpoint_copy_safe
        report["delete_source_safe"] = delete_source_safe
        report["rollback_safe"] = rollback_safe
        report["unsupported_features"] = sorted(unsupported_features)
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
                strategy: sum(
                    item.get("strategy") == strategy
                    for item in report["items"]
                )
                for strategy in (
                    "current_only",
                    "version_aware",
                    "skip_existing",
                )
            },
        }
        return report

    def run(self, migration: Any, *, checked_at: Any) -> dict[str, Any]:
        report = self._new_report(checked_at=checked_at)
        source_ctx, target_ctx, context_entries = self._resolve_contexts(
            migration,
            report,
        )
        if source_ctx is None or target_ctx is None or context_entries:
            return self._context_failure_report(
                report,
                migration,
                context_entries,
            )

        same_endpoint = bool(report.get("same_endpoint"))
        same_endpoint_copy_enabled = bool(
            same_endpoint and migration.use_same_endpoint_copy
        )
        global_same_endpoint_copy_safe = not same_endpoint_copy_enabled
        global_delete_source_safe = True
        global_rollback_safe = True
        global_unsupported_features: set[str] = set()
        blocking_errors = 0
        warnings = 0
        infos = 0
        probe_policy = self._inspector.build_probe_policy(
            copy_bucket_settings=bool(migration.copy_bucket_settings)
        )

        for item in sorted(migration.items, key=lambda entry: entry.id):
            planned = self._plan_item(
                source_ctx,
                target_ctx,
                item,
                migration,
                checked_at=checked_at,
                probe_policy=probe_policy,
                same_endpoint_copy_enabled=same_endpoint_copy_enabled,
            )
            report["items"].append(planned.report)
            infos += planned.infos
            warnings += planned.warnings
            blocking_errors += planned.blocking_errors
            global_unsupported_features.update(planned.unsupported_features)
            global_same_endpoint_copy_safe = (
                global_same_endpoint_copy_safe
                and planned.same_endpoint_copy_safe
            )
            global_delete_source_safe = (
                global_delete_source_safe and planned.delete_source_safe
            )
            global_rollback_safe = (
                global_rollback_safe and planned.rollback_safe
            )

        return self._finalize_report(
            report,
            infos=infos,
            warnings=warnings,
            blocking_errors=blocking_errors,
            same_endpoint_copy_safe=global_same_endpoint_copy_safe,
            delete_source_safe=global_delete_source_safe,
            rollback_safe=global_rollback_safe,
            unsupported_features=global_unsupported_features,
        )
