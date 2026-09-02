# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.db import StorageProvider
from app.utils.normalize import (
    normalize_optional_string,
    normalize_optional_string_field,
    normalize_storage_provider,
)


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


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  value  ", "value"),
        ("   ", None),
        (None, None),
        (0, None),
        (12, 12),
        (False, None),
    ],
)
def test_normalize_optional_string_field_preserves_invalid_non_string_values(value, expected):
    assert normalize_optional_string_field(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (StorageProvider.CEPH, StorageProvider.CEPH),
        ("ceph", StorageProvider.CEPH),
        (" AWS ", StorageProvider.AWS),
        ("OTHER", StorageProvider.OTHER),
    ],
)
def test_normalize_storage_provider_accepts_canonical_values(value, expected):
    assert normalize_storage_provider(value) == expected


@pytest.mark.parametrize("value", [None, "", "swift", 1, False])
def test_normalize_storage_provider_rejects_invalid_values(value):
    with pytest.raises(ValueError, match="[Ss]torage provider"):
        normalize_storage_provider(value)
