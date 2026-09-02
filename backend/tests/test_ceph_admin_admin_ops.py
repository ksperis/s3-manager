# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.main import app
from app.models.ceph_admin import (
    CephAdminAdminOpsConfirmation,
    CephAdminBucketDeleteRequest,
    CephAdminBucketIndexCheckRequest,
    CephAdminBucketLinkRequest,
    CephAdminUserDeleteRequest,
)
from app.routers.ceph_admin import admin_ops, bucket_admin_ops, bucket_index_ops, identity_admin_ops
from app.services.rgw_admin import RGWAdminError, RGWAdminOperationResponse
from router_test_utils import effective_routes


def _upstream(
    status_code: int = 204,
    *,
    success: bool = True,
    error_code: str | None = None,
    message: str = "ok",
    result=None,
) -> RGWAdminOperationResponse:
    return RGWAdminOperationResponse(
        status_code=status_code,
        success=success,
        error_code=error_code,
        message=message,
        result=result,
    )


class FakeAudit:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.calls.append(kwargs)


class FakeAdmin:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.response = _upstream()
        self.active_identity = {"uid": "ceph-admin"}
        self.bucket_info = {"bucket": "bucket-a", "id": "bucket-instance-1", "owner": "tenant-a$owner"}
        self.users = {"tenant-a$alice", "alice", "tenant-a$owner"}
        self.accounts = {"RGW12345678901234567"}

    def get_user_by_access_key(self, access_key: str, allow_not_found: bool = True):
        self.calls.append(("get_user_by_access_key", {"access_key": access_key, "allow_not_found": allow_not_found}))
        return self.active_identity

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        target = f"{tenant}${uid}" if tenant else uid
        self.calls.append(("get_user", {"uid": uid, "tenant": tenant, "allow_not_found": allow_not_found}))
        return {"uid": target} if target in self.users else None

    def get_account(self, account_id: str, **kwargs):
        self.calls.append(("get_account", {"account_id": account_id, **kwargs}))
        return {"id": account_id} if account_id in self.accounts else None

    def get_bucket_info(self, bucket: str, **kwargs):
        self.calls.append(("get_bucket_info", {"bucket": bucket, **kwargs}))
        return self.bucket_info

    def delete_account_operation(self, account_id: str):
        self.calls.append(("delete_account", {"account_id": account_id}))
        return self.response

    def delete_user_operation(self, uid: str, **kwargs):
        self.calls.append(("delete_user", {"uid": uid, **kwargs}))
        return self.response

    def delete_bucket_operation(self, bucket: str, **kwargs):
        self.calls.append(("delete_bucket", {"bucket": bucket, **kwargs}))
        return self.response

    def unlink_bucket_operation(self, bucket: str, **kwargs):
        self.calls.append(("unlink_bucket", {"bucket": bucket, **kwargs}))
        return self.response

    def link_bucket_operation(self, bucket: str, **kwargs):
        self.calls.append(("link_bucket", {"bucket": bucket, **kwargs}))
        return self.response

    def check_bucket_index_operation(self, bucket: str, **kwargs):
        self.calls.append(("check_bucket_index", {"bucket": bucket, **kwargs}))
        return self.response


def _context(admin: FakeAdmin | None = None):
    audit = FakeAudit()
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=91, name="Lab"),
        rgw_admin=admin or FakeAdmin(),
        access_key="AKIA-LAB",
        actor=SimpleNamespace(id=1, email="admin@example.test", role="ui_superadmin"),
        audit_service=audit,
    )
    return ctx, audit


def _body(response) -> dict:
    return json.loads(response.body.decode())


def test_account_delete_requires_exact_confirmation_and_does_not_audit_phrase():
    ctx, audit = _context()

    with pytest.raises(HTTPException) as raised:
        identity_admin_ops.delete_account(
            "RGW12345678901234567",
            CephAdminAdminOpsConfirmation(confirmation="DELETE ACCOUNT wrong"),
            ctx=ctx,
        )

    assert raised.value.status_code == 400
    assert audit.calls[-1]["status"] == "failed"
    assert "confirmation" not in audit.calls[-1]["metadata"]


def test_user_delete_protects_active_ceph_admin_identity():
    admin = FakeAdmin()
    admin.active_identity = {"uid": "tenant-a$ceph-admin", "tenant": "tenant-a"}
    ctx, audit = _context(admin)

    with pytest.raises(HTTPException) as raised:
        identity_admin_ops.delete_user(
            "ceph-admin",
            CephAdminUserDeleteRequest(confirmation="DELETE USER tenant-a$ceph-admin"),
            tenant="tenant-a",
            ctx=ctx,
        )

    assert raised.value.status_code == 409
    assert not any(name == "delete_user" for name, _ in admin.calls)
    assert audit.calls[-1]["metadata"]["validation"] == "active_service_identity"


