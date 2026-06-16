# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

import pytest
from botocore.exceptions import ClientError

from app.services import sns_client


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "SNSOp")


class _FakeEvents:
    def __init__(self):
        self.handlers: dict[str, list] = {}

    def register(self, event_name, handler):
        self.handlers.setdefault(event_name, []).append(handler)

    def unregister(self, event_name, handler):
        handlers = self.handlers.get(event_name, [])
        if handler in handlers:
            handlers.remove(handler)

    def emit(self, event_name, **kwargs):
        for handler in list(self.handlers.get(event_name, [])):
            handler(**kwargs)


class _FakeHTTPResponse:
    def __init__(self, content: bytes):
        self.content = content


class _FakeMeta:
    def __init__(self):
        self.events = _FakeEvents()


class _FakeSNSClient:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.topic_pages: list[dict] = []
        self.raw_topic_pages: list[bytes] = []
        self.raise_on: dict[str, Exception] = {}
        self.attributes_payload: dict = {"Attributes": {}}
        self.meta = _FakeMeta()

    def list_topics(self, **kwargs):
        self.calls.append(("list_topics", kwargs))
        err = self.raise_on.get("list_topics")
        if err:
            raise err
        if self.raw_topic_pages:
            self.meta.events.emit(
                "after-call.sns.ListTopics",
                http_response=_FakeHTTPResponse(self.raw_topic_pages.pop(0)),
            )
        if self.topic_pages:
            return self.topic_pages.pop(0)
        return {"Topics": []}

    def create_topic(self, **kwargs):
        self.calls.append(("create_topic", kwargs))
        err = self.raise_on.get("create_topic")
        if err:
            raise err
        return {"TopicArn": "arn:topic:test"}

    def delete_topic(self, **kwargs):
        self.calls.append(("delete_topic", kwargs))
        err = self.raise_on.get("delete_topic")
        if err:
            raise err
        return {}

    def get_topic_attributes(self, **kwargs):
        self.calls.append(("get_topic_attributes", kwargs))
        err = self.raise_on.get("get_topic_attributes")
        if err:
            raise err
        return self.attributes_payload

    def set_topic_attributes(self, **kwargs):
        self.calls.append(("set_topic_attributes", kwargs))
        err = self.raise_on.get("set_topic_attributes")
        if err:
            raise err
        return {}


def test_get_sns_client_requires_endpoint():
    with pytest.raises(RuntimeError, match="SNS endpoint is not configured"):
        sns_client.get_sns_client(endpoint=None)


def test_list_topics_handles_pagination(monkeypatch):
    fake = _FakeSNSClient()
    fake.topic_pages = [
        {"Topics": [{"TopicArn": "arn:1"}], "NextToken": "next"},
        {"Topics": [{"TopicArn": "arn:2"}]},
    ]
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    topics = sns_client.list_topics(endpoint="https://sns.example.test")
    assert topics == [{"TopicArn": "arn:1"}, {"TopicArn": "arn:2"}]
    assert fake.calls[0] == ("list_topics", {})
    assert fake.calls[1] == ("list_topics", {"NextToken": "next"})


def test_list_topics_raw_preserves_ceph_fields(monkeypatch):
    fake = _FakeSNSClient()
    fake.topic_pages = [
        {"Topics": [{"TopicArn": "arn:aws:sns:default:tenant:topic"}], "NextToken": "next"},
        {"Topics": [{"TopicArn": "arn:aws:sns:default:tenant:topic"}]},
    ]
    fake.raw_topic_pages = [
        b"""<ListTopicsResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
  <ListTopicsResult>
    <Topics>
      <member>
        <TopicArn>arn:aws:sns:default:tenant:topic</TopicArn>
        <Name>topic</Name>
        <EndPoint>
          <EndpointAddress>https://notify.example.test/one</EndpointAddress>
          <EndpointTopic>topic</EndpointTopic>
          <EndpointArgs>persistent=true&amp;verify-ssl=false</EndpointArgs>
        </EndPoint>
      </member>
    </Topics>
  </ListTopicsResult>
</ListTopicsResponse>""",
        b"""<ListTopicsResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
  <ListTopicsResult>
    <Topics>
      <member>
        <TopicArn>arn:aws:sns:default:tenant:topic</TopicArn>
        <Name>notif.bucket_topic</Name>
        <EndpointAddress>https://notify.example.test/two</EndpointAddress>
        <EndpointTopic>topic</EndpointTopic>
        <Persistent>true</Persistent>
        <OpaqueData>trace=lab</OpaqueData>
      </member>
    </Topics>
  </ListTopicsResult>
</ListTopicsResponse>""",
    ]
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    topics = sns_client.list_topics_raw(endpoint="https://sns.example.test")

    assert topics == [
        {
            "TopicArn": "arn:aws:sns:default:tenant:topic",
            "Name": "topic",
            "EndPoint": {
                "EndpointAddress": "https://notify.example.test/one",
                "EndpointTopic": "topic",
                "EndpointArgs": "persistent=true&verify-ssl=false",
            },
        },
        {
            "TopicArn": "arn:aws:sns:default:tenant:topic",
            "Name": "notif.bucket_topic",
            "EndpointAddress": "https://notify.example.test/two",
            "EndpointTopic": "topic",
            "Persistent": "true",
            "OpaqueData": "trace=lab",
        },
    ]
    assert fake.calls[0] == ("list_topics", {})
    assert fake.calls[1] == ("list_topics", {"NextToken": "next"})
    assert fake.meta.events.handlers["after-call.sns.ListTopics"] == []


