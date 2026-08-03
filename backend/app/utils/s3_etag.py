# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re


def etag_md5(etag: str | None) -> str | None:
    if not etag:
        return None
    value = etag.strip().strip('"')
    if not value:
        return None
    if re.fullmatch(r"[0-9a-fA-F]{32}", value):
        return value.lower()
    return None
