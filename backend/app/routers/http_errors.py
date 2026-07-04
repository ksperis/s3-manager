# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations
from typing import NoReturn

from fastapi import HTTPException, status

from app.core.sensitive_data import (
    sanitize_error_detail,
    sanitized_error_log_detail,
)


def raise_bad_gateway_from_runtime(exc: RuntimeError) -> NoReturn:
    raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


def raise_bad_gateway_from_exception(exc: Exception) -> NoReturn:
    raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


def raise_bad_request_from_value_error(exc: ValueError) -> NoReturn:
    raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


def raise_http_exception_from_exception(status_code: int, exc: Exception) -> NoReturn:
    raise HTTPException(
        status_code=status_code,
        detail=sanitize_error_detail(str(exc)),
    ) from exc
