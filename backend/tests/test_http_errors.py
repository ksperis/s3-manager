# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import HTTPException

from app.routers.http_errors import raise_bad_gateway_from_runtime


def test_raise_bad_gateway_from_runtime_preserves_runtime_message():
    try:
        raise_bad_gateway_from_runtime(RuntimeError("backend timeout"))
    except HTTPException as exc:
        assert exc.status_code == 502
        assert exc.detail == "backend timeout"
    else:
        raise AssertionError("Expected HTTPException")
