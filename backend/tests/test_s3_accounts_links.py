# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import AccountRole, S3Account, StorageEndpoint, StorageProvider, User, UserRole, UserS3Account
from app.services.s3_accounts_service import S3AccountsService


def test_list_accounts_exposes_user_email_in_user_links(db_session):
    endpoint = StorageEndpoint(
        name="ceph-links",
        endpoint_url="https://ceph-links.example.test",
        provider=StorageProvider.CEPH.value,
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()

    account = S3Account(
        name="Account A",
        rgw_account_id="RGW00000000000000001",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()

    user = User(
        email="alice@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.flush()

    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            is_root=False,
            account_role=AccountRole.PORTAL_MANAGER.value,
            account_admin=True,
        )
    )
    db_session.commit()

    service = S3AccountsService(db_session, allow_missing_admin=True)
    accounts = service.list_accounts(
        include_usage_stats=False,
        include_quota=False,
        include_rgw_details=False,
    )

    target = next((item for item in accounts if item.db_id == account.id), None)
    assert target is not None
    assert target.user_links is not None and len(target.user_links) == 1
    assert target.user_links[0].user_id == user.id
    assert target.user_links[0].user_email == "alice@example.test"
