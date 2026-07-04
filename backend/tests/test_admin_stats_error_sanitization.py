# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.db import S3Account, S3User, StorageEndpoint
from app.routers.admin import stats as admin_stats_router
from app.services.rgw_admin import RGWAdminError


def _ceph_endpoint(name: str) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config=(
            "features:\n"
            "  metrics:\n"
            "    enabled: true\n"
            "  usage:\n"
            "    enabled: true\n"
        ),
    )


class _LeakyRGWClient:
    def get_all_buckets(self, **kwargs):
        raise RGWAdminError(
            "RGW admin error 403 from https://rgw.internal.local/admin?X-Amz-Signature=abcdef "
            "with access_key=AKIAIOSFODNN7EXAMPLE and secret_key=top-secret"
        )


def _assert_sanitized_bucket_error(exc: HTTPException) -> None:
    detail = str(exc.detail)
    assert exc.status_code == 502
    assert detail.startswith("Unable to fetch buckets:")
    assert "<redacted-url>" in detail
    assert "access_key=<redacted>" in detail
    assert "secret_key=<redacted>" in detail
    assert "rgw.internal.local" not in detail
    assert "AKIAIOSFODNN7EXAMPLE" not in detail
    assert "top-secret" not in detail


def test_admin_account_stats_sanitizes_rgw_error_details(db_session, monkeypatch):
    endpoint = _ceph_endpoint("admin-stats-account")
    account = S3Account(name="admin-stats-account", rgw_account_id="rgw-account", storage_endpoint=endpoint)
    db_session.add_all([endpoint, account])
    db_session.commit()

    monkeypatch.setattr(admin_stats_router, "_build_rgw_client", lambda endpoint: _LeakyRGWClient())

    with pytest.raises(HTTPException) as exc:
        admin_stats_router.account_stats(_={}, db=db_session, account_id=account.id)

    _assert_sanitized_bucket_error(exc.value)


def test_admin_s3_user_stats_sanitizes_rgw_error_details(db_session, monkeypatch):
    endpoint = _ceph_endpoint("admin-stats-user")
    s3_user = S3User(
        name="admin-stats-user",
        rgw_user_uid="rgw-user",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint=endpoint,
    )
    db_session.add_all([endpoint, s3_user])
    db_session.commit()

    monkeypatch.setattr(admin_stats_router, "_build_rgw_client", lambda endpoint: _LeakyRGWClient())

    with pytest.raises(HTTPException) as exc:
        admin_stats_router.s3_user_stats(_={}, db=db_session, user_id=s3_user.id)

    _assert_sanitized_bucket_error(exc.value)
