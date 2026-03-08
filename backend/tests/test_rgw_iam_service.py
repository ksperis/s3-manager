# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

import pytest
from botocore.exceptions import BotoCoreError, ClientError

from app.services import rgw_iam


def _client_error(code: str, operation: str = "IAMOp", *, status_code: int = 400) -> ClientError:
    return ClientError(
        {
            "Error": {"Code": code, "Message": code},
            "ResponseMetadata": {"HTTPStatusCode": status_code},
        },
        operation,
    )


class _Paginator:
    def paginate(self, **kwargs):
        return [{"Users": [{"UserName": "member-a", "UserId": "uid-a", "Arn": "arn:member-a"}]}]


class _FakeIAMClient:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.raise_on: dict[str, Exception | list[Exception]] = {}

    def _maybe_raise(self, name: str):
        err = self.raise_on.get(name)
        if err is None:
            return
        if isinstance(err, list):
            if not err:
                return
            current = err.pop(0)
            raise current
        raise err

    def list_users(self):
        self.calls.append(("list_users", {}))
        self._maybe_raise("list_users")
        return {
            "Users": [
                {"UserName": "alice", "UserId": "uid-alice", "Arn": "arn:alice"},
                {"Arn": "arn:missing-name"},
            ]
        }

    def create_user(self, **kwargs):
        self.calls.append(("create_user", kwargs))
        self._maybe_raise("create_user")
        name = kwargs["UserName"]
        return {"User": {"UserName": name, "UserId": f"uid-{name}", "Arn": f"arn:{name}"}}

    def get_user(self, **kwargs):
        self.calls.append(("get_user", kwargs))
        self._maybe_raise("get_user")
        name = kwargs["UserName"]
        return {"User": {"UserName": name, "UserId": f"uid-{name}", "Arn": f"arn:{name}"}}

    def delete_user(self, **kwargs):
        self.calls.append(("delete_user", kwargs))
        self._maybe_raise("delete_user")
        return {}

    def list_access_keys(self, **kwargs):
        self.calls.append(("list_access_keys", kwargs))
        self._maybe_raise("list_access_keys")
        return {"AccessKeyMetadata": [{"AccessKeyId": "AKIA1", "Status": "Active", "CreateDate": datetime(2026, 1, 1)}]}

    def create_access_key(self, **kwargs):
        self.calls.append(("create_access_key", kwargs))
        self._maybe_raise("create_access_key")
        return {"AccessKey": {"AccessKeyId": "AKIA2", "SecretAccessKey": "SECRET2", "Status": "Active"}}

    def delete_access_key(self, **kwargs):
        self.calls.append(("delete_access_key", kwargs))
        self._maybe_raise("delete_access_key")
        return {}

    def update_access_key(self, **kwargs):
        self.calls.append(("update_access_key", kwargs))
        self._maybe_raise("update_access_key")
        return {}

    def list_groups_for_user(self, **kwargs):
        self.calls.append(("list_groups_for_user", kwargs))
        self._maybe_raise("list_groups_for_user")
        return {"Groups": [{"GroupName": "grp-user", "Arn": "arn:grp-user"}]}

    def list_attached_user_policies(self, **kwargs):
        self.calls.append(("list_attached_user_policies", kwargs))
        self._maybe_raise("list_attached_user_policies")
        return {"AttachedPolicies": [{"PolicyArn": "arn:policy:user", "PolicyName": "UserPolicy"}]}

    def list_user_policies(self, **kwargs):
        self.calls.append(("list_user_policies", kwargs))
        self._maybe_raise("list_user_policies")
        return {"PolicyNames": ["inline-user-policy"]}

    def get_user_policy(self, **kwargs):
        self.calls.append(("get_user_policy", kwargs))
        self._maybe_raise("get_user_policy")
        return {"PolicyDocument": '{"Version":"2012-10-17"}'}

    def put_user_policy(self, **kwargs):
        self.calls.append(("put_user_policy", kwargs))
        self._maybe_raise("put_user_policy")
        return {}

    def delete_user_policy(self, **kwargs):
        self.calls.append(("delete_user_policy", kwargs))
        self._maybe_raise("delete_user_policy")
        return {}

    def attach_user_policy(self, **kwargs):
        self.calls.append(("attach_user_policy", kwargs))
        self._maybe_raise("attach_user_policy")
        return {}

    def detach_user_policy(self, **kwargs):
        self.calls.append(("detach_user_policy", kwargs))
        self._maybe_raise("detach_user_policy")
        return {}

    def list_groups(self):
        self.calls.append(("list_groups", {}))
        self._maybe_raise("list_groups")
        return {"Groups": [{"GroupName": "grp-a", "Arn": "arn:grp-a"}]}

    def create_group(self, **kwargs):
        self.calls.append(("create_group", kwargs))
        self._maybe_raise("create_group")
        group_name = kwargs["GroupName"]
        return {"Group": {"GroupName": group_name, "Arn": f"arn:{group_name}"}}

    def delete_group(self, **kwargs):
        self.calls.append(("delete_group", kwargs))
        self._maybe_raise("delete_group")
        return {}

    def get_paginator(self, operation_name: str):
        self.calls.append(("get_paginator", {"operation_name": operation_name}))
        return _Paginator()

    def add_user_to_group(self, **kwargs):
        self.calls.append(("add_user_to_group", kwargs))
        self._maybe_raise("add_user_to_group")
        return {}

    def remove_user_from_group(self, **kwargs):
        self.calls.append(("remove_user_from_group", kwargs))
        self._maybe_raise("remove_user_from_group")
        return {}

    def list_attached_group_policies(self, **kwargs):
        self.calls.append(("list_attached_group_policies", kwargs))
        self._maybe_raise("list_attached_group_policies")
        return {"AttachedPolicies": [{"PolicyArn": "arn:policy:group", "PolicyName": "GroupPolicy"}]}

    def list_group_policies(self, **kwargs):
        self.calls.append(("list_group_policies", kwargs))
        self._maybe_raise("list_group_policies")
        return {"PolicyNames": ["inline-group-policy"]}

    def get_group_policy(self, **kwargs):
        self.calls.append(("get_group_policy", kwargs))
        self._maybe_raise("get_group_policy")
        return {"PolicyDocument": {"Version": "2012-10-17"}}

    def put_group_policy(self, **kwargs):
        self.calls.append(("put_group_policy", kwargs))
        self._maybe_raise("put_group_policy")
        return {}

    def delete_group_policy(self, **kwargs):
        self.calls.append(("delete_group_policy", kwargs))
        self._maybe_raise("delete_group_policy")
        return {}

    def attach_group_policy(self, **kwargs):
        self.calls.append(("attach_group_policy", kwargs))
        self._maybe_raise("attach_group_policy")
        return {}

    def detach_group_policy(self, **kwargs):
        self.calls.append(("detach_group_policy", kwargs))
        self._maybe_raise("detach_group_policy")
        return {}

    def list_roles(self):
        self.calls.append(("list_roles", {}))
        self._maybe_raise("list_roles")
        return {"Roles": [{"RoleName": "role-a", "Arn": "arn:role-a", "Path": "/"}]}

    def create_role(self, **kwargs):
        self.calls.append(("create_role", kwargs))
        self._maybe_raise("create_role")
        role_name = kwargs["RoleName"]
        return {"Role": {"RoleName": role_name, "Arn": f"arn:{role_name}", "Path": kwargs.get("Path", "/")}}

    def get_role(self, **kwargs):
        self.calls.append(("get_role", kwargs))
        self._maybe_raise("get_role")
        role_name = kwargs["RoleName"]
        return {
            "Role": {
                "RoleName": role_name,
                "Arn": f"arn:{role_name}",
                "Path": "/",
                "AssumeRolePolicyDocument": '{"Version":"2012-10-17"}',
            }
        }

    def delete_role(self, **kwargs):
        self.calls.append(("delete_role", kwargs))
        self._maybe_raise("delete_role")
        return {}

    def update_assume_role_policy(self, **kwargs):
        self.calls.append(("update_assume_role_policy", kwargs))
        self._maybe_raise("update_assume_role_policy")
        return {}

    def list_policies(self, **kwargs):
        self.calls.append(("list_policies", kwargs))
        self._maybe_raise("list_policies")
        return {"Policies": [{"PolicyName": "custom-policy", "Arn": "arn:custom", "DefaultVersionId": "v1"}]}

    def get_policy(self, **kwargs):
        self.calls.append(("get_policy", kwargs))
        self._maybe_raise("get_policy")
        return {"Policy": {"PolicyName": "custom-policy", "Arn": kwargs["PolicyArn"], "DefaultVersionId": "v1"}}

    def get_policy_version(self, **kwargs):
        self.calls.append(("get_policy_version", kwargs))
        self._maybe_raise("get_policy_version")
        return {"PolicyVersion": {"Document": {"Version": "2012-10-17"}}}

    def create_policy(self, **kwargs):
        self.calls.append(("create_policy", kwargs))
        self._maybe_raise("create_policy")
        return {"Policy": {"PolicyName": kwargs["PolicyName"], "Arn": f"arn:{kwargs['PolicyName']}"}}

    def delete_policy(self, **kwargs):
        self.calls.append(("delete_policy", kwargs))
        self._maybe_raise("delete_policy")
        return {}

    def list_attached_role_policies(self, **kwargs):
        self.calls.append(("list_attached_role_policies", kwargs))
        self._maybe_raise("list_attached_role_policies")
        return {"AttachedPolicies": [{"PolicyArn": "arn:policy:role", "PolicyName": "RolePolicy"}]}

    def list_role_policies(self, **kwargs):
        self.calls.append(("list_role_policies", kwargs))
        self._maybe_raise("list_role_policies")
        return {"PolicyNames": ["inline-role-policy"]}

    def get_role_policy(self, **kwargs):
        self.calls.append(("get_role_policy", kwargs))
        self._maybe_raise("get_role_policy")
        return {"PolicyDocument": {"Statement": []}}

    def put_role_policy(self, **kwargs):
        self.calls.append(("put_role_policy", kwargs))
        self._maybe_raise("put_role_policy")
        return {}

    def delete_role_policy(self, **kwargs):
        self.calls.append(("delete_role_policy", kwargs))
        self._maybe_raise("delete_role_policy")
        return {}

    def attach_role_policy(self, **kwargs):
        self.calls.append(("attach_role_policy", kwargs))
        self._maybe_raise("attach_role_policy")
        return {}

    def detach_role_policy(self, **kwargs):
        self.calls.append(("detach_role_policy", kwargs))
        self._maybe_raise("detach_role_policy")
        return {}


