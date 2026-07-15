# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from typing import Any

import boto3
import pytest
from botocore.config import Config

from .clients import BackendSession, CephVerifier
from .conftest import CephAdminEndpointTestContext
from .resources import ResourceTracker


def _name(prefix: str, label: str) -> str:
    return f"{prefix}-adminops-{label}-{uuid.uuid4().hex[:8]}"


def _assert_success(payload: dict[str, Any], operation: str) -> None:
    assert payload["operation"] == operation
    assert payload["success"] is True
    assert isinstance(payload["rgw_status_code"], int)
    assert 200 <= payload["rgw_status_code"] < 300


def _bucket_owner(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates = [payload]
    for key in ("bucket", "data", "stats"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            candidates.append(nested)
    for candidate in candidates:
        owner = candidate.get("owner")
        if isinstance(owner, str) and owner.strip():
            return owner.strip()
    return None


def _listed_bucket_names(payload: Any) -> set[str]:
    names: set[str] = set()
    if isinstance(payload, str):
        names.add(payload)
    elif isinstance(payload, list):
        for item in payload:
            names.update(_listed_bucket_names(item))
    elif isinstance(payload, dict):
        for key in ("bucket", "name", "Name"):
            value = payload.get(key)
            if isinstance(value, str):
                names.add(value)
        for value in payload.values():
            if isinstance(value, (dict, list)):
                names.update(_listed_bucket_names(value))
    return names


def _s3_client(endpoint_url: str, access_key: str, secret_key: str, settings):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=settings.rgw_admin_region or "us-east-1",
        verify=settings.rgw_ca_bundle or settings.rgw_verify_tls,
        config=Config(s3={"addressing_style": "path"}),
    )


@pytest.mark.ceph_functional
def test_ceph_admin_admin_ops_lifecycle(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
    ceph_verifier: CephVerifier | None,
    ceph_test_settings,
    resource_tracker: ResourceTracker,
) -> None:
    if ceph_verifier is None or resource_tracker.rgw_admin_client is None:
        pytest.skip("RGW Admin Ops functional tests require RGW admin verification credentials")
    if not ceph_admin_endpoint.can_accounts:
        pytest.skip("RGW Account Admin Ops require a Squid-or-later RGW account API")

    endpoint_id = ceph_admin_endpoint.endpoint_id
    root = f"/ceph-admin/endpoints/{endpoint_id}"
    endpoint_payload = next(
        item
        for item in super_admin_session.get("/ceph-admin/endpoints")
        if int(item["id"]) == endpoint_id
    )
    s3_endpoint = endpoint_payload["endpoint_url"]
    rgw = resource_tracker.rgw_admin_client

    tracked_users: set[str] = set()
    tracked_accounts: set[str] = set()
    tracked_buckets: set[str] = set()

    def create_account(label: str) -> str:
        account_name = _name(ceph_test_settings.test_prefix, label)
        response = super_admin_session.post(
            f"{root}/accounts",
            json={"account_name": account_name, "max_users": 10, "max_buckets": 10},
            expected_status=201,
        )
        account_id = response["account"]["account_id"]
        tracked_accounts.add(account_id)
        resource_tracker.track_ceph_admin_account(account_id)
        return account_id

    def create_user(label: str, *, account_id: str | None = None) -> tuple[str, dict[str, str] | None]:
        uid = _name(ceph_test_settings.test_prefix, label)
        payload: dict[str, Any] = {
            "uid": uid,
            "display_name": uid,
            "generate_key": account_id is None,
        }
        if account_id:
            payload["account_id"] = account_id
        response = super_admin_session.post(f"{root}/users", json=payload, expected_status=201)
        tracked_users.add(uid)
        resource_tracker.track_ceph_admin_user(uid)
        return uid, response.get("generated_key")

    def track_bucket(bucket: str) -> None:
        tracked_buckets.add(bucket)
        resource_tracker.track_ceph_admin_bucket(bucket)

    def discard_user(uid: str) -> None:
        tracked_users.discard(uid)
        resource_tracker.discard_ceph_admin_user(uid)

    def discard_account(account_id: str) -> None:
        tracked_accounts.discard(account_id)
        resource_tracker.discard_ceph_admin_account(account_id)

    def discard_bucket(bucket: str) -> None:
        tracked_buckets.discard(bucket)
        resource_tracker.discard_ceph_admin_bucket(bucket)

    try:
        empty_account = create_account("empty-account")
        deleted = super_admin_session.delete(
            f"{root}/accounts/{empty_account}",
            json={"confirmation": f"DELETE ACCOUNT {empty_account}"},
        )
        _assert_success(deleted, "delete_account")
        discard_account(empty_account)

        nonempty_account = create_account("nonempty-account")
        account_user, _ = create_user("account-user", account_id=nonempty_account)
        refused = super_admin_session.delete(
            f"{root}/accounts/{nonempty_account}",
            json={"confirmation": f"DELETE ACCOUNT {nonempty_account}"},
            expected_status=(400, 409),
        )
        assert refused["success"] is False
        assert refused["rgw_status_code"] in {400, 409}
        assert refused["rgw_error_code"]

        deleted = super_admin_session.delete(
            f"{root}/users/{account_user}",
            json={"confirmation": f"DELETE USER {account_user}", "purge_data": False},
        )
        _assert_success(deleted, "delete_user")
        discard_user(account_user)
        deleted = super_admin_session.delete(
            f"{root}/accounts/{nonempty_account}",
            json={"confirmation": f"DELETE ACCOUNT {nonempty_account}"},
        )
        _assert_success(deleted, "delete_account")
        discard_account(nonempty_account)

        empty_user, _ = create_user("empty-user")
        deleted = super_admin_session.delete(
            f"{root}/users/{empty_user}",
            json={"confirmation": f"DELETE USER {empty_user}", "purge_data": False},
        )
        _assert_success(deleted, "delete_user")
        discard_user(empty_user)

        data_user, data_key = create_user("data-user")
        assert data_key and data_key.get("access_key") and data_key.get("secret_key")
        data_client = _s3_client(s3_endpoint, data_key["access_key"], data_key["secret_key"], ceph_test_settings)
        data_bucket = _name(ceph_test_settings.test_prefix, "user-purge")
        data_client.create_bucket(Bucket=data_bucket)
        data_client.put_object(Bucket=data_bucket, Key="owned.txt", Body=b"owned by purge-data user")
        track_bucket(data_bucket)
        deleted = super_admin_session.delete(
            f"{root}/users/{data_user}",
            json={"confirmation": f"PURGE USER {data_user}", "purge_data": True},
        )
        _assert_success(deleted, "delete_user")
        assert rgw.get_user(data_user, allow_not_found=True) is None
        discard_user(data_user)
        discard_bucket(data_bucket)

        bucket_user, bucket_key = create_user("bucket-owner")
        assert bucket_key and bucket_key.get("access_key") and bucket_key.get("secret_key")
        bucket_client = _s3_client(s3_endpoint, bucket_key["access_key"], bucket_key["secret_key"], ceph_test_settings)

        purge_bucket = _name(ceph_test_settings.test_prefix, "bucket-purge")
        bucket_client.create_bucket(Bucket=purge_bucket)
        bucket_client.put_object(Bucket=purge_bucket, Key="payload.txt", Body=b"bucket purge")
        track_bucket(purge_bucket)
        refused = super_admin_session.delete(
            f"{root}/buckets/{purge_bucket}",
            json={
                "confirmation": f"DELETE BUCKET {purge_bucket}",
                "purge_objects": False,
                "bypass_gc": False,
            },
            expected_status=(400, 409),
        )
        assert refused["success"] is False
        assert refused["rgw_error_code"] == "BucketNotEmpty"
        deleted = super_admin_session.delete(
            f"{root}/buckets/{purge_bucket}",
            json={
                "confirmation": f"PURGE AND DELETE BUCKET {purge_bucket}",
                "purge_objects": True,
                "bypass_gc": False,
            },
        )
        _assert_success(deleted, "delete_bucket")
        owner_buckets = bucket_client.list_buckets()
        assert purge_bucket not in _listed_bucket_names(owner_buckets)
        discard_bucket(purge_bucket)

        bypass_bucket = _name(ceph_test_settings.test_prefix, "bucket-bypass")
        bucket_client.create_bucket(Bucket=bypass_bucket)
        bucket_client.put_object(Bucket=bypass_bucket, Key="payload.txt", Body=b"bypass gc")
        track_bucket(bypass_bucket)
        deleted = super_admin_session.delete(
            f"{root}/buckets/{bypass_bucket}",
            json={
                "confirmation": f"PURGE AND DELETE BUCKET {bypass_bucket}",
                "purge_objects": True,
                "bypass_gc": True,
            },
        )
        _assert_success(deleted, "delete_bucket")
        owner_buckets = bucket_client.list_buckets()
        assert bypass_bucket not in _listed_bucket_names(owner_buckets)
        discard_bucket(bypass_bucket)

        link_source, link_source_key = create_user("link-source")
        link_target, _ = create_user("link-target")
        link_account = create_account("link-account")
        assert link_source_key and link_source_key.get("access_key") and link_source_key.get("secret_key")
        link_client = _s3_client(
            s3_endpoint,
            link_source_key["access_key"],
            link_source_key["secret_key"],
            ceph_test_settings,
        )
        link_bucket = _name(ceph_test_settings.test_prefix, "bucket-link")
        link_client.create_bucket(Bucket=link_bucket)
        link_client.put_object(Bucket=link_bucket, Key="keep.txt", Body=b"link keeps data")
        track_bucket(link_bucket)

        checked = super_admin_session.post(
            f"{root}/buckets/{link_bucket}/index-check",
            json={"fix": False, "check_objects": False},
        )
        _assert_success(checked, "check_bucket_index")
        checked = super_admin_session.post(
            f"{root}/buckets/{link_bucket}/index-check",
            json={
                "fix": True,
                "check_objects": True,
                "confirmation": f"FIX BUCKET INDEX {link_bucket}",
            },
        )
        _assert_success(checked, "check_bucket_index")

        unlinked = super_admin_session.post(
            f"{root}/buckets/{link_bucket}/unlink",
            json={"confirmation": f"UNLINK BUCKET {link_bucket}"},
        )
        _assert_success(unlinked, "unlink_bucket")
        source_listing = link_client.list_buckets()
        assert link_bucket not in _listed_bucket_names(source_listing)

        linked = super_admin_session.put(
            f"{root}/buckets/{link_bucket}/link",
            json={
                "confirmation": f"LINK BUCKET {link_bucket} TO {link_target}",
                "target_type": "user",
                "target_id": link_target,
            },
        )
        _assert_success(linked, "link_bucket")
        assert _bucket_owner(rgw.get_bucket_info(link_bucket, stats=False)) == link_target

        linked = super_admin_session.put(
            f"{root}/buckets/{link_bucket}/link",
            json={
                "confirmation": f"LINK BUCKET {link_bucket} TO {link_account}",
                "target_type": "account",
                "target_id": link_account,
            },
        )
        _assert_success(linked, "link_bucket")
        assert _bucket_owner(rgw.get_bucket_info(link_bucket, stats=False)) == link_account

        deleted = super_admin_session.delete(
            f"{root}/buckets/{link_bucket}",
            json={
                "confirmation": f"PURGE AND DELETE BUCKET {link_bucket}",
                "purge_objects": True,
                "bypass_gc": False,
            },
        )
        _assert_success(deleted, "delete_bucket")
        discard_bucket(link_bucket)

        for uid in (bucket_user, link_source, link_target):
            deleted = super_admin_session.delete(
                f"{root}/users/{uid}",
                json={"confirmation": f"DELETE USER {uid}", "purge_data": False},
            )
            _assert_success(deleted, "delete_user")
            discard_user(uid)
        deleted = super_admin_session.delete(
            f"{root}/accounts/{link_account}",
            json={"confirmation": f"DELETE ACCOUNT {link_account}"},
        )
        _assert_success(deleted, "delete_account")
        discard_account(link_account)
    finally:
        for bucket in list(tracked_buckets):
            try:
                result = rgw.delete_bucket_operation(bucket, purge_objects=True)
                if result.success or result.status_code == 404:
                    discard_bucket(bucket)
            except Exception:
                pass
        for uid in list(tracked_users):
            try:
                result = rgw.delete_user_operation(uid, purge_data=True)
                if result.success or result.status_code == 404:
                    discard_user(uid)
            except Exception:
                pass
        for account_id in list(tracked_accounts):
            try:
                result = rgw.delete_account_operation(account_id)
                if result.success or result.status_code == 404:
                    discard_account(account_id)
            except Exception:
                pass
