# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.normalize import normalize_optional_string


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("value", "value"),
        ("  value  ", "value"),
        ("", None),
        ("   ", None),
        (None, None),
        (12, None),
        (False, None),
    ],
)
def test_normalize_optional_string(value, expected):
    assert normalize_optional_string(value) == expected