def _service(monkeypatch, client: _FakeIAMClient | None = None) -> tuple[rgw_iam.RGWIAMService, _FakeIAMClient]:
    fake = client or _FakeIAMClient()
    monkeypatch.setattr(rgw_iam, "get_iam_client", lambda *args, **kwargs: fake)
    return rgw_iam.RGWIAMService("AK", "SK", endpoint="https://iam.example.test"), fake


def test_get_iam_client_requires_endpoint_and_passes_verify(monkeypatch):
    with pytest.raises(RuntimeError, match="IAM endpoint is not configured"):
        rgw_iam.get_iam_client("AK", "SK", endpoint=None)

    captured: dict[str, object] = {}

    def fake_boto3_client(name, **kwargs):
        captured["name"] = name
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(rgw_iam.boto3, "client", fake_boto3_client)
    rgw_iam.get_iam_client("AK", "SK", endpoint="https://iam.example.test", region="eu-west-1", verify_tls=False)
    assert captured["name"] == "iam"
    assert captured["verify"] is False
    assert captured["region_name"] == "eu-west-1"


def test_list_users_enriches_user_data_and_skips_malformed_entries(monkeypatch):
    service, _ = _service(monkeypatch)
    users = service.list_users()
    assert len(users) == 1
    user = users[0]
    assert user.name == "alice"
    assert user.groups == ["grp-user"]
    assert user.policies == ["arn:policy:user"]
    assert user.inline_policies == ["inline-user-policy"]
    assert user.has_keys is True


