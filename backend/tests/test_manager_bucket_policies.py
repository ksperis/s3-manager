# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account, User, UserRole
from app.main import app
from app.models.bucket import Bucket
from app.routers.manager import bucket_policies as manager_bucket_policies_router


def _build_account() -> S3Account:
    account = S3Account(
        name="policy-account",
        rgw_account_id="RGW00000000000000078",
        rgw_access_key="AK-POL",
        rgw_secret_key="SK-POL",
    )
    account.id = 78
    return account


def _manager_user() -> User:
    return User(
        id=178,
        email="manager@example.com",
        full_name="Manager",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def _install_overrides(service):  # noqa: ANN001
    account = _build_account()
    app.dependency_overrides[manager_bucket_policies_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_bucket_policies_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_bucket_policies_router.get_current_account_admin] = _manager_user


def _clear_overrides() -> None:
    app.dependency_overrides.pop(manager_bucket_policies_router.get_account_context, None)
    app.dependency_overrides.pop(manager_bucket_policies_router.get_buckets_service, None)
    app.dependency_overrides.pop(manager_bucket_policies_router.get_current_account_admin, None)


def test_manager_bucket_policy_inventory_returns_all_buckets(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="logs"), Bucket(name="empty")]

        def get_policy(self, bucket_name, account):  # noqa: ANN001, ARG002
            if bucket_name == "logs":
                return {"Version": "2012-10-17", "Statement": [{"Sid": "ReadLogs", "Effect": "Allow"}]}
            return None

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/bucket-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "bucket_name": "logs",
            "policy": {"Version": "2012-10-17", "Statement": [{"Sid": "ReadLogs", "Effect": "Allow"}]},
            "error": None,
        },
        {"bucket_name": "empty", "policy": None, "error": None},
    ]


def test_manager_bucket_policy_inventory_preserves_policy_statements(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="archive")]

        def get_policy(self, bucket_name, account):  # noqa: ANN001, ARG002
            return {
                "Version": "2012-10-17",
                "Statement": [
                    {"Sid": "ReadArchive", "Effect": "Allow", "Action": ["s3:GetObject"]},
                    {"Sid": "DenyDelete", "Effect": "Deny", "Action": "s3:DeleteObject"},
                ],
            }

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/bucket-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    statements = response.json()[0]["policy"]["Statement"]
    assert [statement["Sid"] for statement in statements] == ["ReadArchive", "DenyDelete"]
    assert statements[1]["Effect"] == "Deny"


def test_manager_bucket_policy_inventory_keeps_bucket_errors_visible(client):
    class FakeBucketService:
        def list_buckets(self, account, with_stats=True):  # noqa: ANN001, ARG002
            return [Bucket(name="working"), Bucket(name="blocked")]

        def get_policy(self, bucket_name, account):  # noqa: ANN001, ARG002
            if bucket_name == "blocked":
                raise RuntimeError("bucket policy unavailable")
            return {"Statement": [{"Sid": "Keep", "Effect": "Allow"}]}

    _install_overrides(FakeBucketService())
    try:
        response = client.get("/api/manager/bucket-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0] == {
        "bucket_name": "working",
        "policy": {"Statement": [{"Sid": "Keep", "Effect": "Allow"}]},
        "error": None,
    }
    assert body[1] == {"bucket_name": "blocked", "policy": None, "error": "bucket policy unavailable"}
