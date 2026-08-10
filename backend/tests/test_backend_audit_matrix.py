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


def test_backend_audit_matrix_classifies_every_mutating_route():
    backend_root = Path(__file__).resolve().parents[1]

    unclassified = [
        row
        for row in collect_rows(backend_root)
        if not row.has_audit_signal and not row.allowlist_reason(backend_root)
    ]

    assert unclassified == []
