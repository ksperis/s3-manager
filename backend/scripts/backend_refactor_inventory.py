#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

APP_ROOT = Path("app")
PATTERNS = {
    "detail=str(exc)": "detail=str(exc)",
    "message=str(exc)": "message=str(exc)",
    "str(exc)": "str(exc)",
    "except Exception as exc": "except Exception as exc",
    "raise HTTPException": "raise HTTPException",
    "record_action": "record_action(",
}
ROUTE_RE = re.compile(r"@router\.(get|post|put|patch|delete)\(")
MUTATING_METHODS = {"post", "put", "patch", "delete"}


def _line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8", errors="ignore").splitlines())


def _python_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if path.is_file())


def _top_level_counts(app_root: Path) -> list[tuple[str, int, int]]:
    grouped: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for path in _python_files(app_root):
        rel = path.relative_to(app_root)
        top_level = rel.parts[0] if len(rel.parts) > 1 else rel.name
        grouped[top_level][0] += 1
        grouped[top_level][1] += _line_count(path)
    return sorted(
        ((name, counts[0], counts[1]) for name, counts in grouped.items()),
        key=lambda row: (-row[2], row[0]),
    )


def _largest_files(app_root: Path, *, limit: int) -> list[tuple[int, Path]]:
    return sorted(
        ((_line_count(path), path) for path in _python_files(app_root)),
        key=lambda row: (-row[0], str(row[1])),
    )[:limit]


def _pattern_counts(app_root: Path) -> list[tuple[str, int, int, list[tuple[int, Path]]]]:
    rows: list[tuple[str, int, int, list[tuple[int, Path]]]] = []
    for label, pattern in PATTERNS.items():
        per_file: list[tuple[int, Path]] = []
        for path in _python_files(app_root):
            count = path.read_text(encoding="utf-8", errors="ignore").count(pattern)
            if count:
                per_file.append((count, path))
        rows.append((label, sum(count for count, _ in per_file), len(per_file), sorted(per_file, reverse=True)[:10]))
    return rows


def _db_api_overlaps(app_root: Path) -> list[str]:
    db_dir = app_root / "db"
    models_dir = app_root / "models"
    stems: dict[str, set[str]] = defaultdict(set)
    for base, label in ((db_dir, "db"), (models_dir, "models")):
        if not base.exists():
            continue
        for path in sorted(base.glob("*.py")):
            if path.name == "__init__.py":
                continue
            stems[path.stem].add(label)
    return [stem for stem, labels in sorted(stems.items()) if labels == {"db", "models"}]


def _route_matrix(app_root: Path) -> list[tuple[Path, int, int, int]]:
    rows: list[tuple[Path, int, int, int]] = []
    routers_dir = app_root / "routers"
    for path in _python_files(routers_dir):
        text = path.read_text(encoding="utf-8", errors="ignore")
        methods = ROUTE_RE.findall(text)
        if not methods:
            continue
        mutating = sum(1 for method in methods if method in MUTATING_METHODS)
        rows.append((path, len(methods), mutating, text.count("record_action(")))
    return sorted(rows, key=lambda row: (-row[2], -row[1], str(row[0])))


def render_markdown(backend_root: Path, *, largest_limit: int) -> str:
    app_root = backend_root / APP_ROOT
    app_files = _python_files(app_root)
    total_lines = sum(_line_count(path) for path in app_files)
    lines: list[str] = [
        "# Backend refactor inventory",
        "",
        f"- Backend root: `{backend_root}`",
        f"- Python files under `app`: {len(app_files)}",
        f"- Lines under `app`: {total_lines}",
        "",
        "## Top-level size",
        "",
        "| Area | Files | Lines |",
        "| --- | ---: | ---: |",
    ]
    for area, file_count, line_count in _top_level_counts(app_root):
        lines.append(f"| `{area}` | {file_count} | {line_count} |")

    lines.extend(["", "## Largest files", "", "| Lines | File |", "| ---: | --- |"])
    for line_count, path in _largest_files(app_root, limit=largest_limit):
        lines.append(f"| {line_count} | `{path.relative_to(backend_root)}` |")

    lines.extend(["", "## Refactor and hardening signals", "", "| Signal | Occurrences | Files | Top files |", "| --- | ---: | ---: | --- |"])
    for label, total, file_count, top_files in _pattern_counts(app_root):
        top = ", ".join(f"`{path.relative_to(backend_root)}` ({count})" for count, path in top_files[:5])
        lines.append(f"| `{label}` | {total} | {file_count} | {top} |")

    overlaps = _db_api_overlaps(app_root)
    lines.extend(
        [
            "",
            "## DB/API model filename overlaps",
            "",
            f"- Count: {len(overlaps)}",
            f"- Names: {', '.join(f'`{name}`' for name in overlaps) if overlaps else 'none'}",
            "",
            "## Router mutation/audit matrix",
            "",
            "| File | Routes | Mutating routes | `record_action` calls |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for path, route_count, mutating_count, audit_count in _route_matrix(app_root)[:40]:
        lines.append(f"| `{path.relative_to(backend_root)}` | {route_count} | {mutating_count} | {audit_count} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Print a Markdown inventory for backend refactor planning.")
    parser.add_argument("--backend-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--largest-limit", type=int, default=20)
    args = parser.parse_args()
    print(render_markdown(args.backend_root.resolve(), largest_limit=args.largest_limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
