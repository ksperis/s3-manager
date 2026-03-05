# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import BucketMigration, BucketMigrationItem, User, UserRole
from app.main import app
from app.routers import dependencies
from app.routers.dependencies import BucketMigrationAccessScope, _ensure_bucket_migration_allowed


def _user(role: str) -> User:
    return User(
        email=f"{role}@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
    )


def _settings(*, enabled: bool, allow_ui_user: bool):
    return SimpleNamespace(
        general=SimpleNamespace(
            bucket_migration_enabled=enabled,
            allow_ui_user_bucket_migration=allow_ui_user,
        )
    )


def test_bucket_migration_allowed_for_admin_when_feature_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=False))
    _ensure_bucket_migration_allowed(_user(UserRole.UI_ADMIN.value))


def test_bucket_migration_allowed_for_ui_user_when_explicitly_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=True))
    _ensure_bucket_migration_allowed(_user(UserRole.UI_USER.value))


def test_bucket_migration_forbidden_for_ui_user_by_default(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=False))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_USER.value))
    assert exc.value.status_code == 403


def test_bucket_migration_forbidden_when_feature_disabled(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=False, allow_ui_user=True))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_ADMIN.value))
    assert exc.value.status_code == 403
    assert "feature is disabled" in str(exc.value.detail).lower()


def test_bucket_migration_forbidden_for_unassigned_user(monkeypatch):
    monkeypatch.setattr("app.routers.dependencies.load_app_settings", lambda: _settings(enabled=True, allow_ui_user=True))
    with pytest.raises(HTTPException) as exc:
        _ensure_bucket_migration_allowed(_user(UserRole.UI_NONE.value))
    assert exc.value.status_code == 403


def _seed_migration(db_session, *, source_context_id: str, target_context_id: str, status: str = "draft") -> int:
    migration = BucketMigration(
        created_by_user_id=1,
        source_context_id=source_context_id,
        target_context_id=target_context_id,
        mode="one_shot",
        copy_bucket_settings=False,
        delete_source=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status=status,
        precheck_status="passed",
        parallelism_max=4,
        total_items=1,
    )
    db_session.add(migration)
    db_session.flush()
    db_session.add(
        BucketMigrationItem(
            migration_id=migration.id,
            source_bucket=f"src-{migration.id}",
            target_bucket=f"dst-{migration.id}",
            status="pending",
            step="create_bucket",
        )
    )
    db_session.commit()
    return int(migration.id)


def _override_migration_scope(*, user_id: int = 1, allowed_context_ids: set[str]):
    user = User(
        id=user_id,
        email=f"user-{user_id}@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )

    def _dep() -> BucketMigrationAccessScope:
        return BucketMigrationAccessScope(user=user, allowed_context_ids=allowed_context_ids)

    app.dependency_overrides[dependencies.get_current_bucket_migration_scope] = _dep


def test_manager_migration_list_is_scoped_to_authorized_contexts(client, db_session):
    migration_in_scope = _seed_migration(db_session, source_context_id="10", target_context_id="20")
    _seed_migration(db_session, source_context_id="10", target_context_id="30")
    _seed_migration(db_session, source_context_id="40", target_context_id="20")
    _override_migration_scope(allowed_context_ids={"10", "20"})
    try:
        response = client.get("/api/manager/migrations")
        assert response.status_code == 200
        payload = response.json()
        assert [entry["id"] for entry in payload["items"]] == [migration_in_scope]

        filtered = client.get("/api/manager/migrations", params={"context_id": "30"})
        assert filtered.status_code == 200
        assert filtered.json()["items"] == []
    finally:
        app.dependency_overrides.pop(dependencies.get_current_bucket_migration_scope, None)


def test_manager_migration_get_and_start_return_404_when_out_of_scope(client, db_session):
    migration_id = _seed_migration(db_session, source_context_id="10", target_context_id="30", status="draft")
    _override_migration_scope(allowed_context_ids={"10", "20"})
    try:
        get_response = client.get(f"/api/manager/migrations/{migration_id}")
        assert get_response.status_code == 404

        start_response = client.post(f"/api/manager/migrations/{migration_id}/start")
        assert start_response.status_code == 404
    finally:
        app.dependency_overrides.pop(dependencies.get_current_bucket_migration_scope, None)


def test_manager_migration_create_rejects_context_out_of_scope(client):
    _override_migration_scope(allowed_context_ids={"10", "20"})
    try:
        response = client.post(
            "/api/manager/migrations",
            json={
                "source_context_id": "99",
                "target_context_id": "20",
                "buckets": [{"source_bucket": "bucket-a"}],
            },
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(dependencies.get_current_bucket_migration_scope, None)


def test_manager_migration_update_rejects_context_out_of_scope(client, db_session):
    migration_id = _seed_migration(db_session, source_context_id="10", target_context_id="20", status="draft")
    _override_migration_scope(allowed_context_ids={"10", "20"})
    try:
        response = client.patch(
            f"/api/manager/migrations/{migration_id}",
            json={
                "source_context_id": "10",
                "target_context_id": "999",
                "buckets": [{"source_bucket": "bucket-a"}],
            },
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(dependencies.get_current_bucket_migration_scope, None)
