# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ast
from pathlib import Path


SESSION_PERSISTENCE_METHODS = {
    "add",
    "add_all",
    "bulk_insert_mappings",
    "bulk_save_objects",
    "bulk_update_mappings",
    "commit",
    "delete",
    "execute",
    "flush",
    "merge",
    "refresh",
    "update",
}


def _root_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return _root_name(node.value)
    if isinstance(node, ast.Call):
        return _root_name(node.func)
    return None


def _mentions_session(annotation: ast.AST | None) -> bool:
    if annotation is None:
        return False
    return any(
        (isinstance(node, ast.Name) and node.id == "Session")
        or (isinstance(node, ast.Attribute) and node.attr == "Session")
        for node in ast.walk(annotation)
    )


def _session_parameter_names(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
        names.update(
            argument.arg
            for argument in arguments
            if _mentions_session(argument.annotation)
        )
    return names


def _router_persistence_calls(app_root: Path) -> list[str]:
    violations: list[str] = []
    routers_root = app_root / "routers"
    for file_path in sorted(routers_root.rglob("*.py")):
        tree = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
        session_names = _session_parameter_names(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr not in SESSION_PERSISTENCE_METHODS:
                continue
            if _root_name(node.func.value) in session_names:
                violations.append(
                    f"{file_path.relative_to(app_root)}:{node.lineno}:{node.func.attr}"
                )
    return violations


def test_routers_delegate_persistence_to_services():
    app_root = Path(__file__).resolve().parents[1] / "app"

    assert _router_persistence_calls(app_root) == []


def test_router_persistence_guard_detects_session_and_query_writes(tmp_path):
    app_root = tmp_path / "app"
    routers_root = app_root / "routers"
    routers_root.mkdir(parents=True)
    routers_root.joinpath("unsafe.py").write_text(
        "from sqlalchemy.orm import Session\n"
        "\n"
        "def unsafe_route(session: Session):\n"
        "    session.commit()\n"
        "    session.query(object).update({})\n",
        encoding="utf-8",
    )

    assert _router_persistence_calls(app_root) == [
        "routers/unsafe.py:4:commit",
        "routers/unsafe.py:5:update",
    ]
