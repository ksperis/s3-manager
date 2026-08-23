# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import UTC, date, datetime
from typing import Optional

import pytest
from pydantic import ValidationError

from app.services.s3_accounts_service import S3AccountsService
from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    BucketUsageStatsSnapshot,
    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
)
from app.models.s3_account import S3AccountCreate, S3AccountImport
from app.services.rgw_admin import RGWAdminError


def _seed_ceph_endpoint(db_session, *, account_enabled: bool = True, is_default: bool = True) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="ceph-accounts-test",
        endpoint_url="https://ceph-accounts.example.test",
        provider=StorageProvider.CEPH.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            "  account:\n"
            f"    enabled: {'true' if account_enabled else 'false'}\n"
        ),
        is_default=is_default,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _build_service(db_session, monkeypatch, fake_admin) -> S3AccountsService:
    monkeypatch.setattr(
        "app.services.s3_accounts_service.get_endpoint_admin_rgw_client",
        lambda _endpoint: fake_admin,
    )
    return S3AccountsService(db_session)


class FakeRGWAdmin:
    def __init__(self, account_payload: Optional[dict[str, object]] = None):
        self.created_accounts: list[tuple[str, str]] = []
        self.created_users: list[str] = []
        self.quota_calls: list[dict[str, object]] = []
        self.account_payload = account_payload

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

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        if self.account_payload is not None:
            return self.account_payload
        return {"id": account_id, "user_list": []}


def test_create_account_with_root(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    payload = S3AccountCreate(
        name="TestS3Account",
        email=None,
        quota_max_size_gb=None,
        quota_max_objects=None,
        storage_endpoint_id=endpoint.id,
    )
    acc = svc.create_account_with_manager(payload)

    # S3Account persisted
    db_account = db_session.query(S3Account).filter(S3Account.name == "TestS3Account").first()
    assert db_account is not None
    assert db_account.rgw_access_key == "AKIA"
    assert db_account.rgw_account_id is not None

    # No interface user is created; only RGW root keys stored on account
    root_user = db_session.query(User).filter(User.email.like("%-admin")).first()
    assert root_user is None


def test_create_account_requires_account_api_feature(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=False, is_default=False)
    svc = _build_service(db_session, monkeypatch, FakeRGWAdmin())
    payload = S3AccountCreate(
        name="BlockedByFeature",
        email=None,
        quota_max_size_gb=None,
        quota_max_objects=None,
        storage_endpoint_id=endpoint.id,
    )

    with pytest.raises(ValueError, match="does not support RGW account API"):
        svc.create_account_with_manager(payload)


def test_get_account_limits_returns_quota_and_entity_limits(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="LimitedAccount",
        rgw_account_id="RGW-LIMITED",
        rgw_user_uid="rgw-limited-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    fake_admin = FakeRGWAdmin(
        {
            "id": "RGW-LIMITED",
            "quota": {
                "enabled": True,
                "max_size": 10 * 1024 ** 3,
                "max_objects": 2_000,
            },
            "limits": {
                "max_buckets": "8",
                "max_users": "20",
                "max_roles": 12,
                "max_groups": 6,
            },
        }
    )
    svc = _build_service(db_session, monkeypatch, fake_admin)

    assert svc.get_account_limits(account) == (10, 2_000, 8, 20, 12, 6)


def test_get_account_limits_does_not_repeat_lookup_without_embedded_quota(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="LimitsWithoutQuota",
        rgw_account_id="RGW-LIMITS-NO-QUOTA",
        rgw_user_uid="rgw-limits-no-quota-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    fake_admin = FakeRGWAdmin(
        {
            "id": "RGW-LIMITS-NO-QUOTA",
            "limits": {"max_buckets": 5},
        }
    )
    fake_admin.get_account_quota = lambda _account_id: pytest.fail("account payload must not be loaded twice")
    svc = _build_service(db_session, monkeypatch, fake_admin)

    assert svc.get_account_limits(account) == (None, None, 5, None, None, None)


class FakeRGWAdminImport:
    def __init__(self):
        self.calls: list[tuple[str, Optional[str]]] = []

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "name": "LegacyS3Account", "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        self.calls.append(("get_user", tenant))
        if tenant == "RGW12345678901234567" or tenant is None:
            return {"keys": [{"access_key": "IMPORTED", "secret_key": "SECRET"}]}
        return None

    def create_user_with_account_id(self, *args, **kwargs):
        return {}

    def create_access_key(self, *args, **kwargs):
        return {}

    def _extract_keys(self, data):
        return data.get("keys", [])


def test_import_account_reuses_existing_root_user_keys(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImport()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    imports = [S3AccountImport(rgw_account_id="RGW12345678901234567", name=None, email=None, storage_endpoint_id=endpoint.id)]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.rgw_account_id == "RGW12345678901234567").first()
    assert db_account is not None
    assert db_account.rgw_access_key == "IMPORTED"
    assert db_account.rgw_secret_key == "SECRET"
    assert db_account.rgw_user_uid == "RGW12345678901234567-admin"
    assert fake_admin.calls == [("get_user", "RGW12345678901234567")]


class FakeRGWAdminImportCreatesRoot:
    def __init__(self, account_name: str = "MissingRootS3Account"):
        self.created_users: list[tuple[str, Optional[str]]] = []
        self.account_name = account_name

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "name": self.account_name, "user_list": []}

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
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


