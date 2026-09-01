# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import ManagerAccountRole, PortalAccountRole, User, UserRole, UserS3Account
from app.scripts import reconcile_portal_iam as script
from tests.s3_account_factory import make_s3_account


class _FakePortalService:
    def __init__(self, *, failing_user_id: int | None = None) -> None:
        self.failing_user_id = failing_user_id
        self.calls: list[tuple[int, int, str]] = []

    def provision_portal_user(self, user, account, role):
        if user.id == self.failing_user_id:
            raise RuntimeError("simulated IAM failure")
        self.calls.append((int(user.id), int(account.id), str(role)))

    def sync_existing_portal_user_access(self, user, account, role):
        self.calls.append((int(user.id), int(account.id), str(role)))


def _seed_access(db_session):
    account = make_s3_account(db_session, name="reconcile-account", rgw_account_id="RGW-RECONCILE")
    administrator = User(
        email="reconcile-admin@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    viewer = User(
        email="reconcile-viewer@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, administrator, viewer])
    db_session.flush()
    db_session.add_all(
        [
            UserS3Account(
                user_id=administrator.id,
                account_id=account.id,
                manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
                portal_role=None,
            ),
            UserS3Account(
                user_id=viewer.id,
                account_id=account.id,
                manager_role=None,
                portal_role=PortalAccountRole.PORTAL_USER.value,
            ),
        ]
    )
    db_session.commit()
    return account, administrator, viewer


def test_reconcile_portal_iam_dry_run_then_apply_keeps_db_roles(monkeypatch, db_session):
    account, administrator, viewer = _seed_access(db_session)
    portal = _FakePortalService()
    monkeypatch.setattr(script, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(script, "PortalService", lambda _db: portal)
    monkeypatch.setattr(script, "_portal_compatible", lambda _account: True)

    dry_run = script.reconcile_portal_iam(dry_run=True, account_id=account.id)
    assert dry_run[0]["planned"] == 1
    assert portal.calls == []

    applied = script.reconcile_portal_iam(dry_run=False, account_id=account.id)
    assert applied[0]["reconciled"] == 1
    assert portal.calls == [
        (viewer.id, account.id, PortalAccountRole.PORTAL_USER.value),
    ]
    roles = {
        row.user_id: (row.manager_role, row.portal_role)
        for row in db_session.query(UserS3Account).filter(UserS3Account.account_id == account.id).all()
    }
    assert roles == {
        administrator.id: (ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value, None),
        viewer.id: (None, PortalAccountRole.PORTAL_USER.value),
    }


def test_reconcile_portal_iam_reports_partial_errors_and_continues(monkeypatch, db_session):
    account, administrator, viewer = _seed_access(db_session)
    account_id = int(account.id)
    viewer_id = int(viewer.id)
    portal = _FakePortalService(failing_user_id=viewer.id)
    monkeypatch.setattr(script, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(script, "PortalService", lambda _db: portal)
    monkeypatch.setattr(script, "_portal_compatible", lambda _account: True)

    summaries = script.reconcile_portal_iam(dry_run=False, account_id=account_id)

    assert summaries[0]["reconciled"] == 0
    assert summaries[0]["errors"] == [
        {"user_id": viewer_id, "error": "simulated IAM failure"}
    ]
    assert portal.calls == []
