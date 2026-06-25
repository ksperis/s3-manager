# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pathlib import Path

from scripts.backend_refactor_inventory import render_markdown


def test_backend_refactor_inventory_renders_core_sections():
    backend_root = Path(__file__).resolve().parents[1]

    report = render_markdown(backend_root, largest_limit=3)

    assert "# Backend refactor inventory" in report
    assert "## Top-level size" in report
    assert "## Refactor and hardening signals" in report
    assert "## Router mutation/audit matrix" in report
    assert "`services`" in report
    assert "`detail=str(exc)`" in report