def test_create_get_delete_user_error_paths(monkeypatch):
    service, fake = _service(monkeypatch)

    fake.raise_on["create_user"] = _client_error("EntityAlreadyExists", "CreateUser")
    existing_user = service.create_user("alice", allow_existing=True)[0]
    assert existing_user.name == "alice"

    fake.raise_on["get_user"] = _client_error("NoSuchEntity", "GetUser")
    assert service.get_user("missing") is None

    fake.raise_on["delete_user"] = _client_error("NoSuchEntity", "DeleteUser")
    service.delete_user("missing")


def test_access_key_methods_and_no_such_entity_handling(monkeypatch):
    service, fake = _service(monkeypatch)

    keys = service.list_access_keys("alice")
    assert keys and keys[0].access_key_id == "AKIA1"
    assert keys[0].created_at and keys[0].created_at.startswith("2026-01-01")

    created = service.create_access_key("alice")
    assert created.access_key_id == "AKIA2"
    assert created.secret_access_key == "SECRET2"

    fake.raise_on["delete_access_key"] = _client_error("NoSuchEntity", "DeleteAccessKey")
    service.delete_access_key("alice", "AKIA2")

    fake.raise_on["update_access_key"] = _client_error("NoSuchEntity", "UpdateAccessKey")
    with pytest.raises(RuntimeError, match="Access key not found"):
        service.update_access_key_status("alice", "AKIA2", "Inactive")


