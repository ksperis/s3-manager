# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import boto3
import pytest
import requests
from botocore.config import Config
from botocore.exceptions import ClientError

from app.utils.storage_endpoint_features import dump_features_config, normalize_features_config

from .clients import BackendAPIError, BackendAuthenticator, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _prefix() -> str:
    return f"ptl-e2e-{int(time.time())}-{uuid.uuid4().hex[:6]}"


def _verify_value(settings: CephTestSettings) -> bool | str:
    return settings.backend_ca_bundle or settings.verify_tls


def _s3_client(
    *,
    endpoint: str,
    access_key: str,
    secret_key: str,
    session_token: str | None = None,
    verify: bool | str,
    region: str = "us-east-1",
):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        aws_session_token=session_token,
        region_name=region,
        verify=verify,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@contextmanager
def _temporary_endpoint_update(
    admin_session: BackendSession,
    endpoint_id: int,
    payload: dict,
):
    original = admin_session.get(f"/admin/storage-endpoints/{endpoint_id}")
    restore = {
        "features_config": original.get("features_config"),
        "presign_enabled": original.get("presign_enabled"),
        "allow_external_access": original.get("allow_external_access"),
        "max_session_duration": original.get("max_session_duration"),
        "allowed_packages": original.get("allowed_packages"),
    }
    admin_session.put(
        f"/admin/storage-endpoints/{endpoint_id}",
        json=payload,
        expected_status=200,
    )
    try:
        yield
    finally:
        admin_session.put(
            f"/admin/storage-endpoints/{endpoint_id}",
            json=restore,
            expected_status=200,
        )


def _create_account(
    admin_session: BackendSession,
    tracker: ResourceTracker,
    *,
    name: str,
    email: str,
    storage_endpoint_id: int | None = None,
) -> dict:
    payload: dict = {
        "name": name,
        "email": email,
        "quota_max_size_gb": 5,
        "quota_max_objects": 5000,
    }
    if storage_endpoint_id is not None:
        payload["storage_endpoint_id"] = storage_endpoint_id
    created = admin_session.post("/admin/accounts", json=payload, expected_status=201)
    account_id = int(created.get("db_id") or created["id"])
    tracker.track_account(account_id)
    created["__account_id"] = account_id
    return created


def _create_user(
    admin_session: BackendSession,
    tracker: ResourceTracker,
    *,
    email: str,
    password: str,
    role: str = "ui_user",
) -> dict:
    created = admin_session.post(
        "/admin/users",
        json={"email": email, "password": password, "full_name": "Portal E2E", "role": role},
        expected_status=201,
    )
    tracker.track_user(int(created["id"]))
    created["__password"] = password
    return created


def _assign_user_to_account(
    admin_session: BackendSession,
    *,
    user_id: int,
    account_id: int,
    portal_role_key: str,
    manager_root_access: bool = False,
) -> None:
    admin_session.post(
        f"/admin/users/{user_id}/assign-account",
        json={
            "account_id": account_id,
            "account_root": False,
            "manager_root_access": manager_root_access,
            "portal_role_key": portal_role_key,
        },
        expected_status=200,
    )


