# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime

from app.db import (
    ApiToken,
    AuthSession,
    AuditLog,
    BucketMigration,
    RefreshToken,
    S3Connection,
    S3User,
    User,
    UserRole,
    UserS3Connection,
)
from app.services.users_service import UsersService
from app.db.tag_definition import TagDefinition


def test_delete_user_cleans_owned_connections_tokens_and_sessions(db_session):
    owner = User(email="owner-delete@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    other = User(email="other-delete@example.com", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(owner)
    db_session.add(other)
    db_session.flush()

    owned_connection = S3Connection(
        created_by_user_id=owner.id,
        name="owned-private",
        access_key_id="AKIA-OWNED",
        secret_access_key="SECRET-OWNED",
    )
    shared_connection = S3Connection(
        created_by_user_id=other.id,
        name="other-private",
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
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    other_token = ApiToken(
        id="tok-other",
        jti="jti-other",
        token_hash="hash-other",
        user_id=other.id,
        name="other-token",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add(own_token)
    db_session.add(other_token)

    own_session = AuthSession(
        id="session-own",
        user_id=owner.id,
        auth_type="ui",
        principal_type="user",
        auth_version=1,
        last_activity_at=datetime(2026, 1, 1, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-own",
    )
    other_session = AuthSession(
        id="session-other",
        user_id=other.id,
        auth_type="ui",
        principal_type="user",
        auth_version=1,
        last_activity_at=datetime(2026, 1, 1, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-other",
    )
    db_session.add_all([own_session, other_session])
    db_session.flush()
    own_refresh = RefreshToken(
        id="ref-own",
        family_id="family-own",
        auth_session_id=own_session.id,
        token_hash="ref-hash-own",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    other_refresh = RefreshToken(
        id="ref-other",
        family_id="family-other",
        auth_session_id=other_session.id,
        token_hash="ref-hash-other",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add(own_refresh)
    db_session.add(other_refresh)

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
    assert db_session.query(AuthSession).filter(AuthSession.id == "session-own").first() is None
    assert db_session.query(RefreshToken).filter(RefreshToken.id == "ref-own").first() is None
    token = db_session.query(ApiToken).filter(ApiToken.id == "tok-other").first()
    refresh = db_session.query(RefreshToken).filter(RefreshToken.id == "ref-other").first()
    assert token is not None
    assert refresh is not None


def test_delete_user_nulls_nullable_foreign_keys(db_session):
    user = User(email="delete-fk-user@example.com", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(user)
    db_session.flush()

    audit = AuditLog(
        user_id=user.id,
        user_email=user.email,
        user_role=user.role,
        scope="admin",
        action="delete_user_test",
    )
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id="10",
        target_context_id="20",
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status="draft",
        precheck_status="pending",
        parallelism_max=1,
        total_items=0,
    )
    tag_definition = TagDefinition(
        domain_kind="private_connection_user",
        owner_user_id=user.id,
        label="Delete user label",
        label_key="delete-user-label",
        color_key="slate",
    )
    db_session.add_all([audit, migration, tag_definition])
    db_session.commit()

    UsersService(db_session).delete_user(user.id)

    refreshed_audit = db_session.query(AuditLog).filter(AuditLog.id == audit.id).first()
    refreshed_migration = db_session.query(BucketMigration).filter(BucketMigration.id == migration.id).first()
    refreshed_definition = db_session.query(TagDefinition).filter(TagDefinition.id == tag_definition.id).first()

    assert refreshed_audit is not None and refreshed_audit.user_id is None
    assert refreshed_migration is not None and refreshed_migration.created_by_user_id is None
    assert refreshed_definition is not None and refreshed_definition.owner_user_id is None
