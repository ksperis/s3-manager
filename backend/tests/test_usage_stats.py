# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.usage_stats import extract_usage_stats


def test_extract_usage_stats_keeps_zero_total_objects() -> None:
    used_bytes, object_count = extract_usage_stats({"total_bytes": 0, "total_objects": 0})
    assert used_bytes == 0
    assert object_count == 0


def test_extract_usage_stats_keeps_zero_num_objects_fallback() -> None:
    used_bytes, object_count = extract_usage_stats({"size_kb_actual": 0, "num_objects": 0})
    assert used_bytes == 0
    assert object_count == 0


def test_extract_usage_stats_aggregates_categorized_payload_for_quota_usage() -> None:
    used_bytes, object_count = extract_usage_stats(
        {
            "rgw.none": {
                "size_kb_actual": 0,
                "num_objects": 18446744073709551613,
            },
            "rgw.main": {
                "size_actual": 159508070400,
                "num_objects": 32328,
            },
            "rgw.multimeta": {
                "size_kb_actual": 1024,
                "num_objects": 12,
            },
        }
    )

    assert used_bytes == 159509118976
    assert object_count == 18446744073709583953


def test_extract_usage_stats_aggregates_categorized_payload_without_rgw_main() -> None:
    used_bytes, object_count = extract_usage_stats(
        {
            "rgw.none": {
                "size_kb_actual": 2048,
                "num_objects": 18446744073709551613,
            },
            "rgw.multimeta": {
                "size_kb_actual": 1024,
                "num_objects": 12,
            },
        }
    )

    assert used_bytes == 3145728
    assert object_count == 18446744073709551625


def test_extract_usage_stats_ignores_invalid_categorized_values() -> None:
    used_bytes, object_count = extract_usage_stats(
        {
            "rgw.main": {
                "size_actual": "invalid",
                "num_objects": "invalid",
            },
            "rgw.multimeta": {
                "size_kb_actual": 2,
                "num_objects": 3,
            },
            "unexpected": "ignored",
        }
    )

    assert used_bytes == 2048
    assert object_count == 3
