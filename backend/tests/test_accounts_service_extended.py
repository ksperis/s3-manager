# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.db import AccountRole, S3Account, StorageEndpoint, StorageProvider, User, UserRole, UserS3Account
from app.models.s3_account import AccountUserLink, S3AccountUpdate
from app.services.rgw_admin import RGWAdminError
from app.services.s3_accounts_service import S3AccountsService


class _FakeRGWAdmin:
    def __init__(self):
        self.deleted_users: list[tuple[str, str | None]] = []
        self.deleted_accounts: list[str] = []
        self.topics_by_account: dict[str | None, list] = {}
        self.account_payload: dict = {"user_list": []}
        self.raise_topics: Exception | None = None
        self.raise_get_account: Exception | None = None
        self.get_account_calls = 0
        self.account_api_supported: bool | None = None
        self.unsupported_account_api = False

    def list_topics(self, account_id: str | None = None):
        if self.raise_topics:
            raise self.raise_topics
        return self.topics_by_account.get(account_id)

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = False,
        allow_not_implemented: bool = False,
    ):
        self.get_account_calls += 1
        if self.raise_get_account:
            raise self.raise_get_account
        if allow_not_implemented and self.unsupported_account_api:
            self.account_api_supported = False
            return None
        self.account_api_supported = True
        return self.account_payload

    def get_account_quota(self, account_id: str):
        return None, None

    def delete_user(self, uid: str, tenant: str | None = None):
        self.deleted_users.append((uid, tenant))

    def delete_account(self, account_id: str):
        self.deleted_accounts.append(account_id)


def _seed_endpoint(
    db_session,
    *,
    name: str,
    provider: StorageProvider = StorageProvider.CEPH,
    is_default: bool = False,
    account_enabled: bool = True,
    admin_enabled: bool = True,
) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=provider.value,
        admin_access_key="AKIA-ADMIN",
        admin_secret_key="SECRET-ADMIN",
        features_config=(
            "features:\n"
            f"  admin:\n    enabled: {'true' if admin_enabled else 'false'}\n"
            f"  account:\n    enabled: {'true' if account_enabled else 'false'}\n"
        ),
        is_default=is_default,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _seed_account(db_session, endpoint_id: int | None, *, name: str = "acc", rgw_account_id: str = "RGW0001") -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=rgw_account_id,
        rgw_access_key="AKIA-ROOT",
        rgw_secret_key="SECRET-ROOT",
        rgw_user_uid=f"{rgw_account_id.lower()}-admin",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _service(db_session, fake_admin: _FakeRGWAdmin | None = None) -> tuple[S3AccountsService, _FakeRGWAdmin]:
    admin = fake_admin or _FakeRGWAdmin()
    return S3AccountsService(db_session), admin


def test_resolve_storage_endpoint_errors_and_success(db_session):
    service, _ = _service(db_session)
    ceph = _seed_endpoint(db_session, name="ceph-default", provider=StorageProvider.CEPH, is_default=True)
    other = _seed_endpoint(db_session, name="other-endpoint", provider=StorageProvider.OTHER, is_default=False)

    assert service._resolve_storage_endpoint(ceph.id, require_ceph=True).id == ceph.id

    with pytest.raises(ValueError, match="Storage endpoint not found"):
        service._resolve_storage_endpoint(9999)
    with pytest.raises(ValueError, match="not a Ceph endpoint"):
        service._resolve_storage_endpoint(other.id, require_ceph=True)


def test_topic_parsing_helpers_and_account_topics_fallbacks(db_session):
    service, admin = _service(db_session)

    assert service._normalize_account_key("RGW1") == "rgw1"
    assert service._root_uid("RGW99") == "rgw99-admin"
    assert service._root_display_name("My account", "RGW99") == "My account"

    count, names = service._topics_from_response(
        [
            {"name": "topic-a", "account_id": "RGW1"},
            {"TopicArn": "arn:aws:sns:region:RGW1:topic-b"},
            "RGW1:topic-c",
        ]
    )
    assert count == 3
    assert names == ["RGW1:topic-c", "arn:aws:sns:region:RGW1:topic-b", "topic-a"]

    admin.raise_topics = RGWAdminError("405 methodNotAllowed")
    assert service._account_topics_info("RGW1", admin, 1) == (0, [])
    # Cache hit
    assert service._account_topics_info("RGW1", admin, 1) == (0, [])

    service._topics_cache.clear()
    admin.raise_topics = None
    admin.topics_by_account = {None: [{"TopicArn": "arn:aws:sns:region:RGW2:topic-z"}], "RGW2": None}
    assert service._account_topics_info("RGW2", admin, 1) == (1, ["arn:aws:sns:region:RGW2:topic-z"])

    admin.topics_by_account = {None: [{"TopicArn": "arn:aws:sns:region:RGW2:topic-y"}], "RGW2": None}
    assert service._account_topics_info("RGW2", admin, 2) == (1, ["arn:aws:sns:region:RGW2:topic-y"])


