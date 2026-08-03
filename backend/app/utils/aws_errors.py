# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from botocore.exceptions import ClientError


def aws_error_code(exc: Exception, *, lowercase: bool = False) -> str:
    if not isinstance(exc, ClientError):
        return ""
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    code = str(error.get("Code") or "").strip()
    return code.lower() if lowercase else code
