# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import date

from app.models.base import ApiModel
from app.routers.sse_worker import build_sse_progress_callback, format_sse_event


class _Progress(ApiModel):
    request_id: str | None = None
    completed: int


def test_format_sse_event_uses_sse_newline_delimiters():
    payload = {"request_id": "r1", "percent": 42}

    assert format_sse_event("progress", payload) == (
        'event: progress\ndata: {"request_id":"r1","percent":42}\n\n'
    )


def test_format_sse_event_preserves_unicode_and_serializes_typed_values():
    payload = {"label": "Café", "day": date(2026, 8, 3)}

    assert format_sse_event("result", payload) == (
        'event: result\ndata: {"label":"Café","day":"2026-08-03"}\n\n'
    )


def test_progress_callback_injects_request_id_and_emits_progress_event():
    messages: list[str] = []
    callback = build_sse_progress_callback(messages.append, request_id="request-1")

    callback(_Progress(request_id="stale", completed=3))

    assert messages == [
        'event: progress\ndata: {"request_id":"request-1","completed":3}\n\n'
    ]