def test_user_purge_preserves_rgw_204_audits_and_invalidates(monkeypatch):
    admin = FakeAdmin()
    ctx, audit = _context(admin)
    invalidated: list[int] = []
    monkeypatch.setattr(identity_admin_ops, "invalidate_all_admin_ops_caches", invalidated.append)

    response = identity_admin_ops.delete_user(
        "alice",
        CephAdminUserDeleteRequest(confirmation="PURGE USER tenant-a$alice", purge_data=True),
        tenant="tenant-a",
        ctx=ctx,
    )
    body = _body(response)

    assert response.status_code == 200
    assert body["success"] is True
    assert body["rgw_status_code"] == 204
    assert ("delete_user", {"uid": "alice", "tenant": "tenant-a", "purge_data": True}) in admin.calls
    assert invalidated == [91]
    assert audit.calls[-1]["metadata"]["options"] == {"purge_data": True}
    assert audit.calls[-1]["metadata"]["rgw_status_code"] == 204


def test_bucket_delete_returns_rgw_error_status_and_keeps_cache(monkeypatch):
    admin = FakeAdmin()
    admin.response = _upstream(
        409,
        success=False,
        error_code="BucketNotEmpty",
        message="Bucket contains objects",
        result={"Code": "BucketNotEmpty"},
    )
    ctx, audit = _context(admin)
    invalidated: list[int] = []
    monkeypatch.setattr(bucket_admin_ops, "invalidate_all_admin_ops_caches", invalidated.append)

    response = bucket_admin_ops.delete_bucket(
        "bucket-a",
        CephAdminBucketDeleteRequest(confirmation="DELETE BUCKET tenant-a/bucket-a"),
        tenant="tenant-a",
        ctx=ctx,
    )
    body = _body(response)

    assert response.status_code == 409
    assert body["rgw_error_code"] == "BucketNotEmpty"
    assert body["result"] == {"Code": "BucketNotEmpty"}
    assert invalidated == []
    assert audit.calls[-1]["status"] == "failed"


def test_successful_bucket_delete_cleans_ui_tags(monkeypatch, db_session):
    admin = FakeAdmin()
    ctx, audit = _context(admin)
    invalidated: list[int] = []
    monkeypatch.setattr(bucket_admin_ops, "invalidate_all_admin_ops_caches", invalidated.append)

    response = bucket_admin_ops.delete_bucket(
        "bucket-a",
        CephAdminBucketDeleteRequest(
            confirmation="PURGE AND DELETE BUCKET tenant-a/bucket-a",
            purge_objects=True,
        ),
        tenant="tenant-a",
        ctx=ctx,
        db=db_session,
    )

    assert response.status_code == 200
    assert _body(response)["success"] is True
    assert invalidated == [91]
    assert audit.calls[-1]["status"] == "success"


def test_bucket_delete_requires_purge_before_bypass_gc():
    with pytest.raises(ValidationError, match="bypass_gc requires purge_objects"):
        CephAdminBucketDeleteRequest(
            confirmation="DELETE BUCKET bucket-a",
            purge_objects=False,
            bypass_gc=True,
        )


@pytest.mark.parametrize(
    ("target_type", "target_id"),
    (("user", "tenant-a$alice"), ("account", "RGW12345678901234567")),
)
def test_bucket_link_validates_target_and_forwards_fresh_bucket_id(
    monkeypatch,
    target_type: str,
    target_id: str,
):
    admin = FakeAdmin()
    ctx, audit = _context(admin)
    monkeypatch.setattr(bucket_admin_ops, "invalidate_all_admin_ops_caches", lambda endpoint_id: None)

    response = bucket_admin_ops.link_bucket(
        "bucket-a",
        CephAdminBucketLinkRequest(
            confirmation=f"LINK BUCKET tenant-a/bucket-a TO {target_id}",
            target_type=target_type,
            target_id=target_id,
        ),
        tenant="tenant-a",
        ctx=ctx,
    )

    assert _body(response)["success"] is True
    call = next(details for name, details in admin.calls if name == "link_bucket")
    assert call == {
        "bucket": "bucket-a",
        "tenant": "tenant-a",
        "uid": target_id,
        "bucket_id": "bucket-instance-1",
    }
    assert audit.calls[-1]["metadata"]["old_owner"] == "tenant-a$owner"
    assert audit.calls[-1]["metadata"]["new_owner"] == target_id


