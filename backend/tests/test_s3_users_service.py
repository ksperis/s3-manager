# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

import pytest

from app.db_models import S3User, User, UserS3User, UserRole
from app.models.s3_user import S3UserCreate, S3UserImport, S3UserUpdate
from app.services.s3_users_service import S3UsersService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError


class FakeRGWAdmin:
    def __init__(self):
        self.created_users: list[str] = []
        self.deleted_users: list[str] = []
        self.rotated_users: list[str] = []
        self.deleted_keys: list[str] = []
        self.cap_operations: list[tuple[str, str, Optional[str], str]] = []
        self.importable_users: dict[str, dict] = {
            "existing": {
                "display_name": "Existing",
                "keys": [{"access_key": "AK-existing", "secret_key": "SK-existing"}],
            },
        }
        self.user_keys: dict[str, list[dict[str, str]]] = {
            uid: [dict(entry) for entry in payload.get("keys", [])]
            for uid, payload in self.importable_users.items()
        }
        self.user_caps: dict[str, list[dict[str, str]]] = {}

    def _register_key(self, uid: str, access_key: str, secret_key: str) -> dict[str, str]:
        self.user_keys.setdefault(uid, []).append({"access_key": access_key, "secret_key": secret_key})
        return {"access_key": access_key, "secret_key": secret_key}

    def create_user(self, uid: str, display_name: str, email: str = "", tenant: Optional[str] = None):
        self.created_users.append(uid)
        key = self._register_key(uid, f"AK-{uid}", f"SK-{uid}")
        return {"keys": [key], "display_name": display_name}

    def create_access_key(self, uid: str, tenant: Optional[str] = None):
        self.rotated_users.append(uid)
        count = len(self.user_keys.get(uid, [])) + 1
        key = self._register_key(uid, f"ROT-{uid}-{count}", f"SEC-{uid}-{count}")
        return {
            "access_key": key["access_key"],
            "secret_key": key["secret_key"],
            "key_status": "enabled",
        }

    def delete_access_key(self, uid: str, access_key: str, tenant: Optional[str] = None):
        keys = self.user_keys.get(uid, [])
        filtered = [k for k in keys if k["access_key"] != access_key]
        if len(filtered) == len(keys):
            raise RGWAdminError("key not found")
        self.user_keys[uid] = filtered
        self.deleted_keys.append(access_key)

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        if uid == "fail":
            raise RGWAdminError("boom")
        self.deleted_users.append(uid)

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        keys = self.user_keys.get(uid)
        if not keys:
            return {"not_found": True}
        data = {"keys": keys, "display_name": uid}
        caps = self.user_caps.get(uid)
        if caps is not None:
            data["caps"] = [dict(entry) for entry in caps]
        return data

    def _extract_keys(self, data):
        return RGWAdminClient._extract_keys(self, data)

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None, op: str = "add"):
        self.cap_operations.append((uid, cap, tenant, op))
        scope, _, perms = cap.partition("=")
        normalized_perm = perms.replace(" ", "") or "*"
        if op == "del":
            entries = self.user_caps.get(uid, [])
            filtered = [entry for entry in entries if not (entry.get("type") == scope and entry.get("perm", "").replace(" ", "") == normalized_perm)]
            self.user_caps[uid] = filtered
        else:
            self.user_caps.setdefault(uid, []).append({"type": scope, "perm": normalized_perm})
        return {"uid": uid, "cap": cap, "tenant": tenant, "op": op}

    def list_topics(self, account_id: Optional[str] = None):
        return []


def test_create_s3_user_persists_credentials(db_session):
    service = S3UsersService(db_session, rgw_admin_client=FakeRGWAdmin())
    created = service.create_user(
        S3UserCreate(
            name="Standalone",
            uid="standalone",
            email="standalone@example.com",
        )
    )
    assert created.rgw_user_uid == "standalone"
    record = db_session.query(S3User).filter_by(rgw_user_uid="standalone").one()
    assert record.rgw_access_key == "AK-standalone"
    assert record.rgw_secret_key == "SK-standalone"


def test_import_s3_user_fetches_existing(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    imported = service.import_users([S3UserImport(uid="existing")])
    assert len(imported) == 1
    record = db_session.query(S3User).filter_by(rgw_user_uid="existing").one()
    assert record.rgw_access_key.startswith("ROT-existing-")


def test_update_links_portal_users(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="link-me"))
    portal_user = User(email="user@example.com", full_name="Portal", hashed_password="x", role=UserRole.ACCOUNT_ADMIN.value)
    db_session.add(portal_user)
    db_session.commit()

    updated = service.update_user(created.id, S3UserUpdate(user_ids=[portal_user.id], email="new@example.com"))
    assert portal_user.id in updated.user_ids
    link = db_session.query(UserS3User).filter_by(user_id=portal_user.id, s3_user_id=created.id).one()
    assert link is not None


def test_get_user_returns_schema(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="get-me"))
    fetched = service.get_user(created.id)
    assert fetched.id == created.id
    assert fetched.name == "Standalone"


def test_rotate_keys_updates_credentials(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="rotate-me"))
    rotated = service.rotate_keys(created.id)
    record = db_session.query(S3User).filter_by(id=created.id).one()
    assert record.rgw_access_key.startswith("ROT-")
    assert rotated.rgw_user_uid == "rotate-me"
    assert all(not key["access_key"].startswith("AK-") for key in fake.user_keys["rotate-me"])


