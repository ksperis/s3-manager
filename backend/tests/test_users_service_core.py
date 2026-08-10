# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.security import get_password_hash
from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
)
from app.models.admin_automation import UiUserSpec
from app.models.user import PASSWORD_POLICY_ERROR, S3UserMembership, UserCreate, UserUpdate
from app.services.users_service import UsersService
from tests.s3_account_factory import make_s3_account


def _seed_account(db_session, name: str, rgw_id: str) -> S3Account:
    account = make_s3_account(
        db_session,
        name=name,
        rgw_account_id=rgw_id,
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_user(db_session, email: str, role: str = UserRole.UI_USER.value, password: str = "supersecret1234") -> User:
    user = User(
        email=email,
        full_name=email.split("@")[0],
        hashed_password=get_password_hash(password),
        is_active=True,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _seed_s3_user(db_session, name: str) -> S3User:
    endpoint = db_session.query(StorageEndpoint).order_by(StorageEndpoint.id.asc()).first()
    if endpoint is None:
        endpoint = StorageEndpoint(
            name="users-service-ceph",
            endpoint_url="https://users-service-ceph.example.test",
            provider=StorageProvider.CEPH.value,
            is_default=True,
        )
        db_session.add(endpoint)
        db_session.flush()
    entry = S3User(
        name=name,
        rgw_user_uid=f"{name}-uid",
        rgw_access_key=f"{name}-AK",
        rgw_secret_key=f"{name}-SK",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(entry)
    db_session.commit()
    db_session.refresh(entry)
    return entry


def _seed_connection(db_session, *, created_by_user_id: int, name: str, is_shared: bool) -> S3Connection:
    entry = S3Connection(
        created_by_user_id=created_by_user_id,
        name=name,
        is_shared=is_shared,
        access_key_id=f"AK-{name}",
        secret_access_key=f"SK-{name}",
    )
    db_session.add(entry)
    db_session.commit()
    db_session.refresh(entry)
    return entry


def test_create_super_admin_create_user_and_authenticate(db_session):
    service = UsersService(db_session)

    admin = service.create_super_admin(
        UserCreate(
            email="superadmin@example.com",
            password="verylongpass123",
            full_name="Super Admin",
        )
    )
    assert admin.role == UserRole.UI_SUPERADMIN.value
    assert admin.can_access_ceph_admin is False
    assert admin.can_access_storage_ops is False
    assert admin.can_access_manager_bucket_compare is False
    assert admin.can_access_manager_bucket_integrity_check is False
    assert admin.can_access_manager_bucket_migration is False
    assert admin.can_access_manager_feature_rules is False
    assert admin.can_create_manual_private_connections is False
    assert admin.can_provision_managed_private_connections is False

    with pytest.raises(ValueError, match="User already exists"):
        service.create_super_admin(
            UserCreate(email="superadmin@example.com", password="verylongpass123", full_name="Duplicate")
        )

    with pytest.raises(ValueError, match=PASSWORD_POLICY_ERROR):
        service.create_user(UserCreate(email="short@example.com", password="short", full_name="Short"))

    with pytest.raises(ValidationError):
        UserCreate(
            email="invalid-role@example.com",
            password="verylongpass123",
            full_name="Invalid",
            role="bad-role",  # type: ignore[arg-type]
        )

    with pytest.raises(ValidationError):
        UserUpdate(role="admin")  # type: ignore[arg-type]

    with pytest.raises(ValidationError):
        UiUserSpec(role="user")  # type: ignore[arg-type]

    created = service.create_user(
        UserCreate(
            email="ui-admin@example.com",
            password="verylongpass123",
            full_name="UI Admin",
            role=UserRole.UI_ADMIN.value,
            can_access_ceph_admin=True,
            can_access_storage_ops=True,
            can_create_manual_private_connections=True,
            can_provision_managed_private_connections=True,
            manager_tool_access={
                "bucket_compare": True,
                "bucket_integrity_check": True,
                "bucket_migration": True,
                "feature_rules": True,
            },
        )
    )
    assert created.role == UserRole.UI_ADMIN.value
    assert created.can_access_ceph_admin is True
    assert created.can_access_storage_ops is True
    assert created.can_access_manager_bucket_compare is True
    assert created.can_access_manager_bucket_integrity_check is True
    assert created.can_access_manager_bucket_migration is True
    assert created.can_access_manager_feature_rules is True
    assert created.can_create_manual_private_connections is True
    assert created.can_provision_managed_private_connections is True

    assert service.authenticate("ui-admin@example.com", "wrong-password") is None
    authenticated = service.authenticate("ui-admin@example.com", "verylongpass123")
    assert authenticated is not None
    assert authenticated.last_login_at is not None


def test_update_user_and_link_validations(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "update-me@example.com", role=UserRole.UI_ADMIN.value)
    user.quota_alerts_global_watch = True
    db_session.add(user)
    db_session.commit()
    _seed_user(db_session, "already-used@example.com", role=UserRole.UI_USER.value)
    s3_user = _seed_s3_user(db_session, "linked-user")
    shared_conn = _seed_connection(db_session, created_by_user_id=user.id, name="shared-conn", is_shared=True)
    private_conn = _seed_connection(db_session, created_by_user_id=user.id, name="private-conn", is_shared=False)

    with pytest.raises(ValueError, match="Email already in use"):
        service.update_user(user.id, UserUpdate(email="already-used@example.com"))

    with pytest.raises(ValueError, match="S3 users not found"):
        service.update_user(
            user.id,
            UserUpdate(s3_user_links=[S3UserMembership(s3_user_id=99999)]),
        )

    with pytest.raises(ValueError, match="Only shared S3 connections can be linked"):
        service.update_user(user.id, UserUpdate(s3_connection_ids=[private_conn.id]))

    updated = service.update_user(
        user.id,
        UserUpdate(
            email="updated@example.com",
            password="anotherlongpass123",
            role=UserRole.UI_USER.value,
            is_active=False,
            is_root=True,
            can_access_ceph_admin=True,
            can_access_storage_ops=True,
            can_create_manual_private_connections=True,
            can_provision_managed_private_connections=True,
            manager_tool_access={
                "bucket_compare": True,
                "bucket_integrity_check": False,
                "bucket_migration": True,
                "feature_rules": True,
            },
            s3_user_links=[S3UserMembership(s3_user_id=s3_user.id)],
            s3_connection_ids=[shared_conn.id],
        ),
    )
    assert updated.email == "updated@example.com"
    assert updated.role == UserRole.UI_USER.value
    # Non-admin roles cannot keep ceph-admin access.
    assert updated.can_access_ceph_admin is False
    assert updated.can_access_storage_ops is True
    assert updated.can_access_manager_bucket_compare is True
    assert updated.can_access_manager_bucket_integrity_check is False
    assert updated.can_access_manager_bucket_migration is True
    assert updated.can_access_manager_feature_rules is True
    assert updated.can_create_manual_private_connections is True
    assert updated.can_provision_managed_private_connections is True
    assert updated.quota_alerts_global_watch is False
    assert updated.is_active is False
    assert updated.is_root is True


def test_update_user_replaces_direct_account_links_and_preserves_root_links(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "account-links@example.com", role=UserRole.UI_NONE.value)
    removed_account = _seed_account(db_session, "removed-account", "RGW-REMOVED")
    root_account = _seed_account(db_session, "root-account", "RGW-ROOT")
    added_account = _seed_account(db_session, "added-account", "RGW-ADDED")
    db_session.add_all(
        [
            UserS3Account(
                user_id=user.id,
                account_id=removed_account.id,
                is_root=False,
                role=AccountRole.PORTAL_USER.value,
            ),
            UserS3Account(
                user_id=user.id,
                account_id=root_account.id,
                is_root=True,
                role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
            ),
        ]
    )
    db_session.commit()

    updated = service.update_user(
        user.id,
        UserUpdate(
            account_links=[
                {
                    "account_id": added_account.id,
                    "role": AccountRole.ACCOUNT_ADMINISTRATOR.value,
                },
                {
                    "account_id": root_account.id,
                    "role": AccountRole.PORTAL_USER.value,
                    "allow_manager_browser_data_access": True,
                },
            ]
        ),
    )

    links = (
        db_session.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id)
        .order_by(UserS3Account.account_id)
        .all()
    )
    assert updated.role == UserRole.UI_USER.value
    assert {link.account_id for link in links} == {root_account.id, added_account.id}
    root_link = next(link for link in links if link.account_id == root_account.id)
    assert root_link.is_root is True
    assert root_link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value
    assert root_link.allow_manager_browser_data_access is True
    added_link = next(link for link in links if link.account_id == added_account.id)
    assert added_link.is_root is False
    assert added_link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value

    with pytest.raises(ValueError, match="S3 accounts not found: 99999"):
        service.update_user(
            user.id,
            UserUpdate(
                account_links=[
                    {
                        "account_id": 99999,
                        "role": AccountRole.PORTAL_USER.value,
                    }
                ]
            ),
        )


def test_update_user_clears_manager_tools_for_no_access_role(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "manager-tools-clear@example.com", role=UserRole.UI_ADMIN.value)

    updated = service.update_user(
        user.id,
        UserUpdate(
            role=UserRole.UI_NONE.value,
            can_create_manual_private_connections=True,
            can_provision_managed_private_connections=True,
            manager_tool_access={
                "bucket_compare": True,
                "bucket_integrity_check": True,
                "bucket_migration": True,
                "feature_rules": True,
            },
        ),
    )

    assert updated.role == UserRole.UI_NONE.value
    assert updated.can_access_manager_bucket_compare is False
    assert updated.can_access_manager_bucket_integrity_check is False
    assert updated.can_access_manager_bucket_migration is False
    assert updated.can_access_manager_feature_rules is False
    assert updated.can_create_manual_private_connections is False
    assert updated.can_provision_managed_private_connections is False


def test_update_user_allows_storage_ops_for_admin_like_role(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "storage-ops-admin@example.com", role=UserRole.UI_USER.value)

    updated = service.update_user(
        user.id,
        UserUpdate(
            role=UserRole.UI_ADMIN.value,
            can_access_storage_ops=True,
        ),
    )

    assert updated.role == UserRole.UI_ADMIN.value
    assert updated.can_access_storage_ops is True


def test_update_current_user_password_paths(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "profile@example.com", role=UserRole.UI_USER.value, password="initialpass123")

    with pytest.raises(ValueError, match="Both current_password and new_password are required"):
        service.update_current_user(user, current_password="initialpass123", new_password=None)

    user.hashed_password = None
    db_session.add(user)
    db_session.commit()
    with pytest.raises(ValueError, match="unavailable"):
        service.update_current_user(user, current_password="x", new_password="nextpass12345")

    user.hashed_password = get_password_hash("initialpass123")
    db_session.add(user)
    db_session.commit()
    with pytest.raises(ValueError, match="incorrect"):
        service.update_current_user(user, current_password="bad", new_password="nextpass12345")

    updated = service.update_current_user(
        user,
        full_name=" Profile Name ",
        ui_language="fr",
        update_ui_language=True,
        current_password="initialpass123",
        new_password="nextpass12345",
    )
    assert updated.full_name == "Profile Name"
    assert updated.display_name == "Profile Name"
    assert updated.ui_language == "fr"


def test_paginate_users_and_detached_user_to_out(db_session, monkeypatch):
    service = UsersService(db_session)
    account = _seed_account(db_session, "acc-a", "RGW-ACC-A")
    user = _seed_user(db_session, "paged@example.com", role=UserRole.UI_USER.value)
    s3_user = _seed_s3_user(db_session, "paged-s3-user")
    shared_conn = _seed_connection(db_session, created_by_user_id=user.id, name="paged-shared-conn", is_shared=True)
    owned_conn = _seed_connection(db_session, created_by_user_id=user.id, name="paged-owned-conn", is_shared=False)

    service.assign_user_to_account(
        user.id,
        account.id,
        account_root=False,
        role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
    )
    service._set_s3_user_links(user, [S3UserMembership(s3_user_id=s3_user.id)])
    service._set_s3_connection_links(user, [shared_conn.id])
    db_session.commit()

    rows, total = service.paginate_users(
        page=1,
        page_size=10,
        search="paged",
        sort_field="last_login",
        sort_direction="desc",
    )
    assert total >= 1
    target = next(item for item in rows if item.id == user.id)
    assert target.s3_user_details and target.s3_user_details[0].name == "paged-s3-user"
    assert target.s3_connection_details and target.s3_connection_details[0].name == "paged-shared-conn"

    # Detached instance fallback branch in user_to_out.
    db_session.expunge(user)
    out = service.user_to_out(user)
    assert out.id > 0
    connection_ids = {connection.id for connection in out.s3_connection_details}
    assert owned_conn.id in connection_ids or shared_conn.id in connection_ids


def test_admin_user_projection_and_search_hide_private_connection_links(db_session):
    service = UsersService(db_session)
    user = _seed_user(db_session, "private-link-owner@example.com")
    private_connection = _seed_connection(
        db_session,
        created_by_user_id=user.id,
        name="private-connection-secret-name",
        is_shared=False,
    )
    db_session.add(
        UserS3Connection(
            user_id=user.id,
            s3_connection_id=private_connection.id,
        )
    )
    db_session.commit()

    projected = service.user_to_out(user)
    assert projected.s3_connection_details == []

    rows, total = service.paginate_users(
        page=1,
        page_size=25,
        search="private-connection-secret-name",
    )
    assert rows == []
    assert total == 0


def test_assign_user_to_account_paths_and_list_users_minimal(db_session):
    service = UsersService(db_session)
    account = _seed_account(db_session, "acc-b", "RGW-ACC-B")
    user = _seed_user(db_session, "assign@example.com", role=UserRole.UI_NONE.value)

    with pytest.raises(ValueError, match="User not found"):
        service.assign_user_to_account(99999, account.id)
    with pytest.raises(ValueError, match="S3Account not found"):
        service.assign_user_to_account(user.id, 99999)

    updated = service.assign_user_to_account(
        user.id,
        account.id,
        account_root=True,
        role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
    )
    assert updated.role == UserRole.UI_USER.value
    link = db_session.query(UserS3Account).filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id).first()
    assert link is not None and link.is_root is True
    assert link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value

    service.assign_user_to_account(
        user.id,
        account.id,
        role=AccountRole.PORTAL_USER.value,
    )
    db_session.refresh(link)
    assert link.is_root is True
    assert link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value

    minimal = service.list_users_minimal()
    assert any(entry.email == "assign@example.com" for entry in minimal)
