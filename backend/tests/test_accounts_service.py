# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

import pytest

from app.services.s3_accounts_service import S3AccountsService
from app.db_models import S3Account, User, UserRole, UserS3Account
from app.models.s3_account import S3AccountImport
from app.services.rgw_admin import RGWAdminError


class FakeRGWAdmin:
    def __init__(self):
        self.created_accounts: list[tuple[str, str]] = []
        self.created_users: list[str] = []
        self.quota_calls: list[dict[str, object]] = []

    def create_account(self, account_id: str, account_name: str):
        self.created_accounts.append((account_id, account_name))
        return {"id": account_id, "name": account_name}

    def create_user_with_account_id(self, uid: str, account_id: str, display_name: str, account_root: bool = True):
        self.created_users.append(uid)
        return {"account_id": account_id, "keys": [{"access_key": "AKIA", "secret_key": "SECRET"}]}

    def _extract_keys(self, data):
        return data.get("keys", [])

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def set_account_quota(
        self,
        account_id: str,
        max_size_bytes: Optional[int] = None,
        max_size_gb: Optional[int] = None,
        max_objects: Optional[int] = None,
        quota_type: str = "account",
        enabled: bool = True,
    ):
        self.quota_calls.append(
            {
                "account_id": account_id,
                "max_size_bytes": max_size_bytes,
                "max_size_gb": max_size_gb,
                "max_objects": max_objects,
                "quota_type": quota_type,
                "enabled": enabled,
            }
        )
        return {"ok": True}

    def get_account_quota(self, account_id: str):
        return None, None

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []

    def get_account(self, account_id: str, allow_not_found: bool = False):
        return {"id": account_id, "user_list": []}


def test_create_account_with_root(db_session):
    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWAdmin()

    payload = type("obj", (), {"name": "TestS3Account", "email": None, "quota_max_size_gb": None, "quota_max_objects": None})
    acc = svc.create_account_with_manager(payload)

    # S3Account persisted
    db_account = db_session.query(S3Account).filter(S3Account.name == "TestS3Account").first()
    assert db_account is not None
    assert db_account.rgw_access_key == "AKIA"
    assert db_account.rgw_account_id is not None

    # No interface user is created; only RGW root keys stored on account
    root_user = db_session.query(User).filter(User.email.like("%-admin")).first()
    assert root_user is None


class FakeRGWAdminImport:
    def __init__(self):
        self.calls: list[tuple[str, Optional[str]]] = []

    def get_account(self, account_id: str, allow_not_found: bool = False):
        return {"id": account_id, "name": "LegacyS3Account", "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        self.calls.append(("get_user", tenant))
        if tenant == "RGW12345678901234567" or tenant is None:
            return {"keys": [{"access_key": "IMPORTED", "secret_key": "SECRET"}]}
        return None

    def get_account_user(self, account_id: str, uid: str, allow_not_found: bool = False):
        self.calls.append(("get_account_user", account_id))
        raise RGWAdminError("account user endpoint unavailable")

    def create_account_user(self, *args, **kwargs):
        raise RGWAdminError("should not be called")

    def create_user_with_account_id(self, *args, **kwargs):
        return {}

    def create_user(self, uid: str, display_name: Optional[str] = None, email: Optional[str] = None, tenant: Optional[str] = None, caps: Optional[str] = None):
        self.calls.append(("create_user", tenant))
        return {}

    def create_access_key(self, *args, **kwargs):
        return {}

    def _extract_keys(self, data):
        return data.get("keys", [])

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []


def test_import_account_uses_user_api_when_account_user_missing(db_session):
    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWAdminImport()

    imports = [S3AccountImport(rgw_account_id="RGW12345678901234567", name=None, email=None)]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW12345678901234567").first()
    assert db_account is not None
    assert db_account.rgw_access_key == "IMPORTED"
    assert db_account.rgw_secret_key == "SECRET"
    assert created[0].root_user_email == "RGW12345678901234567-admin"


class FakeRGWAdminImportCreatesRoot:
    def __init__(self):
        self.created_users: list[tuple[str, Optional[str]]] = []

    def get_account(self, account_id: str, allow_not_found: bool = False):
        return {"id": account_id, "name": "MissingRootS3Account", "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        return None

    def get_account_user(self, account_id: str, uid: str, allow_not_found: bool = False):
        return None

    def create_user_with_account_id(self, *args, **kwargs):
        uid = kwargs.get("uid")
        account_id = kwargs.get("account_id")
        self.created_users.append((uid, account_id))
        return {"keys": [{"access_key": "NEWROOT", "secret_key": "NEWSECRET"}]}

    def create_access_key(self, *args, **kwargs):
        return {}

    def _extract_keys(self, data):
        return data.get("keys", [])

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []


def test_import_account_creates_root_user_when_missing(db_session):
    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWAdminImportCreatesRoot()

    account_id = "RGW98765432109876543"
    imports = [S3AccountImport(rgw_account_id=account_id, name="Legacy", email="legacy@example.com")]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.rgw_account_id == account_id).first()
    assert db_account is not None
    assert db_account.rgw_access_key == "NEWROOT"
    assert db_account.rgw_secret_key == "NEWSECRET"
    assert svc.rgw_admin.created_users == [("RGW98765432109876543-admin", account_id)]
    assert created[0].root_user_email == "RGW98765432109876543-admin"


def test_import_account_with_provided_keys(db_session):
    svc = S3AccountsService(db_session, rgw_admin_client=None, allow_missing_admin=True)

    imports = [
        S3AccountImport(
            name="KeyOnly",
            access_key="AK_KEY",
            secret_key="SK_SECRET",
            email="keyonly@example.com",
        )
    ]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.name == "KeyOnly").first()
    assert db_account is not None
    assert db_account.rgw_access_key == "AK_KEY"
    assert db_account.rgw_secret_key == "SK_SECRET"
    assert created[0].rgw_account_id is None


