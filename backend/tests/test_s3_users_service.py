# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import pytest

from app.db import S3User, StorageEndpoint, StorageProvider, User, UserRole, UserS3User
from app.models.s3_user import S3UserCreate, S3UserImport, S3UserUpdate
from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_users_service import S3UsersService


class FakeRGWAdmin:
    def __init__(self) -> None:
        self.remote_users: dict[str, dict] = {}
        self.deleted_users: list[str] = []
        self.deleted_keys: list[str] = []
        self.quota_by_uid: dict[str, tuple[Optional[int], Optional[int]]] = {}

    def _extract_keys(self, data):  # noqa: ANN001
        return RGWAdminClient._extract_keys(self, data)

    def create_user(self, uid: str, display_name: str, email: str = "", tenant: Optional[str] = None):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        key = {"access_key": f"AK-{uid}", "secret_key": f"SK-{uid}", "status": "enabled"}
        self.remote_users[uid] = {
            "display_name": display_name,
            "email": email or None,
            "keys": [key],
            "caps": [],
        }
        return {"display_name": display_name, "keys": [dict(key)]}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        payload = self.remote_users.get(uid)
        if payload is None:
            return {"not_found": True} if allow_not_found else None
        result = {
            "display_name": payload.get("display_name"),
            "email": payload.get("email"),
            "keys": [dict(entry) for entry in payload.get("keys", [])],
        }
        caps = payload.get("caps")
        if caps:
            result["caps"] = [dict(entry) for entry in caps]
        return result

    def create_access_key(self, uid: str, tenant: Optional[str] = None):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        payload = self.remote_users.get(uid)
        if payload is None:
            raise RGWAdminError("user not found")
        idx = len(payload.get("keys", [])) + 1
        key = {
            "access_key": f"ROT-{uid}-{idx}",
            "secret_key": f"SEC-{uid}-{idx}",
            "status": "enabled",
        }
        payload.setdefault("keys", []).append(dict(key))
        return {"keys": [dict(key)]}

    def delete_access_key(self, uid: str, access_key: str, tenant: Optional[str] = None):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        payload = self.remote_users.get(uid)
        if payload is None:
            raise RGWAdminError("user not found")
        keys = payload.get("keys", [])
        filtered = [entry for entry in keys if entry.get("access_key") != access_key]
        if len(filtered) == len(keys):
            raise RGWAdminError("key not found")
        payload["keys"] = filtered
        self.deleted_keys.append(access_key)

    def set_user_quota(
        self,
        uid: str,
        max_size_bytes: Optional[int] = None,
        max_objects: Optional[int] = None,
        enabled: bool = True,
    ):
        self.quota_by_uid[uid] = (max_size_bytes, max_objects) if enabled else (None, None)
        return {"ok": True}

    def get_user_quota(self, uid: str, tenant: Optional[str] = None):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        return self.quota_by_uid.get(uid, (None, None))

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        if tenant is not None:
            raise RGWAdminError("tenant not supported in fake")
        if uid not in self.remote_users:
            raise RGWAdminError("user not found")
        self.deleted_users.append(uid)
        self.remote_users.pop(uid, None)


def _seed_ceph_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="ceph-users",
        endpoint_url="https://ceph-users.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
        ),
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _build_service(db_session, monkeypatch, fake_admin: FakeRGWAdmin) -> S3UsersService:
    monkeypatch.setattr("app.services.s3_users_service.get_rgw_admin_client", lambda **_: fake_admin)
    return S3UsersService(db_session)


