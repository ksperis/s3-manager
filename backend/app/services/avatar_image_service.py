# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

MAX_AVATAR_BYTES = 1024 * 1024
ALLOWED_AVATAR_CONTENT_TYPES = {"image/jpeg", "image/png"}


def _detected_content_type(payload: bytes) -> str | None:
    if len(payload) >= 24 and payload.startswith(b"\x89PNG\r\n\x1a\n") and payload[12:16] == b"IHDR":
        return "image/png"
    if len(payload) >= 4 and payload.startswith(b"\xff\xd8\xff") and payload.endswith(b"\xff\xd9"):
        return "image/jpeg"
    return None


def _image_dimensions(payload: bytes, content_type: str) -> tuple[int, int] | None:
    if content_type == "image/png":
        return int.from_bytes(payload[16:20], "big"), int.from_bytes(payload[20:24], "big")
    if content_type != "image/jpeg":
        return None
    offset = 2
    while offset + 4 <= len(payload):
        if payload[offset] != 0xFF:
            offset += 1
            continue
        marker = payload[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if offset + 2 > len(payload):
            return None
        segment_length = int.from_bytes(payload[offset : offset + 2], "big")
        if segment_length < 2 or offset + segment_length > len(payload):
            return None
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if segment_length < 7:
                return None
            height = int.from_bytes(payload[offset + 3 : offset + 5], "big")
            width = int.from_bytes(payload[offset + 5 : offset + 7], "big")
            return width, height
        offset += segment_length
    return None


def validate_avatar_image(payload: bytes, content_type: str | None) -> str:
    if not payload:
        raise ValueError("Avatar image is empty.")
    if len(payload) > MAX_AVATAR_BYTES:
        raise ValueError("Avatar image must be 1 MiB or smaller.")
    detected_type = _detected_content_type(payload)
    normalized_type = str(content_type or "").split(";", 1)[0].strip().lower()
    if detected_type is None or normalized_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise ValueError("Avatar image must be a PNG or JPEG file.")
    if normalized_type != detected_type:
        raise ValueError("Avatar image content does not match its media type.")
    dimensions = _image_dimensions(payload, detected_type)
    if dimensions is None or not all(1 <= value <= 4096 for value in dimensions):
        raise ValueError("Avatar image dimensions are invalid or exceed 4096 pixels.")
    return detected_type
