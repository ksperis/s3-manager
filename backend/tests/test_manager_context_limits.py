# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import User, UserRole
from app.routers.manager import context as context_router
from tests.s3_account_factory import make_s3_account


def _prepare_context(db_session, monkeypatch):
    account = make_s3_account(db_session, name="limits-account", rgw_account_id="RGW-LIMITS")
    actor = User(
        email="limits@example.test",
        hashed_password="x",
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add_all([account, actor])
    db_session.commit()
    monkeypatch.setattr(context_router, "_manager_stats_state", lambda *_args: (False, None, None))
    monkeypatch.setattr(context_router, "is_manager_bucket_quota_available", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(context_router, "is_manager_ceph_s3_user_keys_available", lambda *_args, **_kwargs: False)
    return account, actor


def test_manager_context_keeps_limits_deferred_by_default(db_session, monkeypatch):
    account, actor = _prepare_context(db_session, monkeypatch)
    monkeypatch.setattr(
        context_router,
        "get_s3_accounts_service",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("limits must stay deferred")),
    )

    payload = context_router.get_manager_context(
        account=account,
        actor=actor,
        db=db_session,
        include_limits=False,
    )

    assert payload.quota_max_size_gb is None
    assert payload.max_buckets is None


def test_manager_context_loads_limits_on_explicit_request(db_session, monkeypatch):
    account, actor = _prepare_context(db_session, monkeypatch)
    service = SimpleNamespace(get_account_limits=lambda _account: (10.5, 2_000, 8, 20, 12, 6))
    monkeypatch.setattr(context_router, "get_s3_accounts_service", lambda *_args, **_kwargs: service)

    payload = context_router.get_manager_context(
        account=account,
        actor=actor,
        db=db_session,
        include_limits=True,
    )

    assert payload.quota_max_size_gb == 10.5
    assert payload.quota_max_objects == 2_000
    assert payload.max_buckets == 8
    assert payload.max_users == 20
    assert payload.max_roles == 12
    assert payload.max_groups == 6
