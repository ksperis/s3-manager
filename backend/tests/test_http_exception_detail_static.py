# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ast
from pathlib import Path


SANITIZING_HELPERS = {
    "raise_bad_gateway_from_exception",
    "raise_bad_gateway_from_runtime",
    "raise_bad_request_from_value_error",
    "raise_http_exception_from_exception",
    "sanitize_error_detail",
    "sanitized_error_log_detail",
}


def _call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _is_http_exception_call(node: ast.Call) -> bool:
    return _call_name(node.func) == "HTTPException"


def _contains_unsanitized_exception(node: ast.AST) -> bool:
    if isinstance(node, ast.Call) and _call_name(node.func) in SANITIZING_HELPERS:
        return False
    if isinstance(node, ast.Name) and node.id == "exc":
        return True
    return any(_contains_unsanitized_exception(child) for child in ast.iter_child_nodes(node))


def _unsafe_http_exception_details(app_root: Path) -> list[str]:
    unsafe: list[str] = []
    for file_path in sorted([*app_root.joinpath("routers").rglob("*.py"), *app_root.joinpath("services").rglob("*.py")]):
        tree = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not _is_http_exception_call(node):
                continue
            detail_nodes = [keyword.value for keyword in node.keywords if keyword.arg == "detail"]
            if len(node.args) >= 2:
                detail_nodes.append(node.args[1])
            for detail_node in detail_nodes:
                if _contains_unsanitized_exception(detail_node):
                    unsafe.append(f"{file_path.relative_to(app_root)}:{node.lineno}")
                    break
    return unsafe


def test_http_exception_details_do_not_embed_raw_exception_text():
    app_root = Path(__file__).resolve().parents[1] / "app"

    unsafe = _unsafe_http_exception_details(app_root)

    assert unsafe == []
