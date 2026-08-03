# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.numbers import int_or_zero


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (12, 12),
        (12.9, 12),
        ("12", 12),
        (True, 1),
        (None, 0),
        ("12.9", 0),
        ("invalid", 0),
    ],
)
def test_int_or_zero(value, expected):
    assert int_or_zero(value) == expected
