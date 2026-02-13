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
