# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json

import pytest

from app.utils.s3_connection_capabilities import (
    dump_s3_connection_capabilities,
    parse_s3_connection_capabilities,
    s3_connection_can_manage_iam,
)


def test_connection_capabilities_use_the_canonical_boolean_contract():
    raw = '{"can_manage_iam":true,"region_probe":"ok"}'

    assert parse_s3_connection_capabilities(raw) == {
        "can_manage_iam": True,
        "region_probe": "ok",
    }
    assert s3_connection_can_manage_iam(raw) is True


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "{",
        "[]",
        "{}",
        '{"can_manage_iam":1}',
        '{"iam_capable":true}',
    ],
)
def test_connection_capabilities_reject_noncanonical_profiles(raw):
    with pytest.raises(ValueError):
        parse_s3_connection_capabilities(raw)


def test_dump_connection_capabilities_preserves_current_extension_fields():
    dumped = dump_s3_connection_capabilities(
        '{"can_manage_iam":false,"region_probe":"ok"}',
        can_manage_iam=True,
    )

    assert json.loads(dumped) == {
        "can_manage_iam": True,
        "region_probe": "ok",
    }
