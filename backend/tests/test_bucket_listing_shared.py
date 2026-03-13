# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import HTTPException

from app.services.bucket_listing_shared import _format_sse_event, _parse_filter, parse_includes


def test_parse_includes_trims_and_deduplicates_values():
    include = [" tags,versioning ", "versioning", "cors", "", "tags"]
    assert parse_includes(include) == {"tags", "versioning", "cors"}


def test_parse_filter_parses_advanced_filter_payload():
    simple, advanced = _parse_filter('{"match":"all","rules":[]}')
    assert simple is None
    assert advanced is not None
    assert advanced.match == "all"
    assert advanced.rules == []


def test_parse_filter_keeps_plain_text_as_simple_filter():
    simple, advanced = _parse_filter("my-bucket")
    assert simple == "my-bucket"
    assert advanced is None


def test_parse_filter_rejects_invalid_advanced_filter_shape():
    try:
        _parse_filter('{"rules":"invalid"}')
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Expected HTTPException")


def test_format_sse_event_uses_sse_newline_delimiters():
    payload = {"request_id": "r1", "percent": 42}
    assert _format_sse_event("progress", payload) == 'event: progress\ndata: {"request_id":"r1","percent":42}\n\n'
