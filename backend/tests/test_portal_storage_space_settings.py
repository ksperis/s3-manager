# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.db import AccountRole, PortalStorageSpaceMetadata, S3Account, User
from app.models.portal import PortalStorageSpaceSettingsUpdate
from app.routers.dependencies import AccountAccess, AccountCapabilities
from app.services import s3_client
from app.services.portal_service import PortalService


def _setup(db_session, *, archived: bool = False):
    account = S3Account(
        name="portal-space-settings",
        rgw_account_id="RGW-SPACE-SETTINGS",
    )
    manager = User(
        email="space-settings@example.com",
        hashed_password="x",
        role="ui_user",
    )
    db_session.add_all([account, manager])
    db_session.flush()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="research-data",
        display_name="Research data",
        visibility="shared",
    )
    if archived:
        from app.utils.time import utcnow

        metadata.archived_at = utcnow()
    db_session.add(metadata)
    db_session.commit()
    return account, manager, metadata


def _access(account: S3Account, user: User, role: str) -> AccountAccess:
    is_manager = role == AccountRole.PORTAL_MANAGER.value
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        role=role,
        capabilities=AccountCapabilities(can_manage_buckets=is_manager),
    )


def _prepare_service(monkeypatch, service: PortalService, bucket_name: str = "research-data") -> None:
    monkeypatch.setattr(
        service,
        "_resolve_storage_space_bucket_name",
        lambda *_args, **_kwargs: bucket_name,
    )
    monkeypatch.setattr(service, "_require_storage_space_manager", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "get_portal_credentials", lambda *_args, **_kwargs: ("AK", "SK"))


def _install_s3_state(monkeypatch, *, versioning, rules):
    state = {"versioning": versioning, "rules": list(rules)}

    monkeypatch.setattr(s3_client, "get_bucket_versioning", lambda *_args, **_kwargs: state["versioning"])
    monkeypatch.setattr(s3_client, "get_bucket_lifecycle", lambda *_args, **_kwargs: list(state["rules"]))

    def put_lifecycle(_bucket_name, *, rules, **_kwargs):
        state["rules"] = list(rules)

    def delete_lifecycle(_bucket_name, **_kwargs):
        state["rules"] = []

    def set_versioning(_bucket_name, *, enabled, **_kwargs):
        state["versioning"] = "Enabled" if enabled else "Suspended"

    monkeypatch.setattr(s3_client, "put_bucket_lifecycle", put_lifecycle)
    monkeypatch.setattr(s3_client, "delete_bucket_lifecycle", delete_lifecycle)
    monkeypatch.setattr(s3_client, "set_bucket_versioning", set_versioning)
    return state


def test_owner_reads_storage_space_settings_without_update_rights(monkeypatch, db_session):
    account, owner, _metadata = _setup(db_session)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    _install_s3_state(
        monkeypatch,
        versioning="Enabled",
        rules=service._portal_bucket_lifecycle_rules(45),
    )

    settings = service.get_storage_space_settings(
        owner,
        _access(account, owner, AccountRole.PORTAL_USER.value),
        "research-data",
    )

    assert settings.versioning_status == "Enabled"
    assert settings.lifecycle_enabled is True
    assert settings.version_history_retention_days == 45
    assert settings.can_update is False


def test_missing_versioning_configuration_is_reported_as_disabled(monkeypatch, db_session):
    account, owner, _metadata = _setup(db_session)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    _install_s3_state(monkeypatch, versioning=None, rules=[])

    settings = service.get_storage_space_settings(
        owner,
        _access(account, owner, AccountRole.PORTAL_USER.value),
        "research-data",
    )

    assert settings.versioning_enabled is False
    assert settings.versioning_status == "Disabled"
    assert settings.lifecycle_enabled is False
    assert settings.version_history_retention_days > 0


