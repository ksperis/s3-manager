# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import date

from app.db import (
    ApiToken,
    AccountIAMUser,
    AuditLog,
    BillingAssignment,
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    RefreshSession,
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
from app.services.s3_accounts_service import S3AccountsService
from app.services.users_service import UsersService


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="delete-int",
        endpoint_url="https://delete-int.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_delete_user_cleans_owned_connections_tokens_and_sessions(db_session):
    owner = User(email="owner-delete@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    other = User(email="other-delete@example.com", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(owner)
    db_session.add(other)
    db_session.flush()

    owned_connection = S3Connection(
        owner_user_id=owner.id,
        name="owned-private",
        is_public=False,
        access_key_id="AKIA-OWNED",
        secret_access_key="SECRET-OWNED",
    )
    shared_connection = S3Connection(
        owner_user_id=other.id,
        name="other-private",
        is_public=False,
        access_key_id="AKIA-OTHER",
        secret_access_key="SECRET-OTHER",
    )
    db_session.add(owned_connection)
    db_session.add(shared_connection)
    db_session.flush()
    owned_connection_id = owned_connection.id

    db_session.add(UserS3Connection(user_id=owner.id, s3_connection_id=shared_connection.id))
    db_session.add(UserS3Connection(user_id=other.id, s3_connection_id=owned_connection.id))

    own_token = ApiToken(
        id="tok-own",
        jti="jti-own",
        token_hash="hash-own",
        user_id=owner.id,
        name="own-token",
        expires_at=date(2099, 1, 1),
    )
    revoked_by_owner = ApiToken(
        id="tok-other",
        jti="jti-other",
        token_hash="hash-other",
        user_id=other.id,
        revoked_by_user_id=owner.id,
        name="other-token",
        expires_at=date(2099, 1, 1),
    )
    db_session.add(own_token)
    db_session.add(revoked_by_owner)

    own_refresh = RefreshSession(
        id="ref-own",
        token_hash="ref-hash-own",
        user_id=owner.id,
        auth_type="ui",
        expires_at=date(2099, 1, 1),
    )
    revoked_refresh = RefreshSession(
        id="ref-other",
        token_hash="ref-hash-other",
        user_id=other.id,
        revoked_by_user_id=owner.id,
        auth_type="ui",
        expires_at=date(2099, 1, 1),
    )
    db_session.add(own_refresh)
    db_session.add(revoked_refresh)

    db_session.commit()

    UsersService(db_session).delete_user(owner.id)

    assert db_session.query(User).filter(User.id == owner.id).first() is None
    assert db_session.query(S3Connection).filter(S3Connection.id == owned_connection_id).first() is None
    assert db_session.query(UserS3Connection).filter(UserS3Connection.user_id == owner.id).first() is None
    assert (
        db_session.query(UserS3Connection)
        .filter(UserS3Connection.s3_connection_id == owned_connection_id)
        .first()
        is None
    )
    assert db_session.query(ApiToken).filter(ApiToken.id == "tok-own").first() is None
    assert db_session.query(RefreshSession).filter(RefreshSession.id == "ref-own").first() is None
    token = db_session.query(ApiToken).filter(ApiToken.id == "tok-other").first()
    refresh = db_session.query(RefreshSession).filter(RefreshSession.id == "ref-other").first()
    assert token is not None and token.revoked_by_user_id is None
    assert refresh is not None and refresh.revoked_by_user_id is None


def test_unlink_account_cleans_links_and_nulls_references(db_session):
    endpoint = _seed_endpoint(db_session)
    account = S3Account(name="to-unlink", storage_endpoint_id=endpoint.id)
    user = User(email="acc-user@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    s3_user = S3User(
        name="billing-user",
        rgw_user_uid="billing-user",
        rgw_access_key="AKIA-BILL",
        rgw_secret_key="SECRET-BILL",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.add(user)
    db_session.add(s3_user)
    db_session.flush()

    db_session.add(UserS3Account(user_id=user.id, account_id=account.id))
    db_session.add(AccountIAMUser(user_id=user.id, account_id=account.id, iam_user_id="iam-1"))
    db_session.add(AuditLog(user_email=user.email, user_role=user.role, scope="admin", action="x", account_id=account.id))
    rate_card = BillingRateCard(
        name="rc-1",
        currency="EUR",
        effective_from=date(2026, 1, 1),
    )
    db_session.add(rate_card)
    db_session.flush()
    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            s3_user_id=s3_user.id,
            rate_card_id=rate_card.id,
        )
    )
    db_session.add(
        BillingUsageDaily(
            day=date(2026, 1, 1),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            s3_user_id=s3_user.id,
            source="rgw_admin_usage",
        )
    )
    db_session.add(
        BillingStorageDaily(
            day=date(2026, 1, 1),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            s3_user_id=s3_user.id,
            source="rgw_admin_bucket_stats",
        )
    )
    db_session.commit()

    S3AccountsService(db_session, allow_missing_admin=True).unlink_account(account.id)

    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None
    assert db_session.query(UserS3Account).filter(UserS3Account.account_id == account.id).first() is None
    assert db_session.query(AccountIAMUser).filter(AccountIAMUser.account_id == account.id).first() is None
    audit = db_session.query(AuditLog).first()
    usage = db_session.query(BillingUsageDaily).first()
    storage = db_session.query(BillingStorageDaily).first()
    assignment = db_session.query(BillingAssignment).first()
    assert audit is not None and audit.account_id is None
    assert usage is not None and usage.s3_account_id is None
    assert storage is not None and storage.s3_account_id is None
    assert assignment is not None and assignment.s3_account_id is None