def _seed_local_user(
    db_session,
    *,
    name: str,
    uid: str,
    endpoint_id: int,
    created_at: datetime | None = None,
) -> S3User:
    row = S3User(
        name=name,
        rgw_user_uid=uid,
        email=f"{uid}@example.com",
        rgw_access_key=f"AK-{uid}",
        rgw_secret_key=f"SK-{uid}",
        storage_endpoint_id=endpoint_id,
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_create_user_persists_credentials(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(
        S3UserCreate(
            name="Standalone",
            uid="standalone",
            email="standalone@example.com",
            storage_endpoint_id=endpoint.id,
        )
    )

    assert created.rgw_user_uid == "standalone"
    record = db_session.query(S3User).filter_by(rgw_user_uid="standalone").one()
    assert record.rgw_access_key == "AK-standalone"
    assert record.rgw_secret_key == "SK-standalone"
    assert record.storage_endpoint_id == endpoint.id


def test_import_user_fetches_remote_and_creates_key(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    fake.remote_users["existing"] = {
        "display_name": "Existing",
        "email": "existing@example.com",
        "keys": [{"access_key": "AK-existing", "secret_key": "SK-existing", "status": "enabled"}],
        "caps": [{"type": "usage", "perm": "read"}],
    }
    service = _build_service(db_session, monkeypatch, fake)

    imported = service.import_users([S3UserImport(uid="existing", storage_endpoint_id=endpoint.id)])

    assert len(imported) == 1
    record = db_session.query(S3User).filter_by(rgw_user_uid="existing").one()
    assert record.rgw_access_key.startswith("ROT-existing-")
    assert record.rgw_access_key != "AK-existing"


def test_update_links_normalizes_non_ui_roles_to_ui_user(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Linkable", uid="linkable", storage_endpoint_id=endpoint.id))
    actor = User(email="actor@example.test", hashed_password="x", role=UserRole.UI_NONE.value)
    db_session.add(actor)
    db_session.commit()

    updated = service.update_user(created.id, S3UserUpdate(user_ids=[actor.id]))

    db_session.refresh(actor)
    assert actor.role == UserRole.UI_USER.value
    assert actor.id in (updated.user_ids or [])
    link = db_session.query(UserS3User).filter_by(user_id=actor.id, s3_user_id=created.id).one()
    assert link is not None


def test_rotate_keys_replaces_old_credentials_and_deletes_previous(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Rotate", uid="rotate-me", storage_endpoint_id=endpoint.id))
    previous_key = db_session.query(S3User).filter_by(id=created.id).one().rgw_access_key

    rotated = service.rotate_keys(created.id)

    record = db_session.query(S3User).filter_by(id=created.id).one()
    assert rotated.rgw_user_uid == "rotate-me"
    assert record.rgw_access_key.startswith("ROT-rotate-me-")
    assert previous_key in fake.deleted_keys


def test_list_keys_marks_ui_key(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Keys", uid="keys", storage_endpoint_id=endpoint.id))
    extra = service.create_access_key_entry(created.id)

    keys = service.list_keys(created.id)

    assert any(key.is_ui_managed for key in keys)
    assert any(key.access_key_id == extra.access_key_id for key in keys)


def test_list_keys_uses_active_flag_when_status_is_missing(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="ActiveFlag", uid="active-flag", storage_endpoint_id=endpoint.id))
    record = db_session.query(S3User).filter_by(id=created.id).one()
    fake.remote_users["active-flag"]["keys"] = [
        {"access_key": record.rgw_access_key, "secret_key": record.rgw_secret_key, "active": True},
        {"access_key": "AK-DISABLED", "secret_key": "SK-DISABLED", "active": False},
    ]

    keys = service.list_keys(created.id)
    indexed = {entry.access_key_id: entry for entry in keys}

    assert indexed["AK-DISABLED"].is_active is False
    assert indexed["AK-DISABLED"].status == "disabled"


def test_list_keys_preserves_created_at_when_rgw_splits_key_metadata(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Dates", uid="dates", storage_endpoint_id=endpoint.id))
    record = db_session.query(S3User).filter_by(id=created.id).one()

    fake.remote_users["dates"]["keys"] = [
        {"access_key": record.rgw_access_key, "secret_key": record.rgw_secret_key},
        {"access_key": record.rgw_access_key, "create_time": "2026-03-12T10:00:00Z", "status": "enabled"},
        {"access_key": "AK-SECOND", "secret_key": "SK-SECOND"},
        {"access_key": "AK-SECOND", "created_at": "2026-03-12T11:15:00Z", "status": "disabled"},
        {"access_key": "AK-THIRD", "secret_key": "SK-THIRD", "timestamp": "1773313200"},
    ]

    keys = service.list_keys(created.id)
    indexed = {entry.access_key_id: entry for entry in keys}

    assert indexed[record.rgw_access_key].created_at == datetime(2026, 3, 12, 10, 0, tzinfo=timezone.utc)
    assert indexed["AK-SECOND"].created_at == datetime(2026, 3, 12, 11, 15, tzinfo=timezone.utc)
    assert indexed["AK-THIRD"].created_at == datetime.fromtimestamp(1773313200, tz=timezone.utc)


def test_create_access_key_entry_propagates_created_at_from_rgw_response(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="CreateDate", uid="create-date", storage_endpoint_id=endpoint.id))

    def create_with_split_metadata(uid: str, tenant: Optional[str] = None):
        assert uid == "create-date"
        assert tenant is None
        return {
            "keys": [
                {"access_key": "AK-NEW", "secret_key": "SK-NEW"},
                {"access_key": "AK-NEW", "create_date": "2026-03-12T14:30:00Z"},
            ]
        }

    monkeypatch.setattr(fake, "create_access_key", create_with_split_metadata)

    generated = service.create_access_key_entry(created.id)

    assert generated.access_key_id == "AK-NEW"
    assert generated.created_at == datetime(2026, 3, 12, 14, 30, tzinfo=timezone.utc)


def test_create_access_key_entry_selects_new_key_when_response_contains_existing_keys(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="CreateSelect", uid="create-select", storage_endpoint_id=endpoint.id))
    record = db_session.query(S3User).filter_by(id=created.id).one()

    def create_with_existing_and_new(uid: str, tenant: Optional[str] = None):
        assert uid == "create-select"
        assert tenant is None
        new_key = {"access_key": "AK-NEW-SELECT", "secret_key": "SK-NEW-SELECT", "active": True}
        fake.remote_users[uid]["keys"].append(dict(new_key))
        return {
            "keys": [
                {"access_key": record.rgw_access_key, "secret_key": record.rgw_secret_key, "active": True},
                dict(new_key),
            ]
        }

    monkeypatch.setattr(fake, "create_access_key", create_with_existing_and_new)

    generated = service.create_access_key_entry(created.id)

    assert generated.access_key_id == "AK-NEW-SELECT"
    assert generated.secret_access_key == "SK-NEW-SELECT"


def test_delete_key_validations(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="DeleteKey", uid="delete-key", storage_endpoint_id=endpoint.id))
    record = db_session.query(S3User).filter_by(id=created.id).one()

    with pytest.raises(ValueError):
        service.delete_key(created.id, record.rgw_access_key)

    extra_key = service.create_access_key_entry(created.id).access_key_id
    service.delete_key(created.id, extra_key)
    assert extra_key in fake.deleted_keys


def test_unlink_user_removes_interface_key_and_db_row(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Unlink", uid="unlink-me", storage_endpoint_id=endpoint.id))
    interface_key = db_session.query(S3User).filter_by(id=created.id).one().rgw_access_key

    service.unlink_user(created.id)

    assert interface_key in fake.deleted_keys
    assert db_session.query(S3User).filter_by(id=created.id).first() is None


def test_delete_user_with_delete_rgw_checks_buckets_then_deletes(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session)
    fake = FakeRGWAdmin()
    service = _build_service(db_session, monkeypatch, fake)

    created = service.create_user(S3UserCreate(name="Remote", uid="remote-user", storage_endpoint_id=endpoint.id))

    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "owned-bucket"}])
    with pytest.raises(ValueError, match="still owns"):
        service.delete_user(created.id, delete_rgw=True)

    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [])
    service.delete_user(created.id, delete_rgw=True)

    assert "remote-user" in fake.deleted_users
    assert db_session.query(S3User).filter_by(id=created.id).first() is None


