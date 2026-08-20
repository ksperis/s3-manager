# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.usage_stats import aggregate_bucket_usage, build_bucket_overview, extract_usage_stats, summarize_bucket_usage


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


def test_aggregate_bucket_usage_preserves_partial_totals_and_entry_count() -> None:
    assert aggregate_bucket_usage(
        [
            {"usage": {"total_bytes": 100}},
            {"usage": {"total_objects": 3}},
            {"name": "unmeasured"},
        ]
    ) == (100, 3, 3)
    assert aggregate_bucket_usage([{"name": "unmeasured"}]) == (None, None, 1)


def test_summarize_bucket_usage_and_overview_share_canonical_calculations() -> None:
    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(
        [
            {"bucket": "small", "usage": {"total_bytes": 100, "total_objects": 2}},
            {"name": "large", "usage": {"total_bytes": 300, "total_objects": 1}},
            {"name": "empty", "usage": {"total_bytes": 0, "total_objects": 0}},
            "ignored",
        ]
    )

    assert bucket_usage == [
        {"name": "large", "used_bytes": 300, "object_count": 1},
        {"name": "small", "used_bytes": 100, "object_count": 2},
        {"name": "empty", "used_bytes": 0, "object_count": 0},
    ]
    assert (total_bytes, total_objects, bucket_count) == (400, 3, 3)
    assert build_bucket_overview(bucket_usage) == {
        "bucket_count": 3,
        "non_empty_buckets": 2,
        "empty_buckets": 1,
        "avg_bucket_size_bytes": 200,
        "avg_objects_per_bucket": 1,
        "largest_bucket": bucket_usage[0],
        "most_objects_bucket": bucket_usage[1],
    }
