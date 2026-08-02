# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.services.aws_client_config import build_interactive_aws_config
from app.services import rgw_iam, s3_client, sns_client, sts_service


def _assert_interactive_config(config):
    assert config.connect_timeout == 2.0
    assert config.read_timeout == 5.0
    assert config.retries["total_max_attempts"] == 2


def test_interactive_aws_config_has_bounded_timeouts_and_attempts():
    config = build_interactive_aws_config()

    assert config.connect_timeout == 2.0
    assert config.read_timeout == 5.0
    assert config.retries["mode"] == "standard"
    assert config.retries["total_max_attempts"] == 2


def test_interactive_aws_config_preserves_service_options():
    config = build_interactive_aws_config(
        s3={"addressing_style": "path"},
        user_agent_extra="s3-manager-test",
    )

    assert config.s3["addressing_style"] == "path"
    assert config.user_agent_extra == "s3-manager-test"


def test_s3_iam_sns_and_sts_clients_share_interactive_profile(monkeypatch):
    captured: dict[str, object] = {}

    def fake_client(service_name, **kwargs):
        captured[service_name] = kwargs["config"]
        return object()

    for module in (s3_client, rgw_iam, sns_client, sts_service):
        monkeypatch.setattr(module.boto3, "client", fake_client)

    s3_client.get_s3_client("AK", "SK", endpoint="https://s3.example.test")
    rgw_iam.get_iam_client("AK", "SK", endpoint="https://iam.example.test")
    sns_client.get_sns_client("AK", "SK", endpoint="https://sns.example.test")
    sts_service.get_sts_client("AK", "SK", endpoint="https://sts.example.test")

    assert set(captured) == {"s3", "iam", "sns", "sts"}
    for config in captured.values():
        _assert_interactive_config(config)


def test_s3_client_selects_long_running_profile(monkeypatch):
    captured = {}

    def fake_client(_service_name, **kwargs):
        captured["config"] = kwargs["config"]
        return object()

    monkeypatch.setattr(s3_client.boto3, "client", fake_client)

    s3_client.get_s3_client(
        "AK",
        "SK",
        endpoint="https://s3.example.test",
        request_profile="long_running",
    )

    assert captured["config"].read_timeout == 60.0