def test_bucket_unlink_derives_current_owner(monkeypatch):
    admin = FakeAdmin()
    ctx, _ = _context(admin)
    monkeypatch.setattr(bucket_admin_ops, "invalidate_all_admin_ops_caches", lambda endpoint_id: None)

    response = bucket_admin_ops.unlink_bucket(
        "bucket-a",
        CephAdminAdminOpsConfirmation(confirmation="UNLINK BUCKET tenant-a/bucket-a"),
        tenant="tenant-a",
        ctx=ctx,
    )

    assert _body(response)["success"] is True
    call = next(details for name, details in admin.calls if name == "unlink_bucket")
    assert call["uid"] == "tenant-a$owner"


def test_index_check_is_simple_without_fix_and_requires_phrase_with_fix(monkeypatch):
    admin = FakeAdmin()
    ctx, _ = _context(admin)
    invalidated: list[int] = []
    monkeypatch.setattr(bucket_index_ops, "invalidate_bucket_admin_ops_caches", invalidated.append)

    simple = bucket_index_ops.check_bucket_index(
        "bucket-a",
        CephAdminBucketIndexCheckRequest(),
        tenant="tenant-a",
        ctx=ctx,
    )
    fixed = bucket_index_ops.check_bucket_index(
        "bucket-a",
        CephAdminBucketIndexCheckRequest(
            fix=True,
            check_objects=True,
            confirmation="FIX BUCKET INDEX tenant-a/bucket-a",
        ),
        tenant="tenant-a",
        ctx=ctx,
    )

    assert _body(simple)["success"] is True
    assert _body(fixed)["success"] is True
    calls = [details for name, details in admin.calls if name == "check_bucket_index"]
    assert calls == [
        {"bucket": "bucket-a", "tenant": "tenant-a", "fix": False, "check_objects": False},
        {"bucket": "bucket-a", "tenant": "tenant-a", "fix": True, "check_objects": True},
    ]
    assert invalidated == [91, 91]


def test_index_check_rejects_check_objects_without_fix():
    with pytest.raises(ValidationError, match="check_objects requires fix"):
        CephAdminBucketIndexCheckRequest(check_objects=True)


def test_admin_ops_router_delegates_index_check_routes():
    assert len(effective_routes(admin_ops.router)) == 7
    assert len(identity_admin_ops.router.routes) == 2
    assert len(bucket_admin_ops.router.routes) == 3
    assert len(bucket_index_ops.router.routes) == 2
    assert {
        route.endpoint.__module__
        for route in (
            *identity_admin_ops.router.routes,
            *bucket_admin_ops.router.routes,
            *bucket_index_ops.router.routes,
        )
    } == {
        "app.routers.ceph_admin.identity_admin_ops",
        "app.routers.ceph_admin.bucket_admin_ops",
        "app.routers.ceph_admin.bucket_index_ops",
    }


def test_network_error_returns_structured_502_and_null_rgw_status():
    admin = FakeAdmin()

    def fail(account_id: str):
        raise RGWAdminError("network down secret_key=hidden")

    admin.delete_account_operation = fail
    ctx, audit = _context(admin)

    response = identity_admin_ops.delete_account(
        "RGW12345678901234567",
        CephAdminAdminOpsConfirmation(confirmation="DELETE ACCOUNT RGW12345678901234567"),
        ctx=ctx,
    )
    body = _body(response)

    assert response.status_code == 502
    assert body["rgw_status_code"] is None
    assert "hidden" not in body["message"]
    assert audit.calls[-1]["status"] == "failed"


def test_simple_admin_ops_share_confirmation_openapi_contract():
    paths = app.openapi()["paths"]
    expected_schema = {"$ref": "#/components/schemas/CephAdminAdminOpsConfirmation"}

    account_delete = paths["/api/ceph-admin/endpoints/{endpoint_id}/accounts/{account_id}"]["delete"]
    bucket_unlink = paths["/api/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket}/unlink"]["post"]

    assert account_delete["requestBody"]["content"]["application/json"]["schema"] == expected_schema
    assert bucket_unlink["requestBody"]["content"]["application/json"]["schema"] == expected_schema

    schemas = app.openapi()["components"]["schemas"]
    assert "CephAdminAccountDeleteRequest" not in schemas
    assert "CephAdminBucketUnlinkRequest" not in schemas
