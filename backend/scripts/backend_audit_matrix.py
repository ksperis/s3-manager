#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import argparse
import ast
from dataclasses import dataclass
from pathlib import Path

MUTATING_METHODS = {"post", "put", "patch", "delete"}
SIGNAL_FIELDS = {
    "record_action": "record_action(",
    "audit_service": "audit_service",
    "actor": "current_user",
    "scope": "scope=",
    "entity_type": "entity_type=",
    "entity_id": "entity_id=",
    "account": "account=",
    "metadata": "metadata=",
    "delegated_browser_audit": "_common_record_browser_action(",
    "delegated_bucket_config_mutation_audit": "BucketConfigMutationService = Depends(",
    "delegated_ceph_admin_audit": "record_ceph_admin_action(",
    "delegated_ceph_admin_bucket_config_audit": "_record_bucket_config_mutation(",
    "delegated_ceph_admin_bucket_config_wrapper": "_run_bucket_config_",
    "delegated_ceph_admin_bucket_ui_tags_audit": "CephAdminBucketUiTagsWorkflow = Depends(",
    "delegated_purge_stream": "stream_bucket_purge(",
    "delegated_integrity_stream": "stream_bucket_integrity_check(",
    "delegated_portal_request_create_audit": "service.create_request(",
    "delegated_portal_request_approve_audit": "service.approve_request(",
    "delegated_portal_request_reject_audit": "service.reject_request(",
    "delegated_portal_request_message_audit": "service.add_admin_message(",
    "delegated_private_access_audit": "ManagedPrivateAccessService(db).",
    "delegated_ceph_admin_execute_audit": "_execute(",
    "delegated_portal_deleted_restore_audit": "stream_portal_deleted_prefix_restore(",
    "delegated_portal_version_cleanup_audit": "stream_portal_storage_space_version_cleanup(",
}
DELEGATED_AUDIT_SIGNALS = frozenset(
    {
        "delegated_browser_audit",
        "delegated_bucket_config_mutation_audit",
        "delegated_ceph_admin_audit",
        "delegated_ceph_admin_bucket_config_audit",
        "delegated_ceph_admin_bucket_config_wrapper",
        "delegated_ceph_admin_bucket_ui_tags_audit",
        "delegated_purge_stream",
        "delegated_integrity_stream",
        "delegated_portal_request_create_audit",
        "delegated_portal_request_approve_audit",
        "delegated_portal_request_reject_audit",
        "delegated_portal_request_message_audit",
        "delegated_private_access_audit",
        "delegated_ceph_admin_execute_audit",
        "delegated_portal_deleted_restore_audit",
        "delegated_portal_version_cleanup_audit",
    }
)