def test_import_account_creates_root_user_when_missing(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportCreatesRoot()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    account_id = "RGW98765432109876543"
    imports = [S3AccountImport(rgw_account_id=account_id, name="Legacy", email="legacy@example.com", storage_endpoint_id=endpoint.id)]
    created = svc.import_accounts(imports)

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.rgw_account_id == account_id).first()
    assert db_account is not None
    assert db_account.rgw_access_key == "NEWROOT"
    assert db_account.rgw_secret_key == "NEWSECRET"
    assert fake_admin.created_users == [("RGW98765432109876543-admin", account_id)]
    assert db_account.rgw_user_uid == "RGW98765432109876543-admin"


def test_import_account_identifier_is_normalized_and_strictly_validated():
    normalized = S3AccountImport(
        rgw_account_id=" rgw12345678901234567 ",
        storage_endpoint_id=1,
    )

    assert normalized.rgw_account_id == "RGW12345678901234567"
    with pytest.raises(ValidationError, match="RGW followed by 17 digits"):
        S3AccountImport(rgw_account_id="RGW123", storage_endpoint_id=1)


class FakeRGWAdminImportSplitKeys(FakeRGWAdminImportCreatesRoot):
    def __init__(self):
        super().__init__(account_name="SplitKeysAccount")
        self.created_keys: list[tuple[str, Optional[str]]] = []

    def get_user(self, uid: str, tenant: Optional[str] = None, allow_not_found: bool = False):
        return {"keys": [{"access_key": "ACCESS-ONLY"}, {"secret_key": "SECRET-ONLY"}]}

    def create_access_key(self, uid: str, tenant: Optional[str] = None, key_name: Optional[str] = None):
        self.created_keys.append((uid, tenant))
        return {"keys": [{"access_key": "MATCHED-ACCESS", "secret_key": "MATCHED-SECRET"}]}


