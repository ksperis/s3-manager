# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import (
    ManagerAccountRole, PortalAccountRole,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
    UserUiGroup,
)
from app.main import app
from app.models.app_settings import AppSettings
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers import dependencies
from app.routers.dependencies_internal.feature_gates import (
    require_browser_enabled,
    require_browser_workspace_surface,
)
from app.routers.manager import context as manager_context_router
from app.services import app_settings_service
from tests.s3_account_factory import make_s3_account


def _request(path: str, *, workspace: str = "manager-browser", method: str = "GET"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-S3-Workspace": workspace},
        method=method,
    )


def _enabled_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.browser_enabled = True
    settings.general.manager_enabled = True
    settings.general.browser_manager_enabled = True
    return settings


def _user(email: str) -> User:
    return User(
        email=email,
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def test_account_requires_admin_and_permission_on_same_direct_link(db_session):
    user = _user("manager-browser-account@example.test")
    account = make_s3_account(
        db_session,
        name="manager-browser-account",
        rgw_account_id="RGWMANAGERBROWSER01",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add_all([user, account])
    db_session.commit()
    link = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
        allow_manager_browser_data_access=True,
    )
    db_session.add(link)
    db_session.commit()

    context = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=str(account.id),
        actor=user,
        db=db_session,
    )
    assert context.effective_rgw_credentials() == ("ROOT-AK", "ROOT-SK")

    link.allow_manager_browser_data_access = False
    db_session.add(link)
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets"),
            account_ref=str(account.id),
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403


def test_account_permissions_cannot_escalate_by_combining_links(db_session):
    user = _user("manager-browser-no-cumulative-escalation@example.test")
    group = UiGroup(name="Manager Browser partial grant")
    account = make_s3_account(
        db_session,
        name="manager-browser-no-cumulative-account",
        rgw_account_id="RGWMANAGERBROWSER02",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add_all([user, group, account])
    db_session.commit()
    group_account_link = UiGroupS3Account(
        group_id=group.id,
        account_id=account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_USER.value,
        allow_manager_browser_data_access=False,
    )
    db_session.add_all(
        [
            UserUiGroup(user_id=user.id, group_id=group.id),
            UserS3Account(
                user_id=user.id,
                account_id=account.id,
                manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
                portal_role=None,
                allow_manager_browser_data_access=False,
            ),
            group_account_link,
        ]
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets/demo/objects"),
            account_ref=str(account.id),
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403
    assert "same association" in str(exc.value.detail)

    group_account_link.manager_role = ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
    group_account_link.allow_manager_browser_data_access = True
    db_session.add(group_account_link)
    db_session.commit()
    context = dependencies.get_account_context(
        request=_request("/api/browser/buckets/demo/objects"),
        account_ref=str(account.id),
        actor=user,
        db=db_session,
    )
    assert context.effective_rgw_credentials() == ("ROOT-AK", "ROOT-SK")


def test_rgw_user_permission_aggregates_direct_and_group_and_revokes(db_session):
    user = _user("manager-browser-rgw@example.test")
    group = UiGroup(name="Manager Browser RGW group")
    s3_user = S3User(
        name="shared-rgw-user",
        rgw_user_uid="shared-rgw-user",
        rgw_access_key="RGW-AK",
        rgw_secret_key="RGW-SK",
        storage_endpoint_id=1,
    )
    db_session.add_all([user, group, s3_user])
    db_session.commit()
    direct = UserS3User(
        user_id=user.id,
        s3_user_id=s3_user.id,
        allow_manager_browser_data_access=False,
    )
    group_link = UiGroupS3User(
        group_id=group.id,
        s3_user_id=s3_user.id,
        allow_manager_browser_data_access=True,
    )
    db_session.add_all(
        [UserUiGroup(user_id=user.id, group_id=group.id), direct, group_link]
    )
    db_session.commit()

    context = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=f"s3u-{s3_user.id}",
        actor=user,
        db=db_session,
    )
    assert context.effective_rgw_credentials() == ("RGW-AK", "RGW-SK")

    group_link.allow_manager_browser_data_access = False
    db_session.add(group_link)
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets"),
            account_ref=f"s3u-{s3_user.id}",
            actor=user,
            db=db_session,
        )
    assert exc.value.status_code == 403