def test_list_users_and_minimal_are_sorted_case_insensitive_and_stable(db_session):
    endpoint = _seed_ceph_endpoint(db_session)
    _seed_local_user(db_session, name="Zulu", uid="sort-zulu", endpoint_id=endpoint.id)
    _seed_local_user(db_session, name="alpha", uid="sort-alpha", endpoint_id=endpoint.id)
    _seed_local_user(db_session, name="Beta", uid="sort-beta", endpoint_id=endpoint.id)
    same_1 = _seed_local_user(db_session, name="same", uid="sort-same-1", endpoint_id=endpoint.id)
    same_2 = _seed_local_user(db_session, name="same", uid="sort-same-2", endpoint_id=endpoint.id)

    service = S3UsersService(db_session)
    listed = service.list_users(include_quota=False)
    minimal = service.list_users_minimal()

    listed_names = [entry.name for entry in listed]
    listed_same_ids = [entry.id for entry in listed if entry.name == "same"]
    minimal_names = [entry.name for entry in minimal]
    minimal_same_ids = [entry.id for entry in minimal if entry.name == "same"]

    assert listed_names == ["alpha", "Beta", "same", "same", "Zulu"]
    assert minimal_names == ["alpha", "Beta", "same", "same", "Zulu"]
    assert listed_same_ids == sorted([same_1.id, same_2.id])
    assert minimal_same_ids == sorted([same_1.id, same_2.id])


