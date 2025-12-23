# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.services.users_service import UsersService
from app.db_models import S3Account, User, UserS3Account, UserRole


class FakeRGWAdmin:
    def __init__(self):
        self.calls = []

    def provision_user_keys(self, user_email: str, account_id: str, account_root: bool = False, tenant=None):
        self.calls.append((user_email, account_id, account_root))
        return "AK", "SK"


def test_assign_user_to_account_creates_link_and_root(db_session):
    # Seed account and user
    account = (
        db_session.query(S3Account)
        .filter(S3Account.rgw_account_id == "RGW00000000000000001")
        .first()
    )
    if not account:
        account = S3Account(name="acc", rgw_account_id="RGW00000000000000001")
        db_session.add(account)
        db_session.flush()
    user = User(
        email="u@example.com",
        full_name="U",
        hashed_password="x",
        is_active=True,
        role=UserRole.ACCOUNT_ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()

    svc = UsersService(db_session)
    updated = svc.assign_user_to_account(user.id, account.id, account_root=True)

    link = db_session.query(UserS3Account).filter_by(user_id=user.id, account_id=account.id).first()
    assert link is not None
    assert link.is_root is False
    assert {link.account_id for link in updated.account_links} == {account.id}
