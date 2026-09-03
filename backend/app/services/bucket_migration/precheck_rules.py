# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class PrecheckItemSafety:
    same_endpoint_copy_safe: bool
    delete_source_safe: bool
    rollback_safe: bool


class BucketMigrationPrecheckRules:
    """Evaluate migration strategy and fail-closed safety rules for one item."""

    def __init__(self, service: Any) -> None:
        self._service = service

    def add_source_strategy_check(
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
            "has_delete_markers": bool(version_scan.get("has_delete_markers")),
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

    def add_source_encryption_check(
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

    def add_unsupported_settings_check(
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

    def validate_version_aware_source_access(
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

    def evaluate_item_safety(
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
    ) -> PrecheckItemSafety:
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
        if target_exists is not True:
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
        return PrecheckItemSafety(
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
                auto_grant=bool(migration.auto_grant_source_read_for_copy),
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