@pytest.mark.ceph_functional
def test_portal_multi_account_context_and_rbac(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    resource_tracker: ResourceTracker,
) -> None:
    prefix = _prefix()

    endpoints = super_admin_session.get("/admin/storage-endpoints")
    default_endpoint = next((ep for ep in endpoints if ep.get("is_default")), endpoints[0] if endpoints else None)
    if not default_endpoint:
        pytest.skip("No storage endpoints configured on the backend")
    endpoint_id = int(default_endpoint["id"])

    account1 = _create_account(
        super_admin_session,
        resource_tracker,
        name=f"{prefix}-acct-a",
        email=f"{prefix}-a@example.com",
        storage_endpoint_id=endpoint_id,
    )
    account2 = _create_account(
        super_admin_session,
        resource_tracker,
        name=f"{prefix}-acct-b",
        email=f"{prefix}-b@example.com",
        storage_endpoint_id=endpoint_id,
    )

    actor = _create_user(
        super_admin_session,
        resource_tracker,
        email=f"{prefix}.actor@example.com",
        password=f"Test-{uuid.uuid4().hex[:10]}",
        role="ui_user",
    )
    actor_id = int(actor["id"])

    _assign_user_to_account(super_admin_session, user_id=actor_id, account_id=account1["__account_id"], portal_role_key="Viewer")
    _assign_user_to_account(super_admin_session, user_id=actor_id, account_id=account2["__account_id"], portal_role_key="AccountAdmin")

    actor_session = backend_authenticator.login(actor["email"], actor["__password"])

    accounts = actor_session.get("/portal/accounts", expected_status=200)
    assert {a["id"] for a in accounts} == {account1["__account_id"], account2["__account_id"]}

    ctx_viewer = actor_session.get("/portal/context", params={"account_id": account1["__account_id"]}, expected_status=200)
    ctx_admin = actor_session.get("/portal/context", params={"account_id": account2["__account_id"]}, expected_status=200)
    assert ctx_viewer["portal_role"] == "Viewer"
    assert ctx_admin["portal_role"] == "AccountAdmin"

    viewer_members = actor_session.get(
        "/portal/members",
        params={"account_id": account1["__account_id"]},
        expected_status=(403,),
    )
    assert viewer_members["detail"] == "Insufficient permissions"
    actor_session.get("/portal/members", params={"account_id": account2["__account_id"]}, expected_status=200)


