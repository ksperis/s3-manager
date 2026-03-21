# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.core.security import get_password_hash
from app.db import (
    S3Account,
    S3Connection,
    S3User,
    User,
    UserRole,
    UserS3Account,
)
from app.models.user import PASSWORD_POLICY_ERROR, UserCreate, UserUpdate
from app.services.users_service import UsersService


def _seed_account(db_session, name: str, rgw_id: str) -> S3Account:
    account = S3Account(
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
    entry = S3User(
        name=name,
        rgw_user_uid=f"{name}-uid",
        rgw_access_key=f"{name}-AK",
        rgw_secret_key=f"{name}-SK",
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

    with pytest.raises(ValueError, match="User already exists"):
        service.create_super_admin(
            UserCreate(email="superadmin@example.com", password="verylongpass123", full_name="Duplicate")
        )

    with pytest.raises(ValueError, match=PASSWORD_POLICY_ERROR):
        service.create_user(UserCreate(email="short@example.com", password="short", full_name="Short"))

    with pytest.raises(ValueError, match="Invalid role"):
        service.create_user(
            UserCreate(email="invalid-role@example.com", password="verylongpass123", full_name="Invalid", role="bad-role")
        )

    created = service.create_user(
        UserCreate(
            email="ui-admin@example.com",
            password="verylongpass123",
            full_name="UI Admin",
            role=UserRole.UI_ADMIN.value,
            can_access_ceph_admin=True,
            can_access_storage_ops=True,
        )
    )
    assert created.role == UserRole.UI_ADMIN.value
    assert created.can_access_ceph_admin is True
    assert created.can_access_storage_ops is True

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
        service.update_user(user.id, UserUpdate(s3_user_ids=[99999]))

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
            s3_user_ids=[s3_user.id],
            s3_connection_ids=[shared_conn.id],
        ),
    )
    assert updated.email == "updated@example.com"
    assert updated.role == UserRole.UI_USER.value
    # Non-admin roles cannot keep ceph-admin access.
    assert updated.can_access_ceph_admin is False
    assert updated.can_access_storage_ops is True
    assert updated.quota_alerts_global_watch is False
    assert updated.is_active is False
    assert updated.is_root is True


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
        account_admin=True,
    )
    service._set_s3_user_links(user, [s3_user.id])
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
    assert owned_conn.id in out.s3_connections or shared_conn.id in out.s3_connections


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
        account_admin=True,
    )
    assert updated.role == UserRole.UI_USER.value
    link = db_session.query(UserS3Account).filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id).first()
    assert link is not None and link.is_root is True and link.account_admin is True

    minimal = service.list_users_minimal()
    assert any(entry.email == "assign@example.com" for entry in minimal)
