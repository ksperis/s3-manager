# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ast
from pathlib import Path


APPROVED_SANITIZERS = {
    "sanitize_error_detail",
    "sanitize_log_text",
    "sanitize_persisted_error",
    "sanitized_error_log_detail",
    "_truncate_db_text",
    "_truncate_optional_db_text",
}
APPROVED_RESPONSE_BODY_READERS = {"_parse_operation_payload"}


def _call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _contains_raw_exception_text(node: ast.AST) -> bool:
    if isinstance(node, ast.Call) and _call_name(node.func) in APPROVED_SANITIZERS:
        return False
    if (
        isinstance(node, ast.Call)
        and _call_name(node.func) == "str"
        and any(isinstance(argument, ast.Name) and argument.id == "exc" for argument in node.args)
    ):
        return True
    return any(_contains_raw_exception_text(child) for child in ast.iter_child_nodes(node))


def _persistence_target_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
        return str(node.slice.value)
    return None


def _external_error_violations(app_root: Path) -> list[str]:
    violations: list[str] = []
    for file_path in sorted(app_root.rglob("*.py")):
        tree = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Return) and node.value and _contains_raw_exception_text(node.value):
                violations.append(f"{file_path.relative_to(app_root)}:{node.lineno}:return-str-exc")
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                value = node.value
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    field = _persistence_target_name(target)
                    if field in {"error", "error_message", "reason"} and value and _contains_raw_exception_text(value):
                        violations.append(
                            f"{file_path.relative_to(app_root)}:{node.lineno}:persist-str-exc"
                        )
            if isinstance(node, ast.Call) and _call_name(node.func) not in APPROVED_SANITIZERS:
                for keyword in node.keywords:
                    if (
                        keyword.arg in {"error", "error_message", "reason"}
                        and _contains_raw_exception_text(keyword.value)
                    ):
                        violations.append(
                            f"{file_path.relative_to(app_root)}:{node.lineno}:persist-str-exc"
                        )
            if not isinstance(node, ast.Attribute) or node.attr != "text":
                continue
            if not isinstance(node.value, ast.Name) or node.value.id not in {"resp", "response"}:
                continue
            parent = parents.get(node)
            while parent is not None and not isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                parent = parents.get(parent)
            if not isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if parent.name not in APPROVED_RESPONSE_BODY_READERS:
                violations.append(
                    f"{file_path.relative_to(app_root)}:{node.lineno}:raw-response-text"
                )
    return sorted(violations)


def test_external_error_text_requires_approved_sanitizers():
    app_root = Path(__file__).resolve().parents[1] / "app"

    assert _external_error_violations(app_root) == []


def test_external_error_guard_detects_unsafe_patterns(tmp_path):
    app_root = tmp_path / "app"
    app_root.mkdir()
    app_root.joinpath("unsafe.py").write_text(
        "def unsafe(exc, response, row):\n"
        "    row.error_message = str(exc)\n"
        "    value = response.text\n"
        "    return str(exc)\n",
        encoding="utf-8",
    )

    assert _external_error_violations(app_root) == [
        "unsafe.py:2:persist-str-exc",
        "unsafe.py:3:raw-response-text",
        "unsafe.py:4:return-str-exc",
    ]
