# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest

from app.db import UiGroup, User, UserRole, UserUiGroup
from app.main import app
from app.models.bucket import BucketLifecycleConfig, BucketNotificationConfiguration, BucketTag
from app.routers import dependencies
from app.routers.manager import feature_rules as feature_rules_router


class FakeBucketsService:
    def __init__(self):
        self.buckets = [SimpleNamespace(name="alpha"), SimpleNamespace(name="beta")]
        self.lifecycle = {}
        self.policies = {}
        self.cors = {}
        self.notifications = {}
        self.tags = {}
        self.failures = {}

    def list_buckets(self, _account, with_stats=True):  # noqa: ANN001, ARG002
        return self.buckets

    def _maybe_fail(self, feature, bucket_name):  # noqa: ANN001
        if self.failures.get((feature, bucket_name)):
            raise RuntimeError(self.failures[(feature, bucket_name)])

    def get_lifecycle(self, bucket_name, _account):  # noqa: ANN001
        self._maybe_fail("lifecycle", bucket_name)
        return BucketLifecycleConfig(rules=self.lifecycle.get(bucket_name, []))

    def get_policy(self, bucket_name, _account):  # noqa: ANN001
        self._maybe_fail("policy", bucket_name)
        return self.policies.get(bucket_name)

    def get_bucket_cors(self, bucket_name, _account):  # noqa: ANN001
        self._maybe_fail("cors", bucket_name)
        return self.cors.get(bucket_name, [])

    def get_bucket_notifications(self, bucket_name, _account):  # noqa: ANN001
        self._maybe_fail("notifications", bucket_name)
        return BucketNotificationConfiguration(configuration=self.notifications.get(bucket_name, {}))

    def get_bucket_tags(self, bucket_name, _account):  # noqa: ANN001
        self._maybe_fail("tags", bucket_name)
        return self.tags.get(bucket_name, [])


@pytest.fixture
def feature_rule_client(client, db_session, monkeypatch):
    service = FakeBucketsService()
    account = SimpleNamespace(storage_endpoint=None)
    user = User(
        id=8101,
        email="feature-rules@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_manager_feature_rules=True,
    )
    db_session.add(user)
    db_session.commit()
    app.dependency_overrides[feature_rules_router.get_account_context] = lambda: account
    app.dependency_overrides[feature_rules_router.get_buckets_service] = lambda: service
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    monkeypatch.setattr(feature_rules_router, "account_sns_feature_enabled", lambda _account: True)
    return client, service


def test_feature_rules_lists_lifecycle_rules_for_all_buckets(feature_rule_client):
    client, service = feature_rule_client
    service.lifecycle["alpha"] = [
        {
            "ID": "expire-logs",
            "Status": "Enabled",
            "Filter": {"Prefix": "logs/"},
            "Expiration": {"Days": 30},
        },
        {
            "ID": "multipart",
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
        },
    ]

    response = client.get("/api/manager/feature-rules", params={"feature": "lifecycle"})

    assert response.status_code == 200
    body = response.json()
    assert [row["bucket_name"] for row in body] == ["alpha", "beta"]
    assert body[0]["status"] == "configured"
    assert [rule["id"] for rule in body[0]["rules"]] == ["expire-logs", "multipart"]
    assert "logs/" in body[0]["rules"][0]["summary"]
    assert body[0]["rules"][0]["raw"]["Expiration"]["Days"] == 30
    assert body[1]["status"] == "empty"
    assert body[1]["rules"] == []


def test_feature_rules_lists_bucket_policy_statements(feature_rule_client):
    client, service = feature_rule_client
    service.policies["alpha"] = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ReadObjects",
                "Effect": "Allow",
                "Principal": "*",
                "Action": ["s3:GetObject"],
                "Resource": "arn:aws:s3:::alpha/*",
            },
            {
                "Effect": "Deny",
                "NotAction": "s3:GetObject",
                "Resource": "arn:aws:s3:::alpha/private/*",
                "Condition": {"Bool": {"aws:SecureTransport": "false"}},
            },
        ],
    }

    response = client.get("/api/manager/feature-rules", params={"feature": "policy"})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["status"] == "configured"
    assert [rule["id"] for rule in body[0]["rules"]] == ["ReadObjects", "Statement 2"]
    assert body[0]["rules"][0]["type"] == "policy"
    assert "Action: s3:GetObject" in body[0]["rules"][0]["summary"]
    assert "Condition" in body[0]["rules"][1]["chips"]


