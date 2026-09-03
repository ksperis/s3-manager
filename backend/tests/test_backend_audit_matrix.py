# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pathlib import Path

from scripts.backend_audit_matrix import (
    ALLOWLISTED_UNAUDITED_ROUTES,
    SIGNAL_FIELDS,
    RouteAuditRow,
    collect_rows,
    render_markdown,
)


def test_backend_audit_matrix_collects_mutating_routes():
    backend_root = Path(__file__).resolve().parents[1]

    rows = collect_rows(backend_root)

    assert rows
    assert any(row.method == "POST" and row.file.name == "auth.py" for row in rows)
    assert all(row.method in {"POST", "PUT", "PATCH", "DELETE"} for row in rows)


def test_backend_audit_matrix_renders_summary_sections():
    backend_root = Path(__file__).resolve().parents[1]

    report = render_markdown(backend_root)

    assert "# Backend mutating-route audit matrix" in report
    assert "## Routes without static audit signal" in report
    assert "## Allowlisted Routes Without Audit Signal" in report
    assert "## Full mutating route matrix" in report
    assert "Allowlisted routes without static audit signal" in report
    assert "Direct audit" in report


def test_backend_audit_matrix_does_not_treat_context_fields_as_audit_signals():
    signals = {name: False for name in SIGNAL_FIELDS}
    signals.update(
        {
            "audit_service": True,
            "actor": True,
            "scope": True,
            "entity_type": True,
            "entity_id": True,
            "account": True,
            "metadata": True,
        }
    )
    row = RouteAuditRow(
        file=Path("app/routers/example.py"),
        function="mutate_without_audit",
        method="POST",
        path="/example",
        signals=signals,
    )

    assert row.has_audit_signal is False
    signals["delegated_browser_audit"] = True
    assert row.has_audit_signal is True


def test_backend_audit_matrix_allowlist_entries_exist_without_audit_signals():
    backend_root = Path(__file__).resolve().parents[1]

    rows = collect_rows(backend_root)
    by_key = {
        (row.method, str(row.file.relative_to(backend_root)), row.function, row.path): row
        for row in rows
    }

    for key, reason in ALLOWLISTED_UNAUDITED_ROUTES.items():
        row = by_key.get(key)
        assert row is not None, key
        assert not row.has_audit_signal, key
        assert row.allowlist_reason(backend_root) == reason


def test_backend_audit_matrix_tracks_portal_stream_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows_by_function = {row.function: row for row in collect_rows(backend_root)}

    assert rows_by_function["portal_restore_deleted_prefix_stream"].file.relative_to(backend_root) == Path(
        "app/routers/portal_objects.py"
    )
    assert rows_by_function["portal_restore_deleted_prefix_stream"].signals[
        "delegated_portal_deleted_restore_audit"
    ]
    assert rows_by_function["portal_storage_space_version_cleanup_stream"].signals[
        "delegated_portal_version_cleanup_audit"
    ]



def test_backend_audit_matrix_tracks_shared_bucket_config_mutation_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    rows_by_function = {row.function: row for row in collect_rows(backend_root)}

    assert rows_by_function["update_bucket_versioning_config"].file.relative_to(backend_root) == Path(
        "app/routers/browser_bucket_config.py"
    )
    assert rows_by_function["update_bucket_versioning_config"].signals[
        "delegated_bucket_config_mutation_audit"
    ]
    assert rows_by_function["delete_bucket_encryption_config"].signals[
        "delegated_bucket_config_mutation_audit"
    ]
    assert rows_by_function["put_bucket_encryption"].file.relative_to(backend_root) == Path(
        "app/routers/manager/bucket_config.py"
    )
    assert rows_by_function["put_bucket_encryption"].signals["delegated_bucket_config_mutation_audit"]
    assert rows_by_function["delete_bucket_encryption"].signals["delegated_bucket_config_mutation_audit"]


def test_backend_audit_matrix_tracks_ceph_admin_bucket_ui_tag_delegation():
    backend_root = Path(__file__).resolve().parents[1]
    row = next(
        row
        for row in collect_rows(backend_root)
        if row.function == "patch_bucket_ui_tags"
        and row.file.relative_to(backend_root)
        == Path("app/routers/ceph_admin/bucket_ui_tags.py")
    )

    assert row.signals["delegated_ceph_admin_bucket_ui_tags_audit"]


def test_backend_audit_matrix_classifies_every_mutating_route():
    backend_root = Path(__file__).resolve().parents[1]

    unclassified = [
        row
        for row in collect_rows(backend_root)
        if not row.has_audit_signal and not row.allowlist_reason(backend_root)
    ]

    assert unclassified == []
