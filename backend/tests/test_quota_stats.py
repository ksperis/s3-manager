# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.quota_stats import parse_positive_limit


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
