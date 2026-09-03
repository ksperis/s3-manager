# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.services.s3_execution_context import build_ceph_admin_s3_context


def test_build_ceph_admin_s3_context_preserves_endpoint_identity_and_credentials() -> None:
    endpoint = SimpleNamespace(id=7)
    source = SimpleNamespace(
        endpoint=endpoint,
        access_key="AKIA-ADMIN",
        secret_key="SECRET-ADMIN",
    )

    context = build_ceph_admin_s3_context(source)

    assert context.context_id == "ceph-admin-7"
    assert context.context_kind == "ceph_admin"
    assert context.storage_endpoint is endpoint
    assert context.storage_endpoint_id == 7
    assert context.ceph_admin_endpoint_id == 7
    assert context.effective_rgw_credentials() == ("AKIA-ADMIN", "SECRET-ADMIN")
