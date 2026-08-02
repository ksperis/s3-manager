# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

from app.db import S3Account, StorageEndpoint, StorageProvider
from app.services import sns_client
from app.services.topics_service import TopicsService


def _account(provider: str | None = None) -> S3Account:
    account = S3Account(rgw_access_key="AKIA_TEST", rgw_secret_key="SECRET_TEST")
    account.storage_endpoint_url = "https://ceph-sns.example.test"
    if provider:
        account.storage_endpoint = StorageEndpoint(
            name=f"{provider}-sns",
            endpoint_url="https://ceph-sns.example.test",
            provider=provider,
        )
    return account


def _ceph_account() -> S3Account:
    return _account(StorageProvider.CEPH.value)


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

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
        calls.append({"topic_arn": topic_arn, "attrs": attrs})

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {"push-endpoint": "https://example.com/webhook", "verify-ssl": False},
    )

    assert result == {"push-endpoint": "https://example.com/webhook", "verify-ssl": False}
    assert calls == []


def test_parse_topic_configuration_normalizes_ceph_endpoint():
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "Policy": '{"Version":"2012-10-17","Statement":[]}',
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow"}],
        "EndPoint": json.dumps(
            {
                "EndpointAddress": "https://example.com/webhook",
                "EndpointArgs": "verify-ssl=false&persistent=true&time_to_live=60&empty=&HasStoredSecret=true",
                "EndpointTopic": "topic",
                "HasStoredSecret": "true",
            }
        ),
        "OpaqueData": "trace=lab",
    }

    result = service._parse_configurable_attributes(attributes)

    assert result == {
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": False,
        "persistent": True,
        "time_to_live": 60,
        "OpaqueData": "trace=lab",
    }
    assert "EndPoint" not in result
    assert "EndpointTopic" not in result
    assert "HasStoredSecret" not in result
    assert "Policy" not in result
    assert "Version" not in result
    assert "Statement" not in result


def test_set_topic_configuration_skips_noop_for_ceph_endpoint(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "EndPoint": json.dumps(
            {
                "EndpointAddress": "https://example.com/webhook",
                "EndpointArgs": "verify-ssl=false&persistent=true&time_to_live=60",
                "EndpointTopic": "topic",
                "HasStoredSecret": "false",
            }
        ),
        "OpaqueData": "trace=lab",
    }

    monkeypatch.setattr(sns_client, "get_topic_attributes", lambda *_, **__: attributes)
    calls: list[dict] = []

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
        calls.append({"topic_arn": topic_arn, "attrs": attrs})

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {
            "push-endpoint": "https://example.com/webhook",
            "verify-ssl": False,
            "persistent": True,
            "time_to_live": 60,
            "OpaqueData": "trace=lab",
        },
    )

    assert result == {
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": False,
        "persistent": True,
        "time_to_live": 60,
        "OpaqueData": "trace=lab",
    }
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

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
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


def test_list_topics_deduplicates_ceph_entries_and_uses_sns_subscription_counts(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:default:tenant:topic-generic_test_unistra_preprod2"
    monkeypatch.setattr(
        sns_client,
        "list_topics_raw",
        lambda *_, **__: [
            {"TopicArn": arn, "Name": "topic-generic_test_unistra_preprod2"},
            {"TopicArn": arn, "Name": "topic-generic_test_unistra_preprod2"},
            {
                "TopicArn": arn,
                "Name": "projet-test-s3ls-unistra-preprod",
                "EndpointAddress": "https://notify.example.test/hooks/topic",
                "EndpointTopic": "endpoint-topic",
                "EndpointArgs": "persistent=true&verify-ssl=false&time_to_live=60",
                "Persistent": "true",
                "OpaqueData": "trace=lab",
            },
        ],
    )
    monkeypatch.setattr(sns_client, "list_topics", lambda *_, **__: (_ for _ in ()).throw(AssertionError("unused")))
    attributes_calls: list[str] = []

    def fake_get_topic_attributes(topic_arn, *_, **__):
        attributes_calls.append(topic_arn)
        return {
            "TopicArn": topic_arn,
            "Owner": "tenant",
            "SubscriptionsConfirmed": "2",
            "SubscriptionsPending": "1",
        }

    monkeypatch.setattr(sns_client, "get_topic_attributes", fake_get_topic_attributes)

    topics = service.list_topics(_ceph_account())

    assert len(topics) == 1
    topic = topics[0]
    assert topic.name == "topic-generic_test_unistra_preprod2"
    assert topic.arn == arn
    assert topic.is_ceph is True
    assert topic.subscriptions_confirmed == 2
    assert topic.subscriptions_pending == 1
    assert attributes_calls == [arn]


def test_list_topics_ignores_ceph_notification_entries_as_topic_names_without_prefix(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:default:tenant:topic-from-arn"
    monkeypatch.setattr(
        sns_client,
        "list_topics_raw",
        lambda *_, **__: [
            {
                "TopicArn": arn,
                "Name": "projet-test-s3ls-unistra-preprod",
                "EndPoint": json.dumps(
                    {
                        "EndpointAddress": "https://notify.example.test/hooks/current",
                        "EndpointTopic": "topic-from-arn",
                        "EndpointArgs": "persistent=false&verify-ssl=true",
                    }
                ),
            },
        ],
    )
    monkeypatch.setattr(
        sns_client,
        "get_topic_attributes",
        lambda topic_arn, *_, **__: {
            "TopicArn": topic_arn,
            "SubscriptionsConfirmed": "4",
            "SubscriptionsPending": "0",
        },
    )

    topics = service.list_topics(_ceph_account())

    assert len(topics) == 1
    assert topics[0].is_ceph is True
    assert topics[0].name == "topic-from-arn"
    assert topics[0].subscriptions_confirmed == 4
    assert topics[0].subscriptions_pending == 0


def test_list_topics_keeps_standard_sns_behavior(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:us-east-1:123456789012:standard-topic"
    monkeypatch.setattr(sns_client, "list_topics_raw", lambda *_, **__: (_ for _ in ()).throw(AssertionError("unused")))
    monkeypatch.setattr(sns_client, "list_topics", lambda *_, **__: [{"TopicArn": arn}])
    monkeypatch.setattr(
        sns_client,
        "get_topic_attributes",
        lambda topic_arn, *_, **__: {
            "TopicArn": topic_arn,
            "Owner": "123456789012",
            "SubscriptionsConfirmed": "1",
            "SubscriptionsPending": "0",
        },
    )

    topics = service.list_topics(_account(StorageProvider.AWS.value))

    assert len(topics) == 1
    assert topics[0].name == "standard-topic"
    assert topics[0].is_ceph is False
    assert topics[0].subscriptions_confirmed == 1
    assert topics[0].subscriptions_pending == 0