def test_private_connection_requires_both_flags_and_shared_is_always_denied(db_session):
    user = _user("manager-browser-connection@example.test")
    private = S3Connection(
        created_by=user,
        name="manager-browser-private",
        access_manager=True,
        access_browser=True,
        access_key_id="PRIVATE-AK",
        secret_access_key="PRIVATE-SK",
        custom_endpoint_config=json.dumps(
            {
                "endpoint_url": "https://93.184.216.34/private",
                "region": None,
                "force_path_style": False,
                "verify_tls": True,
                "provider": None,
            }
        ),
    )
    shared = S3Connection(
        created_by=user,
        name="manager-browser-shared",
        is_shared=True,
        access_manager=True,
        access_browser=True,
        access_key_id="SHARED-AK",
        secret_access_key="SHARED-SK",
        custom_endpoint_config=json.dumps(
            {
                "endpoint_url": "https://shared.example.test",
                "region": None,
                "force_path_style": False,
                "verify_tls": True,
                "provider": None,
            }
        ),
    )
    db_session.add_all([user, private, shared])
    db_session.commit()

    context = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=f"conn-{private.id}",
        actor=user,
        db=db_session,
    )
    assert context.effective_rgw_credentials() == ("PRIVATE-AK", "PRIVATE-SK")

    private.access_browser = False
    db_session.add(private)
    db_session.commit()
    for connection in (private, shared):
        with pytest.raises(HTTPException) as exc:
            dependencies.get_account_context(
                request=_request("/api/browser/buckets"),
                account_ref=f"conn-{connection.id}",
                actor=user,
                db=db_session,
            )
        assert exc.value.status_code == 403


def test_direct_s3_session_uses_its_credentials_and_browser_capability(db_session):
    account = make_s3_account(
        db_session,
        name="manager-browser-session-account",
        rgw_account_id="RGWMANAGERBROWSERSESSION",
    )
    db_session.add(account)
    db_session.commit()
    actor = ManagerSessionPrincipal(
        session_id="manager-browser-session",
        access_key="SESSION-AK",
        secret_key="SESSION-SK",
        actor_type="s3",
        account_id=account.rgw_account_id,
        account_name=account.name,
        user_uid="session-user",
        capabilities=SessionCapabilities(access_browser=True),
    )

    context = dependencies.get_account_context(
        request=_request("/api/browser/buckets"),
        account_ref=str(account.id),
        actor=actor,
        db=db_session,
    )
    assert context.effective_rgw_credentials() == ("SESSION-AK", "SESSION-SK")

    actor.capabilities.access_browser = False
    with pytest.raises(HTTPException) as exc:
        dependencies.get_account_context(
            request=_request("/api/browser/buckets"),
            account_ref=str(account.id),
            actor=actor,
            db=db_session,
        )
    assert exc.value.status_code == 403


def test_manager_context_and_surface_gate_use_same_explicit_permission(db_session, monkeypatch):
    settings = _enabled_settings()
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    monkeypatch.setattr(manager_context_router, "load_app_settings", lambda: settings)
    user = _user("manager-browser-context@example.test")
    account = make_s3_account(
        db_session,
        name="manager-browser-context-account",
        rgw_account_id="RGWMANAGERBROWSER03",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add_all([user, account])
    db_session.commit()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
            allow_manager_browser_data_access=True,
        )
    )
    db_session.commit()
    manager_account = dependencies.get_account_context(
        request=SimpleNamespace(
            url=SimpleNamespace(path="/api/manager/context"), headers={}, method="GET"
        ),
        account_ref=str(account.id),
        actor=user,
        db=db_session,
    )
    payload = manager_context_router.get_manager_context(
        account=manager_account,
        actor=user,
        db=db_session,
    )
    assert payload.manager_browser_enabled is True
    assert payload.manager_browser_message is None
    require_browser_workspace_surface(_request("/api/browser/buckets"))

    settings.general.browser_manager_enabled = False
    with pytest.raises(HTTPException) as exc:
        require_browser_workspace_surface(_request("/api/browser/buckets"))
    assert exc.value.status_code == 403

    settings.general.browser_manager_enabled = True
    settings.general.manager_enabled = False
    with pytest.raises(HTTPException) as exc:
        require_browser_workspace_surface(_request("/api/browser/buckets"))
    assert exc.value.status_code == 403

    settings.general.manager_enabled = True
    settings.general.browser_enabled = False
    with pytest.raises(HTTPException) as exc:
        require_browser_enabled()
    assert exc.value.status_code == 403


def test_forged_browser_read_and_mutation_are_rejected_before_data_plane(
    client,
    db_session,
    monkeypatch,
):
    settings = _enabled_settings()
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    user = _user("manager-browser-forged-route@example.test")
    account = make_s3_account(
        db_session,
        name="manager-browser-forged-route-account",
        rgw_account_id="RGWMANAGERBROWSER04",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add_all([user, account])
    db_session.commit()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
            allow_manager_browser_data_access=False,
        )
    )
    db_session.commit()
    app.dependency_overrides[dependencies.get_current_actor] = lambda: user
    try:
        headers = {"X-S3-Workspace": "manager-browser"}
        read_response = client.get(
            f"/api/browser/buckets/demo/objects?account_id={account.id}",
            headers=headers,
        )
        mutation_response = client.post(
            f"/api/browser/buckets/demo/delete?account_id={account.id}",
            headers=headers,
            json={"objects": [{"key": "forged.txt"}]},
        )
        assert read_response.status_code == 403
        assert mutation_response.status_code == 403
    finally:
        app.dependency_overrides.pop(dependencies.get_current_actor, None)
