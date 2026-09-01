# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.users_service import UsersService
from app.db import ManagerAccountRole, S3Account, User, UserS3Account, UserRole
from tests.s3_account_factory import make_s3_account


def test_assign_user_to_account_creates_manager_link(db_session):
    # Seed account and user
    account = (
        db_session.query(S3Account)
        .filter(S3Account.rgw_account_id == "RGW00000000000000001")
        .first()
    )
    if not account:
        account = make_s3_account(db_session, name="acc", rgw_account_id="RGW00000000000000001")
        db_session.add(account)
        db_session.flush()
    user = User(
        email="u@example.com",
        full_name="U",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()

    svc = UsersService(db_session)
    updated = svc.assign_user_to_account(
        user.id,
        account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
    )

    link = db_session.query(UserS3Account).filter_by(user_id=user.id, account_id=account.id).first()
    assert link is not None
    assert link.manager_role == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
    assert link.portal_role is None
    assert {link.account_id for link in updated.account_links} == {account.id}
