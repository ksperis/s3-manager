# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account, User, UserRole
from app.routers.browser import _record_browser_or_portal_action


class FakeAuditService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record_action(self, **kwargs):  # noqa: ANN003
        self.calls.append(kwargs)


def _actor() -> User:
    return User(
        id=1,
        email="portal-user@example.com",
        role=UserRole.UI_USER.value,
        is_active=True,
    )


def _account() -> S3Account:
    account = S3Account(name="portal-account")
    account.id = 101
    return account


def test_browser_audit_keeps_browser_scope_without_portal_context():
    audit = FakeAuditService()
    account = _account()

    _record_browser_or_portal_action(
        audit,
        actor=_actor(),
        account=account,
        bucket_name="research-data",
        action="download_object",
        entity_type="object",
        entity_id="research-data/report.csv",
        metadata={"version_id": "v1"},
    )

    assert audit.calls == [
        {
            "user": audit.calls[0]["user"],
            "scope": "browser",
            "action": "download_object",
            "entity_type": "object",
            "entity_id": "research-data/report.csv",
            "account": account,
            "metadata": {"version_id": "v1"},
            "status": "success",
            "message": None,
        }
    ]


def test_browser_audit_maps_portal_context_to_portal_scope_and_actions():
    audit = FakeAuditService()
    account = _account()
    account._portal_browser_role = "portal_user"  # type: ignore[attr-defined]

    _record_browser_or_portal_action(
        audit,
        actor=_actor(),
        account=account,
        bucket_name="research-data",
        action="upload_via_proxy",
        portal_action="upload_object",
        entity_type="object",
        entity_id="research-data/report.csv",
        metadata={"size_bytes": 128},
        status="failure",
        message="S3 upload failed",
    )

    assert audit.calls == [
        {
            "user": audit.calls[0]["user"],
            "scope": "portal",
            "action": "upload_object",
            "entity_type": "object",
            "entity_id": "research-data/report.csv",
            "account": account,
            "metadata": {"storage_space_id": "research-data", "size_bytes": 128},
            "status": "failure",
            "message": "S3 upload failed",
        }
    ]