ALLOWLISTED_UNAUDITED_ROUTES: dict[tuple[str, str, str, str], str] = {
    ("POST", "app/routers/admin/s3_connections.py", "validate_s3_connection_credentials", "/validate-credentials"): "credential validation probe",
    ("POST", "app/routers/admin/storage_endpoints.py", "detect_storage_endpoint_features", "/detect-features"): "feature detection probe",
    ("POST", "app/routers/admin/usage_stats.py", "stream_admin_managed_usage_stats_aggregate", "/admin/usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/admin/billing.py", "billing_collect_daily", "/collect/daily"): "operational collection excluded by audit policy",
    ("POST", "app/routers/admin/healthchecks.py", "run_healthchecks", "/run"): "operational health probe excluded by audit policy",
    ("POST", "app/routers/admin/settings.py", "send_quota_notifications_test_email", "/quota-notifications/test-email"): "notification delivery probe",
    ("POST", "app/routers/admin/usage_history.py", "collect_usage_history", "/collect"): "operational collection excluded by audit policy",
    ("POST", "app/routers/auth.py", "start_oidc_login", "/oidc/{provider_id}/start"): "short-lived authentication operation excluded by audit policy",
    ("POST", "app/routers/auth_sessions.py", "refresh_access_token", "/refresh"): "short-lived authentication operation excluded by audit policy",
    ("POST", "app/routers/auth.py", "webauthn_registration_options", "/webauthn/registration/options"): "short-lived authentication challenge",
    ("POST", "app/routers/auth.py", "webauthn_authentication_options", "/webauthn/authentication/options"): "short-lived authentication challenge",
    ("POST", "app/routers/auth_sessions.py", "profile_webauthn_authentication_options", "/security/webauthn/authentication/options"): "short-lived authentication challenge",
    ("POST", "app/routers/auth_sessions.py", "profile_webauthn_registration_options", "/security/webauthn/registration/options"): "short-lived authentication challenge",
    ("POST", "app/routers/browser_objects.py", "copy_object", "/buckets/{bucket_name}/copy"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_objects.py", "delete_objects", "/buckets/{bucket_name}/delete"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_objects.py", "create_folder", "/buckets/{bucket_name}/folders"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_transfers.py", "multipart_init", "/buckets/{bucket_name}/multipart/initiate"): "data-plane operation covered by provider access logs",
    ("DELETE", "app/routers/browser_transfers.py", "abort_multipart_upload", "/buckets/{bucket_name}/multipart/{upload_id}"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_transfers.py", "complete_multipart_upload", "/buckets/{bucket_name}/multipart/{upload_id}/complete"): "data-plane operation covered by provider access logs",
    ("PUT", "app/routers/browser_objects.py", "put_object_acl", "/buckets/{bucket_name}/object-acl"): "data-plane operation covered by provider access logs",
    ("PUT", "app/routers/browser_objects.py", "put_object_legal_hold", "/buckets/{bucket_name}/object-legal-hold"): "data-plane operation covered by provider access logs",
    ("PUT", "app/routers/browser_objects.py", "update_object_metadata", "/buckets/{bucket_name}/object-meta"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_objects.py", "restore_object", "/buckets/{bucket_name}/object-restore"): "data-plane operation covered by provider access logs",
    ("PUT", "app/routers/browser_objects.py", "put_object_retention", "/buckets/{bucket_name}/object-retention"): "data-plane operation covered by provider access logs",
    ("PUT", "app/routers/browser_objects.py", "put_object_tags", "/buckets/{bucket_name}/object-tags"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_transfers.py", "upload_via_proxy", "/buckets/{bucket_name}/proxy-upload"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser_objects.py", "cleanup_object_versions", "/buckets/{bucket_name}/versions/cleanup"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/browser.py", "get_object_columns", "/buckets/{bucket_name}/objects/columns"): "object metadata probe",
    ("POST", "app/routers/browser_transfers.py", "presign", "/buckets/{bucket_name}/presign"): "presigned URL generation",
    ("POST", "app/routers/browser_transfers.py", "presign_part_for_upload", "/buckets/{bucket_name}/multipart/{upload_id}/presign"): "presigned multipart URL generation",
    ("PUT", "app/routers/browser_bucket_config.py", "deny_bucket_quota_update", "/buckets/config/{bucket_name}/quota"): "authorization tombstone",
    ("POST", "app/routers/ceph_admin/bucket_tools.py", "refresh_bucket_listing_cache", "/cache/refresh"): "cache refresh",
    ("POST", "app/routers/ceph_admin/bucket_tools.py", "compare_bucket_pair", "/compare"): "read-only comparison",
    ("POST", "app/routers/ceph_admin/buckets.py", "query_buckets", "/query"): "read-only query",
    ("POST", "app/routers/ceph_admin/bucket_index_ops.py", "stream_bucket_index_check_batch", "/bucket-index-check/stream"): "operational index check excluded by audit policy",
    ("POST", "app/routers/ceph_admin/bucket_tools.py", "backup_bucket_configs", "/config-backup"): "read-only configuration export",
    ("POST", "app/routers/ceph_admin/usage_stats.py", "stream_ceph_admin_bucket_usage_stats", "/ceph-admin/endpoints/{endpoint_id}/bucket-usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/ceph_admin/usage_stats.py", "stream_ceph_admin_bucket_usage_stats_for_bucket", "/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket_name}/usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/ceph_admin/usage_stats.py", "stream_ceph_admin_usage_stats_aggregate", "/ceph-admin/endpoints/{endpoint_id}/usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/connections.py", "validate_connection_credentials", "/validate-credentials"): "credential validation probe",
    ("POST", "app/routers/internal/billing_collect.py", "collect_daily", "/collect/daily"): "internal token-protected job",
    ("POST", "app/routers/internal/healthchecks.py", "run_healthchecks", "/run"): "internal token-protected job",
    ("POST", "app/routers/internal/quota_monitor.py", "run_quota_monitor", "/run"): "internal token-protected job",
    ("POST", "app/routers/internal/usage_history.py", "collect_usage_history", "/collect"): "internal token-protected job",
    ("POST", "app/routers/internal/user_notifications.py", "purge_user_notifications", "/purge"): "internal token-protected retention job",
    ("POST", "app/routers/manager/buckets.py", "compare_bucket_pair", "/compare"): "read-only comparison",
    ("POST", "app/routers/manager/usage_stats.py", "stream_manager_bucket_usage_stats_for_bucket", "/manager/buckets/{bucket_name}/usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/manager/usage_stats.py", "stream_manager_usage_stats_aggregate", "/manager/usage-stats/stream"): "read-only stream",
    ("POST", "app/routers/storage_ops/buckets.py", "refresh_storage_ops_bucket_listing_cache", "/cache/refresh"): "cache refresh",
    ("POST", "app/routers/storage_ops/buckets.py", "query_storage_ops_buckets", "/query"): "read-only query",
    ("PATCH", "app/routers/storage_ops/bucket_ui_tags.py", "patch_bucket_ui_tags", ""): "user-private UI metadata excluded from the global audit log",
    ("PATCH", "app/routers/storage_ops/bucket_ui_tags.py", "patch_bucket_ui_tag_definition", "/{tag_id}"): "user-private UI metadata excluded from the global audit log",
    ("DELETE", "app/routers/portal_objects.py", "portal_delete_storage_space_object", "/storage-spaces/{space_id}/objects"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/portal_objects.py", "portal_restore_storage_space_object", "/storage-spaces/{space_id}/objects/restore"): "data-plane operation covered by provider access logs",
    ("POST", "app/routers/storage_ops/usage_stats.py", "stream_storage_ops_bucket_usage_stats", "/stream"): "read-only stream",
    ("DELETE", "app/routers/users.py", "delete_my_read_notifications", "/me/notifications"): "user-local notification cleanup",
    ("DELETE", "app/routers/users.py", "delete_my_notification", "/me/notifications/{notification_id}"): "user-local notification cleanup",
    ("POST", "app/routers/users.py", "mark_my_notifications_read", "/me/notifications/read"): "user-local read marker",
}


@dataclass(frozen=True)
class RouteAuditRow:
    file: Path
    function: str
    method: str
    path: str
    signals: dict[str, bool]

    @property
    def has_audit_signal(self) -> bool:
        return self.signals["record_action"] or self.has_delegated_audit_signal

    @property
    def has_delegated_audit_signal(self) -> bool:
        return any(self.signals[name] for name in DELEGATED_AUDIT_SIGNALS)

    def allowlist_reason(self, backend_root: Path) -> str | None:
        key = (self.method, str(self.file.relative_to(backend_root)), self.function, self.path)
        return ALLOWLISTED_UNAUDITED_ROUTES.get(key)


def _decorator_route(decorator: ast.AST) -> tuple[str, str] | None:
    if not isinstance(decorator, ast.Call):
        return None
    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return None
    method = func.attr.lower()
    if method not in MUTATING_METHODS:
        return None
    if not isinstance(func.value, ast.Name) or func.value.id != "router":
        return None
    if decorator.args and isinstance(decorator.args[0], ast.Constant):
        return method, str(decorator.args[0].value or "")
    return method, ""


def collect_rows(backend_root: Path) -> list[RouteAuditRow]:
    routers_root = backend_root / "app" / "routers"
    rows: list[RouteAuditRow] = []
    for file_path in sorted(routers_root.rglob("*.py")):
        source = file_path.read_text(encoding="utf-8", errors="ignore")
        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError:
            continue
        lines = source.splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            routes = [route for decorator in node.decorator_list if (route := _decorator_route(decorator))]
            if not routes:
                continue
            end_lineno = getattr(node, "end_lineno", node.lineno)
            body = "\n".join(lines[node.lineno - 1 : end_lineno])
            signals = {name: marker in body for name, marker in SIGNAL_FIELDS.items()}
            signals["delegated_bucket_config_mutation_audit"] = signals[
                "delegated_bucket_config_mutation_audit"
            ] and ("mutation.update(" in body or "mutation.delete(" in body)
            signals["delegated_ceph_admin_bucket_ui_tags_audit"] = signals[
                "delegated_ceph_admin_bucket_ui_tags_audit"
            ] and (
                "workflow.mutate(" in body
                or "workflow.update_definition(" in body
            )
            for method, path in routes:
                rows.append(
                    RouteAuditRow(
                        file=file_path,
                        function=node.name,
                        method=method.upper(),
                        path=path,
                        signals=signals,
                    )
                )
    return sorted(rows, key=lambda row: (str(row.file), row.path, row.method, row.function))


def render_markdown(backend_root: Path) -> str:
    rows = collect_rows(backend_root)
    allowlisted_no_signal = [
        row
        for row in rows
        if not row.has_audit_signal and row.allowlist_reason(backend_root)
    ]
    no_signal = [
        row
        for row in rows
        if not row.has_audit_signal and not row.allowlist_reason(backend_root)
    ]
    with_record = [row for row in rows if row.signals["record_action"]]
    delegated = [
        row
        for row in rows
        if row.has_delegated_audit_signal
    ]
    lines = [
        "# Backend mutating-route audit matrix",
        "",
        f"- Backend root: `{backend_root}`",
        f"- Mutating routes: {len(rows)}",
        f"- Routes with direct `record_action`: {len(with_record)}",
        f"- Routes with delegated audit/stream signal: {len(delegated)}",
        f"- Allowlisted routes without static audit signal: {len(allowlisted_no_signal)}",
        f"- Routes without static audit signal: {len(no_signal)}",
        "",
        "## Routes without static audit signal",
        "",
        "| Method | File | Function | Path |",
        "| --- | --- | --- | --- |",
    ]
    for row in no_signal:
        lines.append(f"| {row.method} | `{row.file.relative_to(backend_root)}` | `{row.function}` | `{row.path}` |")

    lines.extend(
        [
            "",
            "## Allowlisted Routes Without Audit Signal",
            "",
            "| Method | File | Function | Path | Reason |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for row in allowlisted_no_signal:
        reason = row.allowlist_reason(backend_root) or ""
        lines.append(f"| {row.method} | `{row.file.relative_to(backend_root)}` | `{row.function}` | `{row.path}` | {reason} |")

    lines.extend(
        [
            "",
            "## Full mutating route matrix",
            "",
            "| Method | File | Function | Path | Direct audit | Actor | Scope | Entity | Account | Metadata | Delegated |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        lines.append(
            "| {method} | `{file}` | `{function}` | `{path}` | {direct} | {actor} | {scope} | {entity} | {account} | {metadata} | {delegated} |".format(
                method=row.method,
                file=row.file.relative_to(backend_root),
                function=row.function,
                path=row.path,
                direct="yes" if row.signals["record_action"] else "no",
                actor="yes" if row.signals["actor"] or "current_user" in row.function else "no",
                scope="yes" if row.signals["scope"] else "no",
                entity="yes" if row.signals["entity_type"] and row.signals["entity_id"] else "no",
                account="yes" if row.signals["account"] else "no",
                metadata="yes" if row.signals["metadata"] else "no",
                delegated="yes" if row.has_delegated_audit_signal else "no",
            )
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Print a Markdown audit matrix for mutating backend routes.")
    parser.add_argument("--backend-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(render_markdown(args.backend_root.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
