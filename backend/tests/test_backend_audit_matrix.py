# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pathlib import Path

from scripts.backend_audit_matrix import collect_rows, render_markdown


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
    assert "## Full mutating route matrix" in report
    assert "Direct audit" in report
