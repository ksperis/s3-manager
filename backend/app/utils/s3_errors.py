# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from botocore.exceptions import ClientError

from app.core.sensitive_data import sanitized_error_log_detail
from app.utils.aws_errors import aws_error_code


def format_s3_error(exc: Exception, *, include_operation: bool = False) -> str:
    if not isinstance(exc, ClientError):
        return sanitized_error_log_detail(exc)
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    code = aws_error_code(exc)
    message = str(error.get("Message") or "").strip()
    parts = [part for part in (code, message) if part and part.lower() != "none"]
    detail = ": ".join(parts) if parts else sanitized_error_log_detail(exc)
    operation = str(getattr(exc, "operation_name", "") or "").strip()
    if include_operation and operation:
        return sanitized_error_log_detail(f"{operation} failed with {detail}")
    return sanitized_error_log_detail(detail)