def test_account_rgw_users_paths(db_session):
    service, admin = _service(db_session)
    assert service._account_rgw_users("RGW1", {"rgw1": ["u1", "u2"]}, admin) == (2, ["u1", "u2"])
    assert service._account_rgw_users(None, None, admin) == (None, None)
    assert service._account_rgw_users("RGW1", None, None) == (None, None)

    admin.raise_get_account = RGWAdminError("boom")
    assert service._account_rgw_users("RGW1", None, admin) == (None, None)

    admin.raise_get_account = None
    admin.account_payload = {"user_list": ["RGW1-admin", "alice", "bob", "alice"]}
    assert service._account_rgw_users("RGW1", None, admin) == (2, ["alice", "bob"])


def test_account_rgw_users_skips_optional_lookup_when_accounts_api_is_unavailable(db_session):
    service, admin = _service(db_session)
    admin.unsupported_account_api = True

    assert service._account_rgw_users("RGW1", None, admin) == (None, None)
    assert admin.get_account_calls == 1


def test_account_rgw_users_skips_lookup_when_endpoint_capabilities_disable_accounts(db_session):
    service, admin = _service(db_session)

    assert service._account_rgw_users("RGW1", None, admin, endpoint_capabilities={"account": False}) == (None, None)
    assert admin.get_account_calls == 0


def test_update_account_user_links_missing_user(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-update", is_default=True)
    account = _seed_account(db_session, endpoint.id, name="update-acc", rgw_account_id="RGW-U-1")
    user_existing = User(email="existing@example.test", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(user_existing)
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user_existing.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
            is_root=False,
        )
    )
    db_session.commit()

    service, _ = _service(db_session)
    monkeypatch.setattr(service, "_account_quota", lambda *args, **kwargs: (None, None))

    with pytest.raises(ValueError, match="User not found"):
        service.update_account(
            account.id,
            S3AccountUpdate(
                user_links=[
                    AccountUserLink(
                        user_id=99999,
                        role=AccountRole.PORTAL_USER.value,
                    )
                ],
            ),
        )

    assert (
        db_session.query(UserS3Account)
        .filter(
            UserS3Account.account_id == account.id,
            UserS3Account.user_id == user_existing.id,
            UserS3Account.is_root.is_(False),
        )
        .one()
        .role
        == AccountRole.ACCOUNT_ADMINISTRATOR.value
    )