@pytest.mark.ceph_functional
def test_portal_integrated_access_sts_and_presigned(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    resource_tracker: ResourceTracker,
) -> None:
    prefix = _prefix()
    verify = _verify_value(ceph_test_settings)

    endpoints = super_admin_session.get("/admin/storage-endpoints")
    default_endpoint = next((ep for ep in endpoints if ep.get("is_default")), endpoints[0] if endpoints else None)
    if not default_endpoint:
        pytest.skip("No storage endpoints configured on the backend")
    if not default_endpoint.get("is_editable", True):
        pytest.skip("Default storage endpoint is not editable; cannot toggle STS for portal E2E")
    endpoint_id = int(default_endpoint["id"])
    provider = default_endpoint.get("provider") or "ceph"
    existing_features = normalize_features_config(provider, default_endpoint.get("features_config"))

    account = _create_account(
        super_admin_session,
        resource_tracker,
        name=f"{prefix}-acct",
        email=f"{prefix}@example.com",
        storage_endpoint_id=endpoint_id,
    )
    account_id = account["__account_id"]

    actor = _create_user(
        super_admin_session,
        resource_tracker,
        email=f"{prefix}.admin@example.com",
        password=f"Test-{uuid.uuid4().hex[:10]}",
        role="ui_user",
    )
    actor_id = int(actor["id"])
    _assign_user_to_account(super_admin_session, user_id=actor_id, account_id=account_id, portal_role_key="AccountAdmin")
    actor_session = backend_authenticator.login(actor["email"], actor["__password"])

    bucket_name = f"{prefix}-bucket"
    created_bucket = actor_session.post(
        "/portal/buckets",
        params={"account_id": account_id},
        json={"name": bucket_name, "versioning": False},
        expected_status=201,
    )
    assert created_bucket["name"] == bucket_name
    resource_tracker.track_bucket(account_id, bucket_name)

    # --- STS path (optional, depends on RGW/ST S availability) ---
    sts_features = dict(existing_features)
    sts_features["sts"] = dict(sts_features.get("sts", {}))
    sts_features["sts"]["enabled"] = True
    sts_features_config = dump_features_config(sts_features)
    with _temporary_endpoint_update(
        super_admin_session,
        endpoint_id,
        {"features_config": sts_features_config},
    ):
        sts_status = actor_session.get("/portal/browser/sts", params={"account_id": account_id}, expected_status=200)
        if not sts_status.get("available"):
            pytest.skip(f"STS is not available on this cluster: {sts_status.get('error')}")
        creds = actor_session.get("/portal/browser/sts/credentials", params={"account_id": account_id}, expected_status=200)
        expiration = creds.get("expiration")
        assert expiration, "STS credentials must include expiration"

        sts_s3 = _s3_client(
            endpoint=creds["endpoint"],
            access_key=creds["access_key_id"],
            secret_key=creds["secret_access_key"],
            session_token=creds["session_token"],
            verify=verify,
            region=creds.get("region") or "us-east-1",
        )
        listed = sts_s3.list_buckets()
        assert any(b.get("Name") == bucket_name for b in listed.get("Buckets", []) or [])

    # --- Presigned fallback path (force STS disabled) ---
    presign_features = dict(existing_features)
    presign_features["sts"] = dict(presign_features.get("sts", {}))
    presign_features["sts"]["enabled"] = False
    presign_features_config = dump_features_config(presign_features)
    with _temporary_endpoint_update(
        super_admin_session,
        endpoint_id,
        {"features_config": presign_features_config},
    ):
        key = "hello.txt"
        body = b"portal-presign"

        put_presign = actor_session.post(
            f"/portal/browser/buckets/{bucket_name}/presign",
            params={"account_id": account_id},
            json={"operation": "put_object", "key": key, "expires_in": 900, "content_type": "text/plain"},
            expected_status=200,
        )
        put_resp = requests.put(
            put_presign["url"],
            data=body,
            headers=put_presign.get("headers") or {},
            timeout=ceph_test_settings.request_timeout,
            verify=verify,
        )
        assert put_resp.status_code in (200, 201, 204)

        get_presign = actor_session.post(
            f"/portal/browser/buckets/{bucket_name}/presign",
            params={"account_id": account_id},
            json={"operation": "get_object", "key": key, "expires_in": 900},
            expected_status=200,
        )
        get_resp = requests.get(
            get_presign["url"],
            timeout=ceph_test_settings.request_timeout,
            verify=verify,
        )
        assert get_resp.status_code == 200
        assert get_resp.content == body

        listing = actor_session.get(
            f"/portal/browser/buckets/{bucket_name}/objects",
            params={"account_id": account_id, "prefix": ""},
            expected_status=200,
        )
        assert any(obj.get("key") == key for obj in listing.get("objects") or [])

        actor_session.post(
            f"/portal/browser/buckets/{bucket_name}/delete",
            params={"account_id": account_id},
            json={"objects": [{"key": key}]},
            expected_status=(204,),
        )
        listing_after = actor_session.get(
            f"/portal/browser/buckets/{bucket_name}/objects",
            params={"account_id": account_id, "prefix": ""},
            expected_status=200,
        )
        assert not any(obj.get("key") == key for obj in listing_after.get("objects") or [])


