# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

import pytest

from .ceph_admin_helpers import run_or_skip
from .clients import BackendSession, CephVerifier
from .conftest import CephAdminEndpointTestContext
from .resources import ResourceTracker


@pytest.mark.ceph_functional
def test_ceph_admin_create_account_and_user_with_cleanup(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
    ceph_verifier: CephVerifier | None,
    ceph_test_settings,
    resource_tracker: ResourceTracker,
) -> None:
    if ceph_verifier is None or resource_tracker.rgw_admin_client is None:
        pytest.skip("Ceph Admin create flows require RGW admin cleanup credentials")
    if not ceph_admin_endpoint.can_accounts:
        pytest.skip("Ceph Admin account API is not reported as available on this endpoint")

    endpoint_id = ceph_admin_endpoint.endpoint_id
    accounts_path = f"/ceph-admin/endpoints/{endpoint_id}/accounts"
    users_path = f"/ceph-admin/endpoints/{endpoint_id}/users"

    account_name = f"{ceph_test_settings.test_prefix}-ca-account-{uuid.uuid4().hex[:8]}"
    account_email = f"{ceph_test_settings.test_prefix}.{uuid.uuid4().hex[:8]}@example.com"

    created_account = run_or_skip(
        "ceph-admin account creation",
        lambda: super_admin_session.post(
            accounts_path,
            json={
                "account_name": account_name,
                "email": account_email,
                "max_users": 20,
                "max_buckets": 20,
                "quota_enabled": True,
                "quota_max_objects": 5000,
                "bucket_quota_enabled": True,
                "bucket_quota_max_objects": 500,
            },
            expected_status=201,
        ),
    )
    account = created_account["account"]
    account_id = account["account_id"]
    bootstrap_uid = f"{account_id}-admin"
    resource_tracker.track_ceph_admin_user(bootstrap_uid, tenant=None)
    resource_tracker.track_ceph_admin_account(account_id)

    detail = run_or_skip(
        "ceph-admin created account detail",
        lambda: super_admin_session.get(f"{accounts_path}/{account_id}/detail"),
    )
    assert detail["account_id"] == account_id

    uid = f"cfu-{uuid.uuid4().hex[:8]}"
    created_user = run_or_skip(
        "ceph-admin user creation",
        lambda: super_admin_session.post(
            users_path,
            json={
                "uid": uid,
                "account_id": account_id,
                "display_name": uid,
                "email": f"{uid}@example.com",
                "generate_key": True,
                "quota_enabled": True,
                "quota_max_objects": 1000,
            },
            expected_status=201,
        ),
    )
    resource_tracker.track_ceph_admin_user(uid, tenant=None)
    assert created_user["detail"]["uid"] == uid

    run_or_skip(
        "ceph-admin created user detail",
        lambda: super_admin_session.get(f"{users_path}/{uid}/detail"),
    )
    keys = run_or_skip(
        "ceph-admin created user keys listing",
        lambda: super_admin_session.get(f"{users_path}/{uid}/keys"),
    )
    assert isinstance(keys, list)
