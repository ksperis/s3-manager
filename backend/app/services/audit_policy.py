# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persistence boundary for the application audit log.

``audit_logs`` is intentionally limited to control-plane, security,
configuration, and workflow-control events. Object-level S3 activity belongs
to the data plane and must be obtained from the storage provider's access
logs.
"""
from __future__ import annotations


DATA_PLANE_AUDIT_ACTIONS = frozenset(
    {
        "upload_object",
        "upload_via_proxy",
        "download_object",
        "delete_object",
        "delete_objects",
        "copy_object",
        "create_folder",
        "update_object_metadata",
        "put_object_tags",
        "put_object_acl",
        "put_object_legal_hold",
        "put_object_retention",
        "multipart_init",
        "multipart_complete",
        "multipart_abort",
        "restore_object",
        "restore_object_version",
        "restore_deleted_object",
        "cleanup_object_versions",
    }
)

# These actions are operational telemetry or short-lived authentication noise,
# not durable control/security events.
NON_AUDIT_OPERATION_ACTIONS = frozenset(
    {
        "calculate_bucket_usage_stats",
        "collect_usage_history",
        "billing.collect_daily",
        "healthchecks.run",
        "ceph_admin.bucket.index_check",
        "refresh_access_token",
        "start_oidc_login",
    }
)

NON_PERSISTED_AUDIT_ACTIONS = DATA_PLANE_AUDIT_ACTIONS | NON_AUDIT_OPERATION_ACTIONS


def should_persist_audit_action(action: str) -> bool:
    """Return whether an action belongs in the application audit log."""

    return action not in NON_PERSISTED_AUDIT_ACTIONS