@pytest.mark.ceph_functional
def test_portal_external_access_packages_and_bucket_provisioning(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    backend_authenticator: BackendAuthenticator,
    resource_tracker: ResourceTracker,
) -> None:
    prefix = _prefix()
    verify = _verify_value(ceph_test_settings)

    endpoints = super_admin_session.get("/admin/storage-endpoints")
    default_endpoint = next((ep for ep in endpoints if ep.get("is_default")), endpoints[0] if endpoints else None)
    if not default_endpoint:
        pytest.skip("No storage endpoints configured on the backend")
    if not default_endpoint.get("is_editable", True):
        pytest.skip("Default storage endpoint is not editable; cannot enable external access for portal E2E")
    endpoint_id = int(default_endpoint["id"])

    # Ensure endpoint allows external access + packages for delegated admins.
    allow_payload = {
        "allow_external_access": True,
        "allowed_packages": ["BucketReadOnly", "BucketReadWrite", "BucketAdmin"],
        "presign_enabled": True,
        "max_session_duration": 3600,
    }

    account = _create_account(
        super_admin_session,
        resource_tracker,
        name=f"{prefix}-acct",
        email=f"{prefix}@example.com",
        storage_endpoint_id=endpoint_id,
    )
    account_id = account["__account_id"]

    account_admin = _create_user(
        super_admin_session,
        resource_tracker,
        email=f"{prefix}.acct-admin@example.com",
        password=f"Test-{uuid.uuid4().hex[:10]}",
        role="ui_user",
    )
    account_admin_id = int(account_admin["id"])
    _assign_user_to_account(super_admin_session, user_id=account_admin_id, account_id=account_id, portal_role_key="AccountAdmin")
    account_admin_session = backend_authenticator.login(account_admin["email"], account_admin["__password"])

    delegated = _create_user(
        super_admin_session,
        resource_tracker,
        email=f"{prefix}.access-admin@example.com",
        password=f"Test-{uuid.uuid4().hex[:10]}",
        role="ui_user",
    )
    delegated_id = int(delegated["id"])
    _assign_user_to_account(super_admin_session, user_id=delegated_id, account_id=account_id, portal_role_key="Viewer")

    with _temporary_endpoint_update(super_admin_session, endpoint_id, allow_payload):
        # Promote delegated user to AccessAdmin
        account_admin_session.put(
            f"/portal/members/{delegated_id}/role",
            params={"account_id": account_id},
            json={"role_key": "AccessAdmin"},
            expected_status=200,
        )

        bucket_name = f"{prefix}-bucket"
        created_bucket = account_admin_session.post(
            "/portal/buckets",
            params={"account_id": account_id},
            json={"name": bucket_name, "versioning": False},
            expected_status=201,
        )
        assert created_bucket["tags"].get("managed-by") == "portal"
        assert created_bucket["tags"].get("portal-account") == str(account_id)
        assert created_bucket["tags"].get("portal-scope") == "bucket"
        assert created_bucket["tags"].get("workflow") == "bucket.create"
        resource_tracker.track_bucket(account_id, bucket_name)

        delegated_session = backend_authenticator.login(delegated["email"], delegated["__password"])

        status_before = delegated_session.get("/portal/access/me", params={"account_id": account_id}, expected_status=200)
        assert status_before["allow_external_access"] is True
        assert status_before["external_enabled"] is False

        creds = delegated_session.post(
            "/portal/access/me/enable",
            params={"account_id": account_id},
            expected_status=201,
        )

        # Assign a RW package and validate S3 access.
        grant = delegated_session.post(
            "/portal/access/grants",
            params={"account_id": account_id},
            json={"user_id": delegated_id, "package_key": "BucketReadWrite", "bucket": bucket_name},
            expected_status=201,
        )
        assert grant["materialization_status"] == "active", grant.get("materialization_error")

        endpoint_url = default_endpoint.get("endpoint_url") or default_endpoint.get("storage_endpoint_url")
        if not endpoint_url:
            pytest.skip("Storage endpoint URL missing from backend response; cannot validate S3 operations")
        s3 = _s3_client(
            endpoint=endpoint_url,
            access_key=creds["access_key_id"],
            secret_key=creds["secret_access_key"],
            verify=verify,
        )

        key = "rw.txt"
        s3.put_object(Bucket=bucket_name, Key=key, Body=b"rw")
        got = s3.get_object(Bucket=bucket_name, Key=key)
        assert got["Body"].read() == b"rw"
        s3.delete_object(Bucket=bucket_name, Key=key)

        # Ensure delegated creds cannot create buckets (CreateBucket is never granted by packages).
        unexpected_bucket = f"{prefix}-nope"
        try:
            s3.create_bucket(Bucket=unexpected_bucket)
        except ClientError:
            pass
        else:
            resource_tracker.track_bucket(account_id, unexpected_bucket)
            raise AssertionError("External credentials unexpectedly allowed CreateBucket")

        delegated_session.delete(
            f"/portal/access/grants/{delegated_id}/{grant['id']}",
            params={"account_id": account_id},
            expected_status=(204,),
        )
        delegated_session.post(
            "/portal/access/me/revoke",
            params={"account_id": account_id},
            expected_status=(204,),
        )
