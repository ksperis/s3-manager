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
    "delegated_purge_stream": "stream_bucket_purge(",
    "delegated_integrity_stream": "stream_bucket_integrity_check(",
}


@dataclass(frozen=True)
class RouteAuditRow:
    file: Path
    function: str
    method: str
    path: str
    signals: dict[str, bool]

    @property
    def has_any_audit_signal(self) -> bool:
        return any(self.signals.values())


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
    no_signal = [row for row in rows if not row.has_any_audit_signal]
    with_record = [row for row in rows if row.signals["record_action"]]
    delegated = [
        row
        for row in rows
        if row.signals["delegated_browser_audit"]
        or row.signals["delegated_purge_stream"]
        or row.signals["delegated_integrity_stream"]
    ]
    lines = [
        "# Backend mutating-route audit matrix",
        "",
        f"- Backend root: `{backend_root}`",
        f"- Mutating routes: {len(rows)}",
        f"- Routes with direct `record_action`: {len(with_record)}",
        f"- Routes with delegated audit/stream signal: {len(delegated)}",
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
            "## Full mutating route matrix",
            "",
            "| Method | File | Function | Path | Direct audit | Actor | Scope | Entity | Account | Metadata | Delegated |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        delegated_signal = row.signals["delegated_browser_audit"] or row.signals["delegated_purge_stream"] or row.signals["delegated_integrity_stream"]
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
                delegated="yes" if delegated_signal else "no",
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