def test_user_group_role_policy_crud_smoke(monkeypatch):
    service, fake = _service(monkeypatch)

    assert service.list_user_policies("alice")[0].arn == "arn:policy:user"
    assert service.list_user_inline_policies("alice") == ["inline-user-policy"]
    assert service.get_user_inline_policy("alice", "inline-user-policy") == {"Version": "2012-10-17"}
    service.put_user_inline_policy("alice", "inline-user-policy", {"Statement": []})
    service.delete_user_inline_policy("alice", "inline-user-policy")
    service.attach_user_policy("alice", "arn:policy:user")
    service.detach_user_policy("alice", "arn:policy:user")

    groups = service.list_groups()
    assert groups and groups[0].name == "grp-a"
    created_group = service.create_group("grp-b")
    assert created_group.name == "grp-b"
    members = service.list_group_users("grp-a")
    assert members and members[0].name == "member-a"
    service.add_user_to_group("grp-a", "alice")
    service.remove_user_from_group("grp-a", "alice")
    assert service.list_group_policies("grp-a")[0].arn == "arn:policy:group"
    assert service.list_group_inline_policies("grp-a") == ["inline-group-policy"]
    assert service.get_group_inline_policy("grp-a", "inline-group-policy") == {"Version": "2012-10-17"}
    service.put_group_inline_policy("grp-a", "inline-group-policy", {"Statement": []})
    service.delete_group_inline_policy("grp-a", "inline-group-policy")
    service.attach_group_policy("grp-a", "arn:policy:group")
    service.detach_group_policy("grp-a", "arn:policy:group")

    roles = service.list_roles()
    assert roles and roles[0].name == "role-a"
    created_role = service.create_role("role-b", {"Statement": []}, path="/service/")
    assert created_role.name == "role-b"
    fetched_role = service.get_role("role-a")
    assert fetched_role and fetched_role.assume_role_policy_document == {"Version": "2012-10-17"}
    service.update_role_assume_policy("role-a", {"Statement": []})
    assert service.list_role_policies("role-a")[0].arn == "arn:policy:role"
    assert service.list_role_inline_policies("role-a") == ["inline-role-policy"]
    assert service.get_role_inline_policy("role-a", "inline-role-policy") == {"Statement": []}
    service.put_role_inline_policy("role-a", "inline-role-policy", {"Statement": []})
    service.delete_role_inline_policy("role-a", "inline-role-policy")
    service.attach_role_policy("role-a", "arn:policy:role")
    service.detach_role_policy("role-a", "arn:policy:role")

    # NoSuchEntity tolerant branches
    fake.raise_on["remove_user_from_group"] = _client_error("NoSuchEntity", "RemoveUserFromGroup")
    service.remove_user_from_group("grp-a", "alice")
    fake.raise_on["detach_group_policy"] = _client_error("NoSuchEntity", "DetachGroupPolicy")
    service.detach_group_policy("grp-a", "arn:policy:group")
    fake.raise_on["delete_group"] = _client_error("NoSuchEntity", "DeleteGroup")
    service.delete_group("missing")
    fake.raise_on["delete_role"] = _client_error("NoSuchEntity", "DeleteRole")
    service.delete_role("missing")


