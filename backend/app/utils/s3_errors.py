# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from botocore.exceptions import ClientError


def s3_error_code(exc: Exception, *, lowercase: bool = False) -> str:
    if not isinstance(exc, ClientError):
        return ""
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    code = str(error.get("Code") or "").strip()
    return code.lower() if lowercase else code


def format_s3_error(exc: Exception, *, include_operation: bool = False) -> str:
    if not isinstance(exc, ClientError):
        return str(exc)
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    code = s3_error_code(exc)
    message = str(error.get("Message") or "").strip()
    parts = [part for part in (code, message) if part and part.lower() != "none"]
    detail = ": ".join(parts) if parts else str(exc)
    operation = str(getattr(exc, "operation_name", "") or "").strip()
    if include_operation and operation:
        return f"{operation} failed with {detail}"
    return detail