def test_list_topics_wraps_errors(monkeypatch):
    fake = _FakeSNSClient()
    fake.raise_on["list_topics"] = _client_error("AccessDenied")
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="Unable to list SNS topics"):
        sns_client.list_topics(endpoint="https://sns.example.test")


def test_create_delete_and_attributes_paths(monkeypatch):
    fake = _FakeSNSClient()
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    created = sns_client.create_topic("events", {"verify-ssl": "false"}, endpoint="https://sns.example.test")
    assert created["TopicArn"] == "arn:topic:test"
    assert ("create_topic", {"Name": "events", "Attributes": {"verify-ssl": "false"}}) in fake.calls

    sns_client.delete_topic("arn:topic:test", endpoint="https://sns.example.test")
    assert ("delete_topic", {"TopicArn": "arn:topic:test"}) in fake.calls

    fake.raise_on["delete_topic"] = _client_error("NotFound")
    sns_client.delete_topic("arn:topic:missing", endpoint="https://sns.example.test")

    fake.attributes_payload = {"Attributes": {"Policy": '{"Version":"2012-10-17"}'}}
    attrs = sns_client.get_topic_attributes("arn:topic:test", endpoint="https://sns.example.test")
    assert attrs["Policy"] == '{"Version":"2012-10-17"}'


def test_get_topic_attributes_not_found_returns_empty(monkeypatch):
    fake = _FakeSNSClient()
    fake.raise_on["get_topic_attributes"] = _client_error("NotFoundException")
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    assert sns_client.get_topic_attributes("arn:missing", endpoint="https://sns.example.test") == {}


def test_get_topic_policy_json_and_raw_fallback(monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    fake = _FakeSNSClient()
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    fake.attributes_payload = {"Attributes": {"Policy": '{"Version":"2012-10-17"}'}}
    parsed = sns_client.get_topic_policy("arn:topic:test", endpoint="https://sns.example.test")
    assert parsed and parsed["Version"] == "2012-10-17"

    fake.attributes_payload = {"Attributes": {"Policy": "NOT_JSON"}}
    raw = sns_client.get_topic_policy("arn:topic:test", endpoint="https://sns.example.test")
    assert raw == {"raw": "NOT_JSON"}
    assert "non-JSON policy" in caplog.text


def test_set_topic_policy_and_attributes(monkeypatch):
    fake = _FakeSNSClient()
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    sns_client.set_topic_policy(
        "arn:topic:test",
        {"Version": "2012-10-17", "Statement": []},
        endpoint="https://sns.example.test",
    )
    assert any(call[0] == "set_topic_attributes" and call[1]["AttributeName"] == "Policy" for call in fake.calls)

    sns_client.set_topic_attributes(
        "arn:topic:test",
        {"verify-ssl": "false", "push-endpoint": "https://hook.example.test"},
        endpoint="https://sns.example.test",
    )
    attr_calls = [c for c in fake.calls if c[0] == "set_topic_attributes"]
    assert len(attr_calls) >= 3


def test_set_topic_attributes_ignores_empty_and_wraps_errors(monkeypatch):
    fake = _FakeSNSClient()
    monkeypatch.setattr(sns_client, "get_sns_client", lambda *args, **kwargs: fake)

    sns_client.set_topic_attributes("arn:topic:test", {}, endpoint="https://sns.example.test")
    assert fake.calls == []

    fake.raise_on["set_topic_attributes"] = _client_error("AccessDenied")
    with pytest.raises(RuntimeError, match="Unable to update SNS topic attribute"):
        sns_client.set_topic_attributes(
            "arn:topic:test",
            {"verify-ssl": "false"},
            endpoint="https://sns.example.test",
        )
