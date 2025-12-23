# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db_models import (
    S3Account,
    S3User,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.main import app
from app.routers import dependencies
from fastapi.testclient import TestClient


def test_super_admin_only_sees_linked_accounts(client: TestClient, db_session):
    super_admin = User(
        email="super@example.com",
        full_name="Super Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.SUPER_ADMIN.value,
    )
    linked_account = S3Account(name="linked", rgw_account_id="RGW-LINKED")
    other_account = S3Account(name="other", rgw_account_id="RGW-OTHER")
    db_session.add_all([super_admin, linked_account, other_account])
    db_session.flush()
    db_session.add(UserS3Account(user_id=super_admin.id, account_id=linked_account.id))

    linked_s3_user = S3User(
        name="linked-s3",
        rgw_user_uid="uid-linked",
        email="linked@example.com",
        rgw_access_key="AKIA-LINKED",
        rgw_secret_key="secret-linked",
    )
    other_s3_user = S3User(
        name="other-s3",
        rgw_user_uid="uid-other",
        email="other@example.com",
        rgw_access_key="AKIA-OTHER",
        rgw_secret_key="secret-other",
    )
    db_session.add_all([linked_s3_user, other_s3_user])
    db_session.flush()
    db_session.add(UserS3User(user_id=super_admin.id, s3_user_id=linked_s3_user.id))
    db_session.commit()

    previous_override = app.dependency_overrides.get(dependencies.get_current_account_admin)
    app.dependency_overrides[dependencies.get_current_account_admin] = lambda: super_admin
    try:
        resp = client.get("/api/manager/accounts")
    finally:
        if previous_override is not None:
            app.dependency_overrides[dependencies.get_current_account_admin] = previous_override
        else:
            app.dependency_overrides.pop(dependencies.get_current_account_admin, None)

    assert resp.status_code == 200, resp.text
    payload = resp.json()

    rgw_accounts = {item["rgw_account_id"] for item in payload if item.get("rgw_account_id")}
    s3_user_uids = {item["rgw_user_uid"] for item in payload if item.get("rgw_user_uid")}

    assert rgw_accounts == {linked_account.rgw_account_id}
    assert s3_user_uids == {linked_s3_user.rgw_user_uid}