def test_import_account_never_combines_credentials_from_different_keys(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    fake_admin = FakeRGWAdminImportSplitKeys()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    account_id = "RGW11111111111111111"
    created = svc.import_accounts(
        [S3AccountImport(rgw_account_id=account_id, storage_endpoint_id=endpoint.id)]
    )

    assert len(created) == 1
    db_account = db_session.query(S3Account).filter(S3Account.rgw_account_id == account_id).one()
    assert db_account.rgw_access_key == "MATCHED-ACCESS"
    assert db_account.rgw_secret_key == "MATCHED-SECRET"
    assert fake_admin.created_keys == [(f"{account_id}-admin", account_id)]


class FakeRGWAdminImportBatch(FakeRGWAdminImportCreatesRoot):
    def __init__(self, missing_account_id: str):
        super().__init__(account_name="PreparedAccount")
        self.missing_account_id = missing_account_id

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        if account_id == self.missing_account_id:
            return {"not_found": True}
        return {"id": account_id, "name": f"Account-{account_id}", "user_list": []}


def test_import_accounts_validates_entire_batch_before_mutating_rgw(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    missing_account_id = "RGW22222222222222222"
    fake_admin = FakeRGWAdminImportBatch(missing_account_id)
    svc = _build_service(db_session, monkeypatch, fake_admin)
    first_account_id = "RGW33333333333333333"

    with pytest.raises(ValueError, match=f"S3Account {missing_account_id} not found in RGW"):
        svc.import_accounts(
            [
                S3AccountImport(rgw_account_id=first_account_id, storage_endpoint_id=endpoint.id),
                S3AccountImport(rgw_account_id=missing_account_id, storage_endpoint_id=endpoint.id),
            ]
        )

    assert fake_admin.created_users == []
    assert db_session.query(S3Account).filter(S3Account.rgw_account_id == first_account_id).first() is None


def test_import_accounts_rejects_name_collisions_before_mutating_rgw(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    existing = S3Account(
        name="Existing account",
        rgw_account_id="RGW44444444444444444",
        rgw_user_uid="RGW44444444444444444-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(existing)
    db_session.commit()
    fake_admin = FakeRGWAdminImportCreatesRoot(account_name=existing.name)
    svc = _build_service(db_session, monkeypatch, fake_admin)

    with pytest.raises(ValueError, match="S3Account name already exists: Existing account"):
        svc.import_accounts(
            [
                S3AccountImport(
                    rgw_account_id="RGW55555555555555555",
                    storage_endpoint_id=endpoint.id,
                )
            ]
        )

    assert fake_admin.created_users == []


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

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        return {"id": account_id, "user_list": []}


class FakeRGWDeleteAdminFails(FakeRGWDeleteAdmin):
    def delete_user(self, uid: str, tenant: Optional[str] = None):
        raise RGWAdminError("delete_user failed")


def _seed_account_derived_rows(db_session, *, endpoint: StorageEndpoint, account: S3Account) -> None:
    rate_card = BillingRateCard(
        name=f"account-delete-rate-{account.id}",
        currency="EUR",
        effective_from=date(2026, 1, 1),
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(rate_card)
    db_session.flush()
    db_session.add_all(
        [
            BillingAssignment(
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                rate_card_id=rate_card.id,
            ),
            BillingUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                source="rgw_admin_usage",
            ),
            BillingStorageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                source="rgw_admin_bucket_stats",
            ),
            QuotaUsageHourly(
                hour_ts=datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                used_bytes=1,
                used_objects=1,
            ),
            QuotaUsageDaily(
                day=date(2026, 1, 1),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=1,
                last_used_objects=1,
            ),
            QuotaAlertState(
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
            ),
            BucketUsageStatsSnapshot(
                scope_kind="manager",
                scope_id=str(account.id),
                scope_name=account.name,
                bucket_name="account-bucket",
                data_type_distribution_json="[]",
                storage_class_distribution_json="[]",
                size_distribution_json="[]",
                age_distribution_json="[]",
                current_noncurrent_distribution_json="[]",
            ),
        ]
    )
    db_session.commit()


def test_delete_account_skips_rgw_when_flag_false(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteMe",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="rgw00000000000000001-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.get_account_usage = lambda acc: (0, 0, 0)  # type: ignore[method-assign]
    svc._account_rgw_users = lambda account_id, tenant, admin, **kwargs: (0, [])  # type: ignore[method-assign]
    svc._account_topics_info = lambda account_id, admin, endpoint_id: (0, [])  # type: ignore[method-assign]

    svc.delete_account(account.id, delete_rgw=False)

    assert fake_admin.deleted == []
    assert fake_admin.deleted_users == []
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None


def test_delete_account_purges_derived_database_rows(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteDerived",
        rgw_account_id="RGW00000000000000004",
        rgw_user_uid="rgw00000000000000004-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    _seed_account_derived_rows(db_session, endpoint=endpoint, account=account)

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.delete_account(account.id, delete_rgw=False)

    assert db_session.query(BillingAssignment).filter(BillingAssignment.s3_account_id == account.id).count() == 0
    assert db_session.query(BillingUsageDaily).filter(BillingUsageDaily.s3_account_id == account.id).count() == 0
    assert (
        db_session.query(BillingStorageDaily).filter(BillingStorageDaily.s3_account_id == account.id).count() == 0
    )
    assert db_session.query(QuotaUsageHourly).filter(QuotaUsageHourly.s3_account_id == account.id).count() == 0
    assert db_session.query(QuotaUsageDaily).filter(QuotaUsageDaily.s3_account_id == account.id).count() == 0
    assert db_session.query(QuotaAlertState).filter(QuotaAlertState.s3_account_id == account.id).count() == 0
    assert (
        db_session.query(BucketUsageStatsSnapshot)
        .filter(BucketUsageStatsSnapshot.scope_kind == "manager", BucketUsageStatsSnapshot.scope_id == str(account.id))
        .count()
        == 0
    )


def test_delete_account_calls_rgw_when_flag_true(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="DeleteRGW",
        rgw_account_id="RGW00000000000000002",
        rgw_user_uid="rgw00000000000000002-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)
    svc.get_account_usage = lambda acc: (0, 0, 0)  # type: ignore[method-assign]
    svc._account_rgw_users = lambda account_id, tenant, admin, **kwargs: (0, [])  # type: ignore[method-assign]
    svc._account_topics_info = lambda account_id, admin, endpoint_id: (0, [])  # type: ignore[method-assign]

    svc.delete_account(account.id, delete_rgw=True)

    assert fake_admin.deleted == ["RGW00000000000000002"]
    assert fake_admin.deleted_users == [("rgw00000000000000002-admin", None)]
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None


def test_unlink_account_deletes_root_and_interface_links(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="UnlinkMe",
        rgw_account_id="RGW00000000000000003",
        rgw_user_uid="rgw00000000000000003-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    user = User(email="unlink@example.com", hashed_password="hash", role=UserRole.UI_USER.value)
    db_session.add(user)
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            is_root=False,
            role="account_administrator",
        )
    )
    db_session.commit()

    fake_admin = FakeRGWDeleteAdmin()
    svc = _build_service(db_session, monkeypatch, fake_admin)

    svc.unlink_account(account.id)

    assert fake_admin.deleted == []
    assert fake_admin.deleted_users == [("rgw00000000000000003-admin", None)]
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None
    assert db_session.query(UserS3Account).filter(UserS3Account.account_id == account.id).first() is None


def test_unlink_account_raises_when_root_user_cannot_be_deleted(db_session, monkeypatch):
    endpoint = _seed_ceph_endpoint(db_session, account_enabled=True, is_default=True)
    account = S3Account(
        name="BrokenUnlink",
        rgw_account_id="RGW00000000000000004",
        rgw_user_uid="rgw00000000000000004-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()

    svc = _build_service(db_session, monkeypatch, FakeRGWDeleteAdminFails())

    with pytest.raises(ValueError):
        svc.unlink_account(account.id)

    # S3Account should remain because unlink failed
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is not None
