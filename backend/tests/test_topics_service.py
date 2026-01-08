# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db_models import S3Account
from app.services import sns_client
from app.services.topics_service import TopicsService


def _account() -> S3Account:
    account = S3Account(rgw_access_key="AKIA_TEST", rgw_secret_key="SECRET_TEST")
    account._session_endpoint = "http://sns.test"
    return account


def test_set_topic_configuration_skips_noop(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": "false",
    }

    monkeypatch.setattr(sns_client, "get_topic_attributes", lambda *_, **__: attributes)
    calls: list[dict] = []

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None):
        calls.append({"topic_arn": topic_arn, "attrs": attrs})

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {"push-endpoint": "https://example.com/webhook", "verify-ssl": False},
    )

    assert result == {"push-endpoint": "https://example.com/webhook", "verify-ssl": False}
    assert calls == []


def test_set_topic_configuration_only_sends_changes(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    responses = [
        {
            "TopicArn": arn,
            "Name": "topic",
            "push-endpoint": "https://old.example.com",
            "verify-ssl": "false",
        },
        {
            "TopicArn": arn,
            "Name": "topic",
            "push-endpoint": "https://new.example.com",
            "verify-ssl": "false",
        },
    ]
    last = responses[-1]

    def fake_get_topic_attributes(*_, **__):
        nonlocal responses, last
        if responses:
            last = responses.pop(0)
        return last

    monkeypatch.setattr(sns_client, "get_topic_attributes", fake_get_topic_attributes)
    sent: dict | None = None

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, endpoint=None):
        nonlocal sent
        sent = {"topic_arn": topic_arn, "attrs": attrs}

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {"push-endpoint": "https://new.example.com", "verify-ssl": False},
    )

    assert sent == {"topic_arn": arn, "attrs": {"push-endpoint": "https://new.example.com"}}
    assert result == {"push-endpoint": "https://new.example.com", "verify-ssl": False}