def test_feature_rules_lists_cors_rules(feature_rule_client):
    client, service = feature_rule_client
    service.cors["alpha"] = [
        {
            "AllowedMethods": ["GET", "PUT"],
            "AllowedOrigins": ["https://app.example.test"],
            "AllowedHeaders": ["Authorization"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3000,
        }
    ]

    response = client.get("/api/manager/feature-rules", params={"feature": "cors"})

    assert response.status_code == 200
    rule = response.json()[0]["rules"][0]
    assert rule["type"] == "cors"
    assert rule["title"] == "https://app.example.test"
    assert rule["chips"] == ["GET, PUT"]
    assert "GET, PUT" not in rule["summary"]
    assert "https://app.example.test" not in rule["summary"]
    assert rule["summary"] == "Allowed headers: Authorization · Exposed headers: ETag · Max age: 3000s"
    assert rule["raw"]["MaxAgeSeconds"] == 3000


def test_feature_rules_lists_notifications_and_bucket_errors(feature_rule_client):
    client, service = feature_rule_client
    service.notifications["alpha"] = {
        "TopicConfigurations": [
            {
                "Id": "ObjectCreateAll",
                "TopicArn": "arn:aws:sns:default:ACCOUNT:topic-a",
                "Events": ["s3:ObjectCreated:*"],
                "Filter": {"Key": {"FilterRules": [{"Name": "prefix", "Value": "uploads/"}]}},
            }
        ],
        "EventBridgeConfiguration": {},
    }
    service.failures[("notifications", "beta")] = "AccessDenied"

    response = client.get("/api/manager/feature-rules", params={"feature": "notifications"})

    assert response.status_code == 200
    body = response.json()
    assert [rule["type"] for rule in body[0]["rules"]] == ["topic", "eventbridge"]
    assert "ObjectCreated" in body[0]["rules"][0]["summary"]
    assert "prefix: uploads/" in body[0]["rules"][0]["summary"]
    assert body[1]["status"] == "unavailable"
    assert body[1]["error"] == "AccessDenied"


def test_feature_rules_lists_bucket_tags(feature_rule_client):
    client, service = feature_rule_client
    service.tags["alpha"] = [
        BucketTag(key="environment", value="prod"),
        BucketTag(key="owner", value="data-platform"),
    ]
    service.failures[("tags", "beta")] = "AccessDenied"

    response = client.get("/api/manager/feature-rules", params={"feature": "tags"})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["status"] == "configured"
    assert [rule["id"] for rule in body[0]["rules"]] == ["environment", "owner"]
    assert body[0]["rules"][0] == {
        "id": "environment",
        "type": "tag",
        "title": "environment",
        "summary": "prod",
        "chips": [],
        "raw": {"key": "environment", "value": "prod"},
    }
    assert body[1]["status"] == "unavailable"
    assert body[1]["error"] == "AccessDenied"


def test_feature_rules_marks_notifications_unavailable_when_sns_is_disabled(feature_rule_client, monkeypatch):
    client, service = feature_rule_client
    monkeypatch.setattr(feature_rules_router, "account_sns_feature_enabled", lambda _account: False)

    response = client.get("/api/manager/feature-rules", params={"feature": "notifications"})

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body] == ["unavailable", "unavailable"]
    assert all(row["error"] == "SNS notifications are disabled for this endpoint." for row in body)
    assert service.notifications == {}


def test_feature_rules_requires_manager_tool_access(client, db_session, monkeypatch):
    service = FakeBucketsService()
    account = SimpleNamespace(storage_endpoint=None)
    user = User(
        id=8102,
        email="feature-rules-denied@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_manager_feature_rules=False,
    )
    db_session.add(user)
    db_session.commit()
    app.dependency_overrides[feature_rules_router.get_account_context] = lambda: account
    app.dependency_overrides[feature_rules_router.get_buckets_service] = lambda: service
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    monkeypatch.setattr(feature_rules_router, "account_sns_feature_enabled", lambda _account: True)

    response = client.get("/api/manager/feature-rules", params={"feature": "lifecycle"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authorized"


def test_feature_rules_allows_group_inherited_manager_tool_access(client, db_session, monkeypatch):
    service = FakeBucketsService()
    account = SimpleNamespace(storage_endpoint=None)
    user = User(
        id=8103,
        email="feature-rules-inherited@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_manager_feature_rules=False,
    )
    group = UiGroup(
        id=8104,
        name="feature-rules-group",
        can_access_manager_feature_rules=True,
    )
    db_session.add_all([user, group])
    db_session.flush()
    db_session.add(UserUiGroup(user_id=user.id, group_id=group.id))
    db_session.commit()
    app.dependency_overrides[feature_rules_router.get_account_context] = lambda: account
    app.dependency_overrides[feature_rules_router.get_buckets_service] = lambda: service
    app.dependency_overrides[dependencies.get_current_user] = lambda: user
    monkeypatch.setattr(feature_rules_router, "account_sns_feature_enabled", lambda _account: True)

    response = client.get("/api/manager/feature-rules", params={"feature": "lifecycle"})

    assert response.status_code == 200
    assert [row["bucket_name"] for row in response.json()] == ["alpha", "beta"]
