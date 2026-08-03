# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.s3_etag import etag_md5


@pytest.mark.parametrize(
    ("etag", "expected"),
    [
        (None, None),
        ("", None),
        ('"AABBCCDDEEFF00112233445566778899"', "aabbccddeeff00112233445566778899"),
        (" aabbccddeeff00112233445566778899 ", "aabbccddeeff00112233445566778899"),
        ("aabbccddeeff00112233445566778899-2", None),
        ("not-an-etag", None),
    ],
)
def test_etag_md5_recognizes_only_plain_md5_etags(etag, expected):
    assert etag_md5(etag) == expected
