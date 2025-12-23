# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from urllib.parse import quote

import pytest

from .clients import BackendAPIError, BackendSession


def _cleanup_iam_user(session: BackendSession, account_id: int, user_name: str) -> None:
    keys = session.get(
        f"/manager/iam/users/{user_name}/keys",
        params={"account_id": account_id},
    )
    for key in keys or []:
        session.delete(
            f"/manager/iam/users/{user_name}/keys/{key['access_key_id']}",
            params={"account_id": account_id},
            expected_status=(204,),
        )
    session.delete(
        f"/manager/iam/users/{user_name}",
        params={"account_id": account_id},
        expected_status=(204,),
    )
from .config import CephTestSettings


def _name(prefix: str, suffix: str) -> str:
    return f"{prefix}-{suffix}-{uuid.uuid4().hex[:6]}"


@pytest.mark.ceph_functional
def test_iam_policy_and_user_flow(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    iam_user = _name(ceph_test_settings.test_prefix, "iam")
    policy_name = _name(ceph_test_settings.test_prefix, "policy")

    created_user = manager_session.post(
        "/manager/iam/users",
        params={"account_id": account_id},
        json={"name": iam_user, "create_key": True},
        expected_status=201,
    )
    assert created_user["name"] == iam_user
    created_key = (created_user.get("access_key") or {}).get("access_key_id")

    users = manager_session.get("/manager/iam/users", params={"account_id": account_id})
    assert any(entry["name"] == iam_user for entry in users)

    policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:ListBucket"],
                "Resource": ["*"],
            }
        ],
    }
    policy_arn: str | None = None
    encoded_policy_arn: str | None = None
    try:
        policy = manager_session.post(
            "/manager/iam/policies",
            params={"account_id": account_id},
            json={"name": policy_name, "document": policy_document},
            expected_status=201,
        )
        policy_arn = policy["arn"]
        encoded_policy_arn = quote(policy_arn, safe="")
    except BackendAPIError as exc:
        detail = ""
        if isinstance(exc.payload, dict):
            detail = str(exc.payload.get("detail") or "")
        if "CreatePolicy is not supported" in detail:
            _cleanup_iam_user(manager_session, account_id, iam_user)
            pytest.skip(f"IAM managed policies unsupported on this cluster: {detail}")
        raise

    manager_session.post(
        f"/manager/iam/users/{iam_user}/policies",
        params={"account_id": account_id},
        json={"arn": policy_arn, "name": policy_name, "path": policy.get("path", "/")},
        expected_status=201,
    )
    attached = manager_session.get(
        f"/manager/iam/users/{iam_user}/policies",
        params={"account_id": account_id},
    )
    assert any(entry["arn"] == policy_arn for entry in attached)

    new_key = manager_session.post(
        f"/manager/iam/users/{iam_user}/keys",
        params={"account_id": account_id},
        expected_status=201,
    )
    keys = manager_session.get(
        f"/manager/iam/users/{iam_user}/keys",
        params={"account_id": account_id},
    )
    assert keys, "IAM user should expose at least one access key"

    if created_key:
        manager_session.delete(
            f"/manager/iam/users/{iam_user}/keys/{created_key}",
            params={"account_id": account_id},
            expected_status=(204,),
        )

    _cleanup_iam_user(manager_session, account_id, iam_user)
    if encoded_policy_arn:
        manager_session.delete(
            f"/manager/iam/policies/{encoded_policy_arn}",
            params={"account_id": account_id},
            expected_status=(204,),
        )
