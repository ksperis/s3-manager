# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone

import pytest

from app.db_models import S3Account
from app.services.rgw_admin import RGWAdminError
from app.services.traffic_service import TrafficService, TrafficWindow


class FakeRGWClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0
        self.requests: list[dict] = []

    def get_usage(self, **kwargs):
        if not self._responses:
            raise AssertionError("No more responses configured")
        self.calls += 1
        self.requests.append(kwargs)
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _make_account() -> S3Account:
    return S3Account(
        id=1,
        name="unit-test",
        rgw_account_id="RGW12345678901234567",
        rgw_access_key="access",
        rgw_secret_key="secret",
    )


def test_traffic_service_aggregates_usage_entries():
    account = _make_account()
    payload = {
        "entries": [
            {
                "bucket": "alpha",
                "time": "2024-03-10 10:00:00",
                "categories": [
                    {"category": "get_obj", "bytes_sent": 2048, "bytes_received": 0, "ops": 4, "successful_ops": 4},
                    {"category": "put_obj", "bytes_sent": 512, "bytes_received": 1024, "ops": 2, "successful_ops": 2},
                ],
            },
            {
                "bucket": "beta",
                "time": "2024-03-10 11:00:00",
                "categories": [
                    {"category": "delete_obj", "bytes_sent": 128, "bytes_received": 64, "ops": 1, "successful_ops": 1},
                ],
            },
        ]
    }
    fake_client = FakeRGWClient([payload])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)

    result = service.get_traffic(TrafficWindow.DAY, now=reference)

    assert result["window"] == "day"
    assert result["data_points"] == 2
    assert result["totals"]["bytes_out"] == 2048 + 512 + 128
    assert result["totals"]["bytes_in"] == 0 + 1024 + 64
    assert len(result["bucket_rankings"]) == 2
    assert result["bucket_rankings"][0]["bucket"] == "alpha"
    assert result["user_rankings"][0]["bytes_in"] == result["totals"]["bytes_in"]
    request_groups = {entry["group"]: entry["ops"] for entry in result["request_breakdown"]}
    assert request_groups.get("read") == 4
    assert request_groups.get("write") == 2
    assert request_groups.get("delete") == 1


def test_traffic_service_requires_credentials():
    account = S3Account(name="broken", rgw_access_key=None, rgw_secret_key=None)
    with pytest.raises(ValueError):
        TrafficService(account)


def test_traffic_service_uses_admin_style_targets():
    account = _make_account()
    payload_with_data = {
        "entries": [
            {
                "user": account.rgw_account_id,
                "buckets": [
                    {
                        "bucket": "demo",
                        "time": "2024-03-10 10:00:00",
                        "categories": [
                            {"category": "put_obj", "bytes_sent": 0, "bytes_received": 1024, "ops": 1, "successful_ops": 1}
                        ],
                    }
                ],
            }
        ]
    }
    fake_client = FakeRGWClient([payload_with_data])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)
    result = service.get_traffic(TrafficWindow.DAY, now=reference)

    assert fake_client.calls == 1
    assert fake_client.requests[0]["uid"] == account.rgw_account_id
    assert result["totals"]["bytes_in"] == 1024
    assert result["bucket_rankings"][0]["bucket"] == "demo"
    assert result["user_rankings"][0]["user"] == account.rgw_account_id


def test_traffic_service_raises_last_error_when_no_payload_available():
    account = _make_account()
    failure = RGWAdminError("RGW admin error 403: forbidden")
    fake_client = FakeRGWClient([failure, failure])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)
    with pytest.raises(RGWAdminError):
        service.get_traffic(TrafficWindow.DAY, now=reference)

    assert fake_client.calls == 1
    assert fake_client.requests[0]["uid"] == account.rgw_account_id


def test_traffic_service_passes_bucket_filter():
    account = _make_account()
    payload = {
        "entries": [
            {
                "bucket": "alpha",
                "time": "2024-03-10 10:00:00",
                "categories": [
                    {"category": "get_obj", "bytes_sent": 256, "bytes_received": 0, "ops": 1, "successful_ops": 1}
                ],
            }
        ]
    }
    fake_client = FakeRGWClient([payload])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)

    service.get_traffic(TrafficWindow.DAY, bucket="alpha", now=reference)

    assert fake_client.calls == 1
    assert fake_client.requests[0]["uid"] == account.rgw_account_id
    assert "bucket" not in fake_client.requests[0]


def test_traffic_service_requests_entries_only():
    account = _make_account()
    payload = {
        "entries": [
            {
                "bucket": "demo",
                "time": "2024-03-10 10:00:00",
                "categories": [{"category": "get_obj", "bytes_sent": 128, "bytes_received": 64, "ops": 1, "successful_ops": 1}],
            }
        ]
    }
    fake_client = FakeRGWClient([payload])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)

    result = service.get_traffic(TrafficWindow.DAY, now=reference)

    assert fake_client.requests[0]["show_entries"] is True
    assert fake_client.requests[0]["show_summary"] is False
    assert result["data_points"] == 1


def test_traffic_service_summary_only_payload_has_no_timeline():
    account = _make_account()
    summary_only_payload = {
        "summary": [
            {
                "user": account.rgw_account_id,
                "categories": [
                    {"category": "put_obj", "bytes_sent": 512, "bytes_received": 1024, "ops": 2, "successful_ops": 2}
                ],
            }
        ]
    }
    fake_client = FakeRGWClient([summary_only_payload, summary_only_payload])
    service = TrafficService(account, rgw_client=fake_client, admin_client=fake_client)
    reference = datetime(2024, 3, 10, 12, 0, tzinfo=timezone.utc)

    result = service.get_traffic(TrafficWindow.DAY, now=reference)

    assert result["data_points"] == 0
    assert result["totals"]["bytes_in"] == 0
    assert result["totals"]["bytes_out"] == 0
