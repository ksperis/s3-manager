# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.services.bucket_listing_shared import coerce_filter_bool, coerce_filter_number
from app.services.listing_rule_matching import (
    match_boolean_rule,
    match_numeric_rule,
    match_text_rule,
)


@pytest.mark.parametrize(
    ("op", "expected", "matched"),
    [
        ("contains", "pha", True),
        ("starts_with", "AL", True),
        ("ends_with", "BETA", True),
        ("eq", "alpha beta", True),
        ("neq", "other", True),
        ("in", ["other", "ALPHA BETA"], True),
        ("not_in", ["other"], True),
        ("gt", "alpha beta", False),
    ],
)
def test_match_text_rule_supports_listing_operators(op, expected, matched):
    assert match_text_rule("Alpha Beta", op, expected) is matched


@pytest.mark.parametrize(
    ("op", "expected", "matched"),
    [
        ("eq", "10", True),
        ("neq", 9, True),
        ("gt", 9, True),
        ("gte", 10, True),
        ("lt", 11, True),
        ("lte", 10, True),
        ("in", [5, "10"], True),
        ("not_in", [5, 9], True),
    ],
)
def test_match_numeric_rule_uses_the_caller_coercion(op, expected, matched):
    assert match_numeric_rule(10, op, expected, coerce=coerce_filter_number) is matched


def test_match_boolean_rule_applies_missing_value_default_and_rejects_bad_operands():
    assert match_boolean_rule(
        None,
        "eq",
        False,
        coerce=coerce_filter_bool,
        default_if_none=False,
    )
    assert not match_boolean_rule(
        True,
        "eq",
        "invalid",
        coerce=coerce_filter_bool,
    )
    assert not match_boolean_rule(
        True,
        "contains",
        True,
        coerce=coerce_filter_bool,
    )