def test_policy_fallbacks_and_create_policy_not_supported(monkeypatch):
    service, fake = _service(monkeypatch)

    fake.raise_on["list_policies"] = _client_error("MethodNotAllowed", "ListPolicies")
    fallback = service.list_policies()
    assert any(policy.name == "AmazonS3FullAccess" for policy in fallback)

    fake.raise_on.pop("list_policies", None)
    detailed = service.get_policy("arn:custom", include_document=True)
    assert detailed and detailed.document == {"Version": "2012-10-17"}

    fake.raise_on["get_policy"] = _client_error("NoSuchEntity", "GetPolicy", status_code=404)
    default_policy = service.get_policy("arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess")
    assert default_policy and default_policy.name == "AmazonS3ReadOnlyAccess"

    fake.raise_on["get_policy"] = _client_error("MethodNotAllowed", "GetPolicy", status_code=405)
    default_policy_405 = service.get_policy("arn:aws:iam::aws:policy/IAMReadOnlyAccess")
    assert default_policy_405 and default_policy_405.name == "IAMReadOnlyAccess"

    fake.raise_on["create_policy"] = _client_error("NotImplemented", "CreatePolicy", status_code=405)
    with pytest.raises(ValueError, match="not supported"):
        service.create_policy("new-policy", {"Statement": []})

    fake.raise_on["delete_policy"] = _client_error("NoSuchEntity", "DeletePolicy")
    service.delete_policy("arn:missing")


def test_policy_document_normalization_and_factory(monkeypatch):
    service, _ = _service(monkeypatch)
    assert service._normalize_policy_document({"a": 1}) == {"a": 1}
    assert service._normalize_policy_document('{"a": 1}') == {"a": 1}
    assert service._normalize_policy_document("invalid-json") is None

    monkeypatch.setattr(rgw_iam, "RGWIAMService", lambda *args, **kwargs: "ok")
    assert rgw_iam.get_iam_service("AK", "SK", endpoint="https://iam.example.test") == "ok"


@pytest.mark.parametrize(
    ("operation", "raise_on", "call", "message"),
    [
        ("list_users", _client_error("AccessDenied", "ListUsers"), lambda svc: svc.list_users(), "Unable to list IAM users"),
        ("create_user", BotoCoreError(), lambda svc: svc.create_user("alice"), "Unable to create IAM user"),
        ("get_user", BotoCoreError(), lambda svc: svc.get_user("alice"), "Unable to fetch IAM user"),
        ("delete_user", BotoCoreError(), lambda svc: svc.delete_user("alice"), "Unable to delete IAM user"),
        (
            "list_access_keys",
            _client_error("AccessDenied", "ListAccessKeys"),
            lambda svc: svc.list_access_keys("alice"),
            "Unable to list IAM access keys",
        ),
        (
            "create_access_key",
            _client_error("AccessDenied", "CreateAccessKey"),
            lambda svc: svc.create_access_key("alice"),
            "Unable to create IAM access key",
        ),
        (
            "delete_access_key",
            _client_error("AccessDenied", "DeleteAccessKey"),
            lambda svc: svc.delete_access_key("alice", "AKIA1"),
            "Unable to delete IAM access key",
        ),
        (
            "update_access_key",
            _client_error("AccessDenied", "UpdateAccessKey"),
            lambda svc: svc.update_access_key_status("alice", "AKIA1", "Active"),
            "Unable to update IAM access key",
        ),
    ],
)
def test_user_methods_wrap_underlying_client_errors(monkeypatch, operation, raise_on, call, message):
    service, fake = _service(monkeypatch)
    fake.raise_on[operation] = raise_on
    with pytest.raises(RuntimeError, match=message):
        call(service)