def test_paginate_users_name_and_non_name_sorts_are_stable(db_session):
    endpoint = _seed_ceph_endpoint(db_session)
    older_time = datetime(2025, 1, 1, 12, 0, 0)
    same_1 = _seed_local_user(db_session, name="same", uid="page-same-1", endpoint_id=endpoint.id, created_at=older_time)
    same_2 = _seed_local_user(db_session, name="same", uid="page-same-2", endpoint_id=endpoint.id, created_at=older_time)
    _seed_local_user(db_session, name="alpha", uid="page-alpha", endpoint_id=endpoint.id, created_at=older_time)
    same_time = datetime(2026, 1, 1, 12, 0, 0)
    tie_1 = _seed_local_user(
        db_session,
        name="time-charlie",
        uid="page-time-1",
        endpoint_id=endpoint.id,
        created_at=same_time,
    )
    tie_2 = _seed_local_user(
        db_session,
        name="time-delta",
        uid="page-time-2",
        endpoint_id=endpoint.id,
        created_at=same_time,
    )
    _seed_local_user(
        db_session,
        name="time-bravo",
        uid="page-time-3",
        endpoint_id=endpoint.id,
        created_at=datetime(2026, 1, 2, 12, 0, 0),
    )

    service = S3UsersService(db_session)

    name_desc_items, _ = service.paginate_users(
        page=1,
        page_size=10,
        search=None,
        sort_field="name",
        sort_direction="desc",
        include_quota=False,
    )
    same_desc_ids = [entry.id for entry in name_desc_items if entry.name == "same"]

    created_desc_items, _ = service.paginate_users(
        page=1,
        page_size=10,
        search=None,
        sort_field="created_at",
        sort_direction="desc",
        include_quota=False,
    )
    created_desc_ids = [entry.id for entry in created_desc_items]

    assert [entry.name for entry in name_desc_items[:3]] == ["time-delta", "time-charlie", "time-bravo"]
    assert same_desc_ids == sorted([same_1.id, same_2.id], reverse=True)
    assert created_desc_items[0].name == "time-bravo"
    assert created_desc_ids.index(tie_2.id) < created_desc_ids.index(tie_1.id)