def test_rotate_keys_prefers_new_credentials_when_multiple_entries(db_session):
    class FullResponseRGW(FakeRGWAdmin):
        def create_access_key(self, uid: str, tenant: Optional[str] = None):  # type: ignore[override]
            existing_entries = [dict(entry) for entry in self.user_keys.get(uid, [])]
            for entry in existing_entries:
                entry.pop("secret_key", None)
            count = len(existing_entries) + 1
            new_entry = self._register_key(uid, f"ROT-{uid}-{count}", f"SEC-{uid}-{count}")
            combined = existing_entries + [dict(new_entry)]
            return {"display_name": uid, "keys": combined}

    fake = FullResponseRGW()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="rotate-full"))
    rotated = service.rotate_keys(created.id)
    record = db_session.query(S3User).filter_by(id=created.id).one()
    assert record.rgw_access_key == "ROT-rotate-full-2"
    assert rotated.rgw_user_uid == "rotate-full"
    assert fake.deleted_keys == ["AK-rotate-full"]
    remaining_keys = [entry["access_key"] for entry in fake.user_keys["rotate-full"]]
    assert remaining_keys == ["ROT-rotate-full-2"]


def test_rotate_keys_skips_previous_entry_when_secret_missing(db_session):
    class NoSecretRGW(FakeRGWAdmin):
        def create_access_key(self, uid: str, tenant: Optional[str] = None):  # type: ignore[override]
            existing_entries = [dict(entry) for entry in self.user_keys.get(uid, [])]
            for entry in existing_entries:
                entry.pop("secret_key", None)
            count = len(existing_entries) + 1
            new_entry = {"access_key": f"ROT-{uid}-{count}", "status": "enabled"}
            combined = existing_entries + [new_entry]
            return {"keys": combined}

    fake = NoSecretRGW()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="rotate-secretless"))
    rotated = service.rotate_keys(created.id)
    record = db_session.query(S3User).filter_by(id=created.id).one()
    assert record.rgw_access_key == "ROT-rotate-secretless-2"
    assert rotated.rgw_user_uid == "rotate-secretless"


def test_create_s3_user_leaves_caps_untouched(db_session):
    class CapRGW(FakeRGWAdmin):
        def create_user(self, uid: str, display_name: str, email: str = "", tenant: Optional[str] = None):  # type: ignore[override]
            resp = super().create_user(uid, display_name, email=email, tenant=tenant)
            self.user_caps[uid] = [
                {"type": "usage", "perm": "read"},
                {"type": "buckets", "perm": "read, write"},
            ]
            return resp

    fake = CapRGW()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Secure", uid="caps-off"))
    assert created.rgw_user_uid == "caps-off"
    assert fake.cap_operations == []
    assert fake.user_caps["caps-off"] != []


def test_import_s3_user_leaves_existing_caps(db_session):
    class ImportCapRGW(FakeRGWAdmin):
        def __init__(self):
            super().__init__()
            self.importable_users["cap-import"] = {
                "display_name": "Cap Import",
                "keys": [{"access_key": "AK-cap", "secret_key": "SK-cap"}],
            }
            self.user_keys["cap-import"] = [
                {"access_key": "AK-cap", "secret_key": "SK-cap"},
            ]
            self.user_caps["cap-import"] = [
                {"type": "usage", "perm": "read"},
                {"type": "users", "perm": "read"},
            ]

    fake = ImportCapRGW()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    imported = service.import_users([S3UserImport(uid="cap-import")])
    assert len(imported) == 1
    assert fake.cap_operations == []
    assert fake.user_caps["cap-import"] != []


def test_delete_user_can_skip_rgw(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="delete-me"))
    service.delete_user(created.id, delete_rgw=True)
    assert fake.deleted_users == ["delete-me"]
    assert db_session.query(S3User).filter_by(id=created.id).first() is None


def test_list_keys_marks_ui_key(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="list-keys"))
    extra = service.create_access_key_entry(created.id)
    keys = service.list_keys(created.id)
    assert any(k.is_ui_managed for k in keys)
    assert any(k.access_key_id == extra.access_key_id for k in keys)


def test_create_access_key_entry_returns_secret(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="create-access"))
    key = service.create_access_key_entry(created.id)
    assert key.secret_access_key.startswith("SEC-create-access")


def test_delete_key_validations(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="delete-key"))
    record = db_session.query(S3User).filter_by(id=created.id).one()
    with pytest.raises(ValueError):
        service.delete_key(created.id, record.rgw_access_key)
    extra = service.create_access_key_entry(created.id).access_key_id
    service.delete_key(created.id, extra)
    assert all(key["access_key"] != extra for key in fake.user_keys["delete-key"])


def test_unlink_user_removes_ui_key_and_row(db_session):
    fake = FakeRGWAdmin()
    service = S3UsersService(db_session, rgw_admin_client=fake)
    created = service.create_user(S3UserCreate(name="Standalone", uid="unlink-me"))
    service.unlink_user(created.id)
    assert fake.deleted_keys == ["AK-unlink-me"]
    assert db_session.query(S3User).filter_by(id=created.id).first() is None
