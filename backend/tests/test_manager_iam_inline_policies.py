# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account, User, UserRole
from app.main import app
from app.models.iam import IAMGroup, IAMRole, IAMUser
from app.routers.manager import iam_inline_policies as manager_inline_policies_router


def _build_account() -> S3Account:
    account = S3Account(
        name="inline-policy-account",
        rgw_account_id="RGW00000000000000079",
        rgw_access_key="AK-INLINE",
        rgw_secret_key="SK-INLINE",
    )
    account.id = 79
    return account


def _manager_user() -> User:
    return User(
        id=179,
        email="manager@example.com",
        full_name="Manager",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def _install_overrides(monkeypatch, service):  # noqa: ANN001
    account = _build_account()
    app.dependency_overrides[manager_inline_policies_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_inline_policies_router.require_iam_capable_manager] = _manager_user
    monkeypatch.setattr(manager_inline_policies_router, "get_account_and_service", lambda account: (account, service))


def _clear_overrides() -> None:
    app.dependency_overrides.pop(manager_inline_policies_router.get_account_context, None)
    app.dependency_overrides.pop(manager_inline_policies_router.require_iam_capable_manager, None)


class FakeInlinePolicyService:
    def __init__(self):
        self.user_policy_names = {"alice": ["ReadAlice"], "bob": []}
        self.group_policy_names = {"developers": ["TeamAccess"]}
        self.role_policy_names = {"batch": ["AssumeBatch"]}
        self.documents = {
            ("user", "alice", "ReadAlice"): {"Statement": [{"Sid": "ReadAlice", "Effect": "Allow"}]},
            ("group", "developers", "TeamAccess"): {"Statement": [{"Sid": "TeamAccess", "Effect": "Allow"}]},
            ("role", "batch", "AssumeBatch"): {"Statement": [{"Sid": "AssumeBatch", "Effect": "Allow"}]},
        }

    def list_users(self):
        return [IAMUser(name="alice"), IAMUser(name="bob")]

    def list_groups(self):
        return [IAMGroup(name="developers")]

    def list_roles(self):
        return [IAMRole(name="batch")]

    def list_user_inline_policies(self, user_name):
        return self.user_policy_names[user_name]

    def get_user_inline_policy(self, user_name, policy_name):
        return self.documents[("user", user_name, policy_name)]

    def list_group_inline_policies(self, group_name):
        return self.group_policy_names[group_name]

    def get_group_inline_policy(self, group_name, policy_name):
        return self.documents[("group", group_name, policy_name)]

    def list_role_inline_policies(self, role_name):
        return self.role_policy_names[role_name]

    def get_role_inline_policy(self, role_name, policy_name):
        return self.documents[("role", role_name, policy_name)]


def test_manager_iam_inline_policy_inventory_returns_all_entities(client, monkeypatch):
    _install_overrides(monkeypatch, FakeInlinePolicyService())
    try:
        response = client.get("/api/manager/iam/inline-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "entity_type": "user",
            "entity_name": "alice",
            "policies": [{"name": "ReadAlice", "document": {"Statement": [{"Sid": "ReadAlice", "Effect": "Allow"}]}}],
            "error": None,
        },
        {"entity_type": "user", "entity_name": "bob", "policies": [], "error": None},
        {
            "entity_type": "group",
            "entity_name": "developers",
            "policies": [{"name": "TeamAccess", "document": {"Statement": [{"Sid": "TeamAccess", "Effect": "Allow"}]}}],
            "error": None,
        },
        {
            "entity_type": "role",
            "entity_name": "batch",
            "policies": [{"name": "AssumeBatch", "document": {"Statement": [{"Sid": "AssumeBatch", "Effect": "Allow"}]}}],
            "error": None,
        },
    ]


def test_manager_iam_inline_policy_inventory_preserves_multiple_policies(client, monkeypatch):
    service = FakeInlinePolicyService()
    service.user_policy_names["alice"] = ["ReadAlice", "WriteAlice"]
    service.documents[("user", "alice", "WriteAlice")] = {"Statement": [{"Sid": "WriteAlice", "Effect": "Allow"}]}

    _install_overrides(monkeypatch, service)
    try:
        response = client.get("/api/manager/iam/inline-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    user_policies = response.json()[0]["policies"]
    assert [policy["name"] for policy in user_policies] == ["ReadAlice", "WriteAlice"]
    assert user_policies[1]["document"]["Statement"][0]["Sid"] == "WriteAlice"


def test_manager_iam_inline_policy_inventory_keeps_entity_errors_visible(client, monkeypatch):
    class PartialErrorService(FakeInlinePolicyService):
        def list_group_inline_policies(self, group_name):
            raise RuntimeError("group inline policies unavailable")

    _install_overrides(monkeypatch, PartialErrorService())
    try:
        response = client.get("/api/manager/iam/inline-policies")
    finally:
        _clear_overrides()

    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0]["entity_name"] == "alice"
    assert body[2] == {
        "entity_type": "group",
        "entity_name": "developers",
        "policies": [],
        "error": "group inline policies unavailable",
    }
