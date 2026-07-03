# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from urllib.parse import quote


def build_attachment_content_disposition(filename: str, *, fallback_name: str = "download") -> str:
    fallback = "".join(char if 0x20 <= ord(char) <= 0x7E else "_" for char in filename).replace('"', '\\"')
    encoded = quote(filename, safe="")
    return f'attachment; filename="{fallback or fallback_name}"; filename*=UTF-8\'\'{encoded}'
