# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.quota_stats import extract_positive_limit, parse_positive_limit


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (12, 12),
        (12.9, 12),
        (" 12 ", 12),
        ("12.9", 12),
        (None, None),
        (True, None),
        (0, None),
        (-1, None),
        ("", None),
        ("invalid", None),
        ({"value": 12}, None),
    ],
)
def test_parse_positive_limit(value, expected):
    assert parse_positive_limit(value) == expected


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"max_buckets": 12}, 12),
        ({"limits": {"max_buckets": " 8 "}}, 8),
        ({"max_buckets": 0, "limits": {"max_buckets": 6}}, 6),
        ({"limits": "invalid"}, None),
        (None, None),
    ],
)
def test_extract_positive_limit(payload, expected):
    assert extract_positive_limit(payload, "max_buckets") == expected
