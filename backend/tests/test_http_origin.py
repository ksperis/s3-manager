# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.utils.http_origin import normalize_origin, resolve_request_origin


def _request(headers: dict[str, str]):
    return SimpleNamespace(headers=headers)


def test_normalize_origin_keeps_scheme_and_host_only():
    assert normalize_origin("https://ui.example.test/path?x=1") == "https://ui.example.test"
    assert normalize_origin("http://localhost:5173/") == "http://localhost:5173"


def test_resolve_request_origin_prefers_origin_header():
    request = _request(
        {
            "origin": "https://ui.example.test",
            "referer": "https://ignored.example.test/app/browser",
        }
    )
    assert resolve_request_origin(request) == "https://ui.example.test"


def test_resolve_request_origin_falls_back_to_referer():
    request = _request({"referer": "https://ui.example.test/app/browser?ctx=1"})
    assert resolve_request_origin(request) == "https://ui.example.test"


def test_resolve_request_origin_returns_none_for_invalid_headers():
    assert resolve_request_origin(_request({"origin": "null"})) is None
    assert resolve_request_origin(_request({"origin": "file:///tmp/index.html"})) is None
    assert resolve_request_origin(_request({"referer": "about:blank"})) is None