def test_user_group_and_role_policy_error_paths(monkeypatch):
    service, fake = _service(monkeypatch)

    fake.raise_on["get_user_policy"] = _client_error("NoSuchEntity", "GetUserPolicy")
    assert service.get_user_inline_policy("alice", "p1") is None
    fake.raise_on["get_user_policy"] = _client_error("AccessDenied", "GetUserPolicy")
    with pytest.raises(RuntimeError, match="Unable to fetch inline policy for user"):
        service.get_user_inline_policy("alice", "p1")

    fake.raise_on["delete_user_policy"] = _client_error("NoSuchEntity", "DeleteUserPolicy")
    service.delete_user_inline_policy("alice", "p1")
    fake.raise_on["delete_user_policy"] = _client_error("AccessDenied", "DeleteUserPolicy")
    with pytest.raises(RuntimeError, match="Unable to delete inline policy from user"):
        service.delete_user_inline_policy("alice", "p1")

    fake.raise_on["detach_user_policy"] = _client_error("AccessDenied", "DetachUserPolicy")
    with pytest.raises(RuntimeError, match="Unable to detach policy from user"):
        service.detach_user_policy("alice", "arn:policy:user")

    fake.raise_on["list_groups_for_user"] = _client_error("AccessDenied", "ListGroupsForUser")
    with pytest.raises(RuntimeError, match="Unable to list groups for user"):
        service.list_groups_for_user("alice")

    fake.raise_on["list_groups"] = _client_error("AccessDenied", "ListGroups")
    with pytest.raises(RuntimeError, match="Unable to list IAM groups"):
        service.list_groups()
    fake.raise_on["create_group"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to create IAM group"):
        service.create_group("grp-x")
    fake.raise_on["delete_group"] = _client_error("AccessDenied", "DeleteGroup")
    with pytest.raises(RuntimeError, match="Unable to delete IAM group"):
        service.delete_group("grp-x")
    fake.raise_on["add_user_to_group"] = _client_error("AccessDenied", "AddUserToGroup")
    with pytest.raises(RuntimeError, match="Unable to add user to group"):
        service.add_user_to_group("grp-x", "alice")
    fake.raise_on["remove_user_from_group"] = _client_error("AccessDenied", "RemoveUserFromGroup")
    with pytest.raises(RuntimeError, match="Unable to remove user from group"):
        service.remove_user_from_group("grp-x", "alice")

    fake.raise_on["get_group_policy"] = _client_error("NoSuchEntity", "GetGroupPolicy")
    assert service.get_group_inline_policy("grp-x", "p1") is None
    fake.raise_on["get_group_policy"] = _client_error("AccessDenied", "GetGroupPolicy")
    with pytest.raises(RuntimeError, match="Unable to fetch inline policy for group"):
        service.get_group_inline_policy("grp-x", "p1")
    fake.raise_on["delete_group_policy"] = _client_error("NoSuchEntity", "DeleteGroupPolicy")
    service.delete_group_inline_policy("grp-x", "p1")
    fake.raise_on["delete_group_policy"] = _client_error("AccessDenied", "DeleteGroupPolicy")
    with pytest.raises(RuntimeError, match="Unable to delete inline policy from group"):
        service.delete_group_inline_policy("grp-x", "p1")
    fake.raise_on["detach_group_policy"] = _client_error("AccessDenied", "DetachGroupPolicy")
    with pytest.raises(RuntimeError, match="Unable to detach policy from group"):
        service.detach_group_policy("grp-x", "arn:policy:group")

    fake.raise_on["list_roles"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to list IAM roles"):
        service.list_roles()
    fake.raise_on["create_role"] = _client_error("AccessDenied", "CreateRole")
    with pytest.raises(RuntimeError, match="Unable to create IAM role"):
        service.create_role("role-x", {"Statement": []})
    fake.raise_on["get_role"] = _client_error("NoSuchEntity", "GetRole")
    assert service.get_role("missing") is None
    fake.raise_on["get_role"] = _client_error("AccessDenied", "GetRole")
    with pytest.raises(RuntimeError, match="Unable to fetch IAM role"):
        service.get_role("role-x")
    fake.raise_on["delete_role"] = _client_error("AccessDenied", "DeleteRole")
    with pytest.raises(RuntimeError, match="Unable to delete IAM role"):
        service.delete_role("role-x")
    fake.raise_on["update_assume_role_policy"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to update role trust policy"):
        service.update_role_assume_policy("role-x", {"Statement": []})

    fake.raise_on["get_role_policy"] = _client_error("NoSuchEntity", "GetRolePolicy")
    assert service.get_role_inline_policy("role-x", "p1") is None
    fake.raise_on["get_role_policy"] = _client_error("AccessDenied", "GetRolePolicy")
    with pytest.raises(RuntimeError, match="Unable to fetch inline policy for role"):
        service.get_role_inline_policy("role-x", "p1")
    fake.raise_on["delete_role_policy"] = _client_error("NoSuchEntity", "DeleteRolePolicy")
    service.delete_role_inline_policy("role-x", "p1")
    fake.raise_on["delete_role_policy"] = _client_error("AccessDenied", "DeleteRolePolicy")
    with pytest.raises(RuntimeError, match="Unable to delete inline policy from role"):
        service.delete_role_inline_policy("role-x", "p1")
    fake.raise_on["detach_role_policy"] = _client_error("AccessDenied", "DetachRolePolicy")
    with pytest.raises(RuntimeError, match="Unable to detach policy from role"):
        service.detach_role_policy("role-x", "arn:policy:role")


def test_policy_get_create_delete_runtime_error_paths(monkeypatch):
    service, fake = _service(monkeypatch)

    fake.raise_on["get_policy_version"] = _client_error("AccessDenied", "GetPolicyVersion")
    policy = service.get_policy("arn:custom", include_document=True)
    assert policy is not None
    assert policy.document is None

    fake.raise_on["get_policy"] = _client_error("AccessDenied", "GetPolicy")
    with pytest.raises(RuntimeError, match="Unable to fetch IAM policy"):
        service.get_policy("arn:custom")
    fake.raise_on["get_policy"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to fetch IAM policy"):
        service.get_policy("arn:custom")

    fake.raise_on["create_policy"] = _client_error("AccessDenied", "CreatePolicy")
    with pytest.raises(RuntimeError, match="Unable to create IAM policy"):
        service.create_policy("p-new", {"Statement": []})
    fake.raise_on["create_policy"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to create IAM policy"):
        service.create_policy("p-new", {"Statement": []})

    fake.raise_on["delete_policy"] = _client_error("AccessDenied", "DeletePolicy")
    with pytest.raises(RuntimeError, match="Unable to delete IAM policy"):
        service.delete_policy("arn:missing")
    fake.raise_on["delete_policy"] = BotoCoreError()
    with pytest.raises(RuntimeError, match="Unable to delete IAM policy"):
        service.delete_policy("arn:missing")


def test_create_user_create_key_success_and_existing_without_lookup_match(monkeypatch):
    service, fake = _service(monkeypatch)

    user, access_key = service.create_user("alice", create_key=True)
    assert user.name == "alice"
    assert access_key is not None
    assert access_key.access_key_id == "AKIA2"

    fake.raise_on["create_user"] = _client_error("EntityAlreadyExists", "CreateUser")
    monkeypatch.setattr(service, "get_user", lambda *args, **kwargs: None)
    with pytest.raises(RuntimeError, match="Unable to create IAM user"):
        service.create_user("alice", allow_existing=True)


def test_get_user_and_delete_user_non_no_such_entity_paths(monkeypatch):
    service, fake = _service(monkeypatch)
    monkeypatch.setattr(fake, "get_user", lambda **kwargs: {"User": {}})
    assert service.get_user("alice") is None

    service2, fake2 = _service(monkeypatch)
    fake2.raise_on["get_user"] = _client_error("AccessDenied", "GetUser")
    with pytest.raises(RuntimeError, match="Unable to fetch IAM user"):
        service2.get_user("alice")

    fake2.raise_on["delete_user"] = _client_error("AccessDenied", "DeleteUser")
    with pytest.raises(RuntimeError, match="Unable to delete IAM user"):
        service2.delete_user("alice")


@pytest.mark.parametrize(
    ("operation", "call", "message"),
    [
        (
            "delete_access_key",
            lambda svc: svc.delete_access_key("alice", "AKIA1"),
            "Unable to delete IAM access key",
        ),
        (
            "update_access_key",
            lambda svc: svc.update_access_key_status("alice", "AKIA1", "Inactive"),
            "Unable to update IAM access key",
        ),
        (
            "list_attached_user_policies",
            lambda svc: svc.list_user_policies("alice"),
            "Unable to list user policies",
        ),
        (
            "list_user_policies",
            lambda svc: svc.list_user_inline_policies("alice"),
            "Unable to list inline policies for user",
        ),
        (
            "get_user_policy",
            lambda svc: svc.get_user_inline_policy("alice", "p"),
            "Unable to fetch inline policy for user",
        ),
        (
            "put_user_policy",
            lambda svc: svc.put_user_inline_policy("alice", "p", {"Statement": []}),
            "Unable to put inline policy on user",
        ),
        (
            "delete_user_policy",
            lambda svc: svc.delete_user_inline_policy("alice", "p"),
            "Unable to delete inline policy from user",
        ),
        (
            "attach_user_policy",
            lambda svc: svc.attach_user_policy("alice", "arn:policy:user"),
            "Unable to attach policy to user",
        ),
        (
            "detach_user_policy",
            lambda svc: svc.detach_user_policy("alice", "arn:policy:user"),
            "Unable to detach policy from user",
        ),
        (
            "delete_group",
            lambda svc: svc.delete_group("grp-a"),
            "Unable to delete IAM group",
        ),
        (
            "remove_user_from_group",
            lambda svc: svc.remove_user_from_group("grp-a", "alice"),
            "Unable to remove user from group",
        ),
        (
            "list_attached_group_policies",
            lambda svc: svc.list_group_policies("grp-a"),
            "Unable to list group policies",
        ),
        (
            "list_group_policies",
            lambda svc: svc.list_group_inline_policies("grp-a"),
            "Unable to list inline policies for group",
        ),
        (
            "get_group_policy",
            lambda svc: svc.get_group_inline_policy("grp-a", "p"),
            "Unable to fetch inline policy for group",
        ),
        (
            "put_group_policy",
            lambda svc: svc.put_group_inline_policy("grp-a", "p", {"Statement": []}),
            "Unable to put inline policy on group",
        ),
        (
            "delete_group_policy",
            lambda svc: svc.delete_group_inline_policy("grp-a", "p"),
            "Unable to delete inline policy from group",
        ),
        (
            "attach_group_policy",
            lambda svc: svc.attach_group_policy("grp-a", "arn:policy:group"),
            "Unable to attach policy to group",
        ),
        (
            "detach_group_policy",
            lambda svc: svc.detach_group_policy("grp-a", "arn:policy:group"),
            "Unable to detach policy from group",
        ),
        (
            "get_role",
            lambda svc: svc.get_role("role-a"),
            "Unable to fetch IAM role",
        ),
        (
            "delete_role",
            lambda svc: svc.delete_role("role-a"),
            "Unable to delete IAM role",
        ),
        (
            "list_attached_role_policies",
            lambda svc: svc.list_role_policies("role-a"),
            "Unable to list role policies",
        ),
        (
            "list_role_policies",
            lambda svc: svc.list_role_inline_policies("role-a"),
            "Unable to list inline policies for role",
        ),
        (
            "get_role_policy",
            lambda svc: svc.get_role_inline_policy("role-a", "p"),
            "Unable to fetch inline policy for role",
        ),
        (
            "put_role_policy",
            lambda svc: svc.put_role_inline_policy("role-a", "p", {"Statement": []}),
            "Unable to put inline policy on role",
        ),
        (
            "delete_role_policy",
            lambda svc: svc.delete_role_inline_policy("role-a", "p"),
            "Unable to delete inline policy from role",
        ),
        (
            "attach_role_policy",
            lambda svc: svc.attach_role_policy("role-a", "arn:policy:role"),
            "Unable to attach policy to role",
        ),
        (
            "detach_role_policy",
            lambda svc: svc.detach_role_policy("role-a", "arn:policy:role"),
            "Unable to detach policy from role",
        ),
    ],
)
def test_remaining_botocore_error_wrapping(monkeypatch, operation, call, message):
    service, fake = _service(monkeypatch)
    fake.raise_on[operation] = BotoCoreError()
    with pytest.raises(RuntimeError, match=message):
        call(service)


def test_remaining_tolerant_detach_paths_and_group_users_error(monkeypatch):
    service, fake = _service(monkeypatch)

    fake.raise_on["detach_user_policy"] = _client_error("NoSuchEntity", "DetachUserPolicy")
    service.detach_user_policy("alice", "arn:policy:user")
    fake.raise_on["detach_role_policy"] = _client_error("NoSuchEntity", "DetachRolePolicy")
    service.detach_role_policy("role-a", "arn:policy:role")

    monkeypatch.setattr(fake, "get_paginator", lambda operation_name: (_ for _ in ()).throw(BotoCoreError()))
    with pytest.raises(RuntimeError, match="Unable to list IAM group members"):
        service.list_group_users("grp-a")


def test_remaining_success_paths_for_groups_and_policies(monkeypatch):
    service, _ = _service(monkeypatch)
    groups = service.list_groups_for_user("alice")
    assert groups and groups[0].name == "grp-user"

    policies = service.list_policies()
    assert policies and policies[0].name == "custom-policy"

    created = service.create_policy("policy-created", {"Statement": []})
    assert created.name == "policy-created"
    assert created.document == {"Statement": []}

    assert service._normalize_policy_document(None) is None
