# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities


def make_execution_context(**overrides: Any) -> ExecutionContext:
    values: dict[str, Any] = {
        "kind": "account",
        "id": "1",
        "display_name": "Execution context",
        "endpoint_name": "Storage endpoint",
        "endpoint_is_default": False,
        "endpoint_url": "https://s3.example.test",
        "storage_endpoint_capabilities": {},
        "capabilities": ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    }
    values.update(overrides)
    return ExecutionContext(**values)