def test_update_account_adds_and_removes_links_with_quota_request(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-update-ok", is_default=True)
    account = _seed_account(db_session, endpoint.id, name="update-ok-acc", rgw_account_id="RGW-U-2")
    keep_user = User(email="keep@example.test", hashed_password="x", role=UserRole.UI_USER.value)
    add_user = User(email="add@example.test", hashed_password="x", role=UserRole.UI_NONE.value)
    remove_user = User(email="remove@example.test", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add_all([keep_user, add_user, remove_user])
    db_session.flush()
    db_session.add_all(
        [
            UserS3Account(
                user_id=keep_user.id,
                account_id=account.id,
                role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
                is_root=False,
            ),
            UserS3Account(
                user_id=remove_user.id,
                account_id=account.id,
                role=AccountRole.PORTAL_USER.value,
                is_root=False,
            ),
        ]
    )
    db_session.commit()

    service, _ = _service(db_session)

    quota_calls: list[tuple] = []
    monkeypatch.setattr(service, "_apply_account_quota", lambda *args, **kwargs: quota_calls.append(args))
    monkeypatch.setattr(service, "_account_quota", lambda *args, **kwargs: (12.5, 42))

    updated = service.update_account(
        account.id,
        S3AccountUpdate(
            quota_max_size_gb=1.0,
            quota_max_objects=100,
            user_links=[
                AccountUserLink(user_id=keep_user.id, role=AccountRole.ACCOUNT_ADMINISTRATOR.value),
                AccountUserLink(user_id=add_user.id, role=AccountRole.PORTAL_USER.value),
            ],
        ),
    )
    assert updated.quota_max_size_gb == 12.5
    assert updated.quota_max_objects == 42
    assert quota_calls
    assert sorted(link.user_id for link in updated.user_links) == sorted([keep_user.id, add_user.id])
    # Non-admin UI role should be normalized to UI_USER on assignment
    db_session.refresh(add_user)
    assert add_user.role == UserRole.UI_USER.value
    # Removed user link should be gone
    assert (
        db_session.query(UserS3Account)
        .filter(UserS3Account.account_id == account.id, UserS3Account.user_id == remove_user.id, UserS3Account.is_root.is_(False))
        .first()
        is None
    )


def test_update_account_persists_privileged_bucket_quota_grant(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-target-grant", is_default=True)
    account = _seed_account(db_session, endpoint.id, name="target-grant-acc", rgw_account_id="RGW-TARGET-GRANT")
    assert account.allow_bucket_quota_management is False

    service, _ = _service(db_session)
    monkeypatch.setattr(service, "_account_quota", lambda *args, **kwargs: (None, None))

    updated = service.update_account(
        account.id,
        S3AccountUpdate(allow_bucket_quota_management=True),
    )

    assert updated.allow_bucket_quota_management is True
    db_session.refresh(account)
    assert account.allow_bucket_quota_management is True


def test_delete_account_guardrails_and_success(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-delete", is_default=True)
    account = _seed_account(db_session, endpoint.id, name="delete-acc", rgw_account_id="RGW-DEL-1")
    service, admin = _service(db_session)

    monkeypatch.setattr(service, "_account_usage", lambda *args, **kwargs: (0, 0, 1))
    monkeypatch.setattr(service, "_account_rgw_users", lambda *args, **kwargs: (0, []))
    monkeypatch.setattr(service, "_account_topics_info", lambda *args, **kwargs: (0, []))
    monkeypatch.setattr(service, "_admin_for_account", lambda *args, **kwargs: admin)
    monkeypatch.setattr(service, "_delete_root_user", lambda *args, **kwargs: None)

    with pytest.raises(ValueError, match="still has attached resources"):
        service.delete_account(account.id, delete_rgw=True)

    monkeypatch.setattr(service, "_account_usage", lambda *args, **kwargs: (0, 0, 0))
    service.delete_account(account.id, delete_rgw=True)
    assert admin.deleted_accounts == ["RGW-DEL-1"]
    assert db_session.query(S3Account).filter(S3Account.id == account.id).first() is None


def test_delete_root_user_success_and_failure(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session, name="ceph-root-delete", is_default=True)
    service, admin = _service(db_session)

    account = _seed_account(db_session, endpoint.id, name="delete-root", rgw_account_id="RGW-ROOT-1")
    monkeypatch.setattr(service, "_admin_for_account", lambda *args, **kwargs: admin)
    service._delete_root_user(account)
    assert admin.deleted_users == [("rgw-root-1-admin", None)]

    def _failing_delete(uid: str, tenant: str | None = None):
        raise RGWAdminError("cannot delete")

    admin.delete_user = _failing_delete  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="Unable to delete RGW root user"):
        service._delete_root_user(account)


def test_list_accounts_and_minimal_are_sorted_case_insensitive(db_session):
    endpoint = _seed_endpoint(db_session, name="ceph-sorting", is_default=True)
    _seed_account(db_session, endpoint.id, name="Zulu", rgw_account_id="RGW-SORT-01")
    _seed_account(db_session, endpoint.id, name="alpha", rgw_account_id="RGW-SORT-02")
    _seed_account(db_session, endpoint.id, name="Beta", rgw_account_id="RGW-SORT-03")
    _seed_account(db_session, endpoint.id, name="same", rgw_account_id="RGW-SORT-04")
    _seed_account(db_session, endpoint.id, name="Same", rgw_account_id="RGW-SORT-05")

    service = S3AccountsService(db_session)
    listed = service.list_accounts(
        include_usage_stats=False,
        include_quota=False,
        include_rgw_details=False,
    )
    minimal = service.list_accounts_minimal()

    assert [entry.name for entry in listed] == ["alpha", "Beta", "Same", "same", "Zulu"]
    assert [entry.name for entry in minimal] == ["alpha", "Beta", "Same", "same", "Zulu"]
