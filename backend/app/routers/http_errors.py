# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException, status


def raise_bad_gateway_from_runtime(exc: RuntimeError) -> NoReturn:
    """Preserve current UX: RuntimeError is returned as 502 with raw detail string."""
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