def test_manager_updates_managed_rules_and_preserves_foreign_lifecycle(monkeypatch, db_session):
    account, manager, _metadata = _setup(db_session)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    foreign_rule = {"ID": "ArchiveReports", "Status": "Enabled", "Prefix": "reports/"}
    state = _install_s3_state(
        monkeypatch,
        versioning="Suspended",
        rules=[foreign_rule, *service._portal_bucket_lifecycle_rules(30)],
    )

    updated = service.update_storage_space_settings(
        manager,
        _access(account, manager, AccountRole.PORTAL_MANAGER.value),
        "research-data",
        PortalStorageSpaceSettingsUpdate(
            versioning_enabled=True,
            lifecycle_enabled=True,
            version_history_retention_days=45,
        ),
    )

    assert state["versioning"] == "Enabled"
    assert state["rules"][0] == foreign_rule
    assert {rule["ID"] for rule in state["rules"][1:]} == {"ExpireDeleteMarkers", "ExpireOldVersions"}
    expiration_rule = next(rule for rule in state["rules"] if rule["ID"] == "ExpireOldVersions")
    assert expiration_rule["NoncurrentVersionExpiration"]["NoncurrentDays"] == 45
    assert updated.can_update is True


def test_manager_disables_only_portal_lifecycle_rules(monkeypatch, db_session):
    account, manager, _metadata = _setup(db_session)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    foreign_rule = {"ID": "ArchiveReports", "Status": "Enabled", "Prefix": "reports/"}
    state = _install_s3_state(
        monkeypatch,
        versioning="Enabled",
        rules=[foreign_rule, *service._portal_bucket_lifecycle_rules(90)],
    )

    updated = service.update_storage_space_settings(
        manager,
        _access(account, manager, AccountRole.PORTAL_MANAGER.value),
        "research-data",
        PortalStorageSpaceSettingsUpdate(
            versioning_enabled=False,
            lifecycle_enabled=False,
            version_history_retention_days=90,
        ),
    )

    assert state["versioning"] == "Suspended"
    assert state["rules"] == [foreign_rule]
    assert updated.lifecycle_enabled is False


def test_storage_space_settings_require_project_manager_and_active_space(monkeypatch, db_session):
    account, owner, _metadata = _setup(db_session, archived=True)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    payload = PortalStorageSpaceSettingsUpdate(
        versioning_enabled=True,
        lifecycle_enabled=True,
        version_history_retention_days=90,
    )

    with pytest.raises(RuntimeError, match="Portal manager rights required"):
        service.update_storage_space_settings(
            owner,
            _access(account, owner, AccountRole.PORTAL_USER.value),
            "research-data",
            payload,
        )

    with pytest.raises(RuntimeError, match="archived"):
        service.update_storage_space_settings(
            owner,
            _access(account, owner, AccountRole.PORTAL_MANAGER.value),
            "research-data",
            payload,
        )


def test_versioning_failure_restores_previous_lifecycle(monkeypatch, db_session):
    account, manager, _metadata = _setup(db_session)
    service = PortalService(db_session)
    _prepare_service(monkeypatch, service)
    previous_rules = [{"ID": "ArchiveReports", "Status": "Enabled", "Prefix": "reports/"}]
    state = _install_s3_state(monkeypatch, versioning="Suspended", rules=previous_rules)
    lifecycle_writes: list[list[dict]] = []

    def put_lifecycle(_bucket_name, *, rules, **_kwargs):
        lifecycle_writes.append(list(rules))
        state["rules"] = list(rules)

    monkeypatch.setattr(s3_client, "put_bucket_lifecycle", put_lifecycle)
    monkeypatch.setattr(
        s3_client,
        "set_bucket_versioning",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("versioning failed")),
    )

    with pytest.raises(RuntimeError, match="Previous lifecycle settings were restored"):
        service.update_storage_space_settings(
            manager,
            _access(account, manager, AccountRole.PORTAL_MANAGER.value),
            "research-data",
            PortalStorageSpaceSettingsUpdate(
                versioning_enabled=True,
                lifecycle_enabled=True,
                version_history_retention_days=45,
            ),
        )

    assert lifecycle_writes[-1] == previous_rules
    assert state["rules"] == previous_rules


def test_only_portal_manager_iam_policy_can_change_space_settings(db_session):
    service = PortalService(db_session)

    owner_actions = service._storage_space_role_actions("Owner")
    manager_actions = service._storage_space_role_actions("Manager")

    assert "s3:PutBucketVersioning" not in owner_actions
    assert "s3:PutLifecycleConfiguration" not in owner_actions
    assert "s3:PutBucketVersioning" in manager_actions
    assert "s3:PutLifecycleConfiguration" in manager_actions
    assert "s3:PutBucketVersioning" in service._storage_space_policy_actions()
    assert "s3:PutLifecycleConfiguration" in service._storage_space_policy_actions()
    assert "s3:GetLifecycleConfiguration" in service._storage_space_policy_actions()
