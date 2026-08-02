# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.db import (
    AccountRole,
    AuditLog,
    PortalAdminRequest,
    S3Account,
    User,
    UserNotification,
    UserRole,
    UserS3Account,
)
from app.models.portal_requests import (
    PortalAccountQuotaChangeRequestCreate,
    PortalUserAccessRequestCreate,
    PortalUserRemovalRequestCreate,
)
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.services.portal_requests_service import PortalRequestConflict, PortalRequestExecutionError, PortalRequestsService


class FakeAccountsService:
    def __init__(self, quota=(10.0, 123)) -> None:
        self.quota = quota
        self.updates = []

    def get_account_quota(self, account):  # noqa: ANN001
        return self.quota

    def update_account(self, account_id, payload):  # noqa: ANN001
        self.updates.append((account_id, payload))
        return None


def test_portal_request_json_requires_an_object():
    assert PortalRequestsService._decode_json('{"status":"ok"}') == {
        "status": "ok"
    }
    with pytest.raises(ValueError):
        PortalRequestsService._decode_json("[]")
    with pytest.raises(ValueError):
        PortalRequestsService._decode_json("{")


def _seed_account(db_session, *, name="Research Account") -> S3Account:
    account = S3Account(name=name, rgw_account_id="RGW00000000000000042")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_user(
    db_session,
    *,
    email: str,
    role: str = UserRole.UI_USER.value,
    active: bool = True,
    full_name: str | None = None,
) -> User:
    user = User(
        email=email,
        full_name=full_name,
        display_name=full_name,
        hashed_password="x" if role != UserRole.UI_NONE.value else None,
        is_active=active,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _portal_access(account: S3Account, user: User) -> AccountAccess:
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=AccountRole.PORTAL_USER.value,
        capabilities=AccountCapabilities(),
    )


def _create_user_request(service: PortalRequestsService, account: S3Account, requester: User):
    return service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            target_name="Jane Viewer",
            target_email="Jane.Viewer@Example.org",
        ),
    )


def test_portal_request_creation_lists_only_requester_and_notifies_admin(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    other = _seed_user(db_session, email="other@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())

    created = _create_user_request(service, account, requester)

    requester_rows = service.list_for_portal_user(requester, _portal_access(account, requester))
    other_rows = service.list_for_portal_user(other, _portal_access(account, other))
    notification = db_session.query(UserNotification).filter(UserNotification.user_id == admin.id).one()
    audit = db_session.query(AuditLog).filter(AuditLog.action == "create_portal_request").one()

    assert created.status == "pending"
    assert requester_rows[0].id == created.id
    assert other_rows == []
    assert notification.notification_type == "portal_request"
    assert notification.subject_type is None
    assert audit.scope == "portal"
    assert audit.account_id == account.id


def test_approve_user_access_creates_placeholder_and_portal_link(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = _create_user_request(service, account, requester)

    approved = service.approve_request(created.id, admin, message="Done")

    target = db_session.query(User).filter(User.email == "jane.viewer@example.org").one()
    link = db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).one()
    message = approved.messages[0]

    assert approved.status == "approved"
    assert approved.result is not None
    assert approved.result["created_user"] is True
    assert target.hashed_password is None
    assert target.role == UserRole.UI_USER.value
    assert link.role == AccountRole.PORTAL_USER.value
    assert message.message == "Done"


def test_approve_user_access_preserves_existing_portal_manager_role(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="jane.viewer@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = _create_user_request(service, account, requester)

    approved = service.approve_request(created.id, admin)

    link = db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).one()
    assert approved.status == "approved"
    assert approved.result is not None
    assert approved.result["created_user"] is False
    assert link.role == AccountRole.ACCOUNT_ADMINISTRATOR.value


def test_approve_user_removal_deletes_portal_user_link_only(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="jane.viewer@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            role=AccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserRemovalRequestCreate(
            request_type="portal_user_removal",
            target_name="Jane Viewer",
            target_email="Jane.Viewer@Example.org",
        ),
    )

    approved = service.approve_request(created.id, admin)

    assert approved.status == "approved"
    assert approved.result is not None
    assert approved.result["target_email"] == "jane.viewer@example.org"
    assert db_session.query(User).filter(User.id == target.id).one()
    assert db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).first() is None


def test_approve_user_removal_refuses_portal_manager_link(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="manager@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            role=AccountRole.ACCOUNT_ADMINISTRATOR.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserRemovalRequestCreate(
            request_type="portal_user_removal",
            target_email="manager@example.org",
        ),
    )

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.query(PortalAdminRequest).filter_by(id=created.id).one()
    assert row.status == "failed"
    assert "Admin account links" in (row.error_message or "")
    assert db_session.query(UserS3Account).filter_by(user_id=target.id, account_id=account.id).one()


def test_approve_user_access_marks_failed_for_inactive_existing_user(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    _seed_user(db_session, email="jane.viewer@example.org", active=False)
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = _create_user_request(service, account, requester)

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.query(PortalAdminRequest).filter_by(id=created.id).one()
    assert row.status == "failed"
    assert "inactive" in (row.error_message or "")


def test_approve_quota_change_applies_new_account_quota_and_keeps_object_quota(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    fake_accounts = FakeAccountsService(quota=(10.0, 123))
    service = PortalRequestsService(db_session, accounts_service=fake_accounts)
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="increase",
            target_quota_value=12,
            target_quota_unit="GiB",
        ),
    )

    approved = service.approve_request(created.id, admin)

    assert approved.status == "approved"
    assert fake_accounts.updates
    account_id, payload = fake_accounts.updates[0]
    assert account_id == account.id
    assert payload.quota_max_size_gb == 12
    assert payload.quota_max_size_unit == "GiB"
    assert payload.quota_max_objects == 123


def test_create_quota_change_rejects_target_below_current_usage(db_session, monkeypatch):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")

    class FakePortalService:
        def __init__(self, db):  # noqa: ANN001
            self.db = db

        def get_usage(self, actor, access):  # noqa: ANN001
            return SimpleNamespace(used_bytes=12 * 1024**3)

    monkeypatch.setattr("app.services.portal_requests_service.PortalService", FakePortalService)
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService(quota=(20.0, 123)))

    with pytest.raises(ValueError, match="space already used"):
        service.create_request(
            requester,
            _portal_access(account, requester),
            PortalAccountQuotaChangeRequestCreate(
                request_type="account_quota_change",
                direction="decrease",
                target_quota_value=10,
                target_quota_unit="GiB",
                reason="Too low",
            ),
        )

    assert db_session.query(PortalAdminRequest).count() == 0


def test_quota_direction_mismatch_fails_request(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    fake_accounts = FakeAccountsService(quota=(10.0, None))
    service = PortalRequestsService(db_session, accounts_service=fake_accounts)
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="decrease",
            target_quota_value=12,
            target_quota_unit="GiB",
            reason="Wrong direction",
        ),
    )

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.query(PortalAdminRequest).filter_by(id=created.id).one()
    assert row.status == "failed"
    assert fake_accounts.updates == []


def test_reject_and_conflict_on_final_request(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session, accounts_service=FakeAccountsService())
    created = _create_user_request(service, account, requester)

    rejected = service.reject_request(created.id, admin, message="Missing information")

    assert rejected.status == "rejected"
    assert rejected.messages[0].message == "Missing information"
    with pytest.raises(PortalRequestConflict):
        service.approve_request(created.id, admin)