def test_import_account_requires_keys_without_admin(db_session):
    svc = S3AccountsService(db_session, rgw_admin_client=None, allow_missing_admin=True)

    with pytest.raises(ValueError):
        svc.import_accounts([S3AccountImport(rgw_account_id="RGW00000000000000420")])


class FakeRGWDeleteAdmin:
    def __init__(self):
        self.deleted: list[str] = []
        self.deleted_users: list[tuple[str, Optional[str]]] = []

    def delete_account(self, account_id: str):
        self.deleted.append(account_id)

    def delete_user(self, uid: str, tenant: Optional[str] = None):
        self.deleted_users.append((uid, tenant))

    def set_user_caps(self, uid: str, cap: str, tenant: Optional[str] = None):
        return {"uid": uid, "cap": cap, "tenant": tenant}

    def list_topics(self, account_id: Optional[str] = None):
        return []

    def list_users(self):
        return []

    def get_account(self, account_id: str, allow_not_found: bool = False):
        return {"id": account_id, "user_list": []}


class FakeRGWDeleteAdminFails(FakeRGWDeleteAdmin):
    def delete_user(self, uid: str, tenant: Optional[str] = None):
        raise RGWAdminError("delete_user failed")


    def list_users(self):
        return []


def test_delete_account_skips_rgw_when_flag_false(db_session):
    account = S3Account(name="DeleteMe", rgw_account_id="RGW00000000000000001")
    db_session.add(account)
    db_session.commit()

    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWDeleteAdmin()
    svc._account_usage = lambda acc: (0, 0, 0)  # type: ignore[method-assign]
    svc._account_rgw_users = lambda account_id, tenant, admin: (0, [])  # type: ignore[method-assign]
    svc._account_topics_info = lambda account_id, admin: (0, [])  # type: ignore[method-assign]

    svc.delete_account(account.id, delete_rgw=False)

    assert svc.rgw_admin.deleted == []
    assert svc.rgw_admin.deleted_users == []
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None


def test_delete_account_calls_rgw_when_flag_true(db_session):
    account = S3Account(name="DeleteRGW", rgw_account_id="RGW00000000000000002")
    db_session.add(account)
    db_session.commit()

    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWDeleteAdmin()

    svc.delete_account(account.id, delete_rgw=True)

    assert svc.rgw_admin.deleted == ["RGW00000000000000002"]
    assert svc.rgw_admin.deleted_users == [("RGW00000000000000002-admin", None)]
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None


def test_unlink_account_deletes_root_and_interface_links(db_session):
    account = S3Account(name="UnlinkMe", rgw_account_id="RGW00000000000000003")
    db_session.add(account)
    db_session.flush()
    user = User(email="unlink@example.com", hashed_password="hash", role=UserRole.ACCOUNT_ADMIN.value)
    db_session.add(user)
    db_session.flush()
    db_session.add(UserS3Account(user_id=user.id, account_id=account.id, is_root=False))
    db_session.commit()

    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWDeleteAdmin()

    svc.unlink_account(account.id)

    assert svc.rgw_admin.deleted == []
    assert svc.rgw_admin.deleted_users == [("RGW00000000000000003-admin", None)]
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None
    assert db_session.query(UserS3Account).filter(UserS3Account.account_id == account.id).first() is None


def test_unlink_account_raises_when_root_user_cannot_be_deleted(db_session):
    account = S3Account(name="BrokenUnlink", rgw_account_id="RGW00000000000000004")
    db_session.add(account)
    db_session.commit()

    svc = S3AccountsService(db_session)
    svc.rgw_admin = FakeRGWDeleteAdminFails()

    with pytest.raises(ValueError):
        svc.unlink_account(account.id)

    # S3Account should remain because unlink failed
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is not None
