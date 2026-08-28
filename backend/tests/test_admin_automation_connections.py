# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.db import (
    S3Connection,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
)
from app.models.admin_automation import (
    AccountLinkApply,
    AdminAutomationApplyRequest,
    S3ConnectionApply,
    S3ConnectionMatch,
    S3ConnectionSpec,
)
from app.services.admin_automation_service import AdminAutomationService
from app.services.mappers.s3_connection import mask_access_key_id
from app.utils.s3_connection_endpoint import parse_custom_endpoint_config


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def test_access_key_masking_is_canonical() -> None:
    assert mask_access_key_id(None) == ""
    assert mask_access_key_id(" short ") == "***rt"
    assert mask_access_key_id(" 1234567890 ") == "1234***7890"


@pytest.mark.parametrize(
    "factory",
    [
        lambda: S3ConnectionMatch(id=1, name="ambiguous-connection"),
        lambda: S3ConnectionSpec(
            storage_endpoint_id=1,
            endpoint_url="https://ambiguous-connection.example.test",
        ),
    ],
)
def test_connection_contract_rejects_ambiguous_references(factory):
    with pytest.raises(ValidationError):
        factory()


def _user(db_session) -> User:
    user = User(
        email="automation-connections@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _connection(
    db_session,
    user: User,
    *,
    name: str,
    shared: bool,
    storage_endpoint_id: int | None = None,
) -> S3Connection:
    connection = S3Connection(
        created_by_user_id=user.id,
        name=name,
        is_shared=shared,
        access_manager=True,
        access_browser=True,
        access_key_id=f"AK-{name}-{shared}",
        secret_access_key=f"SK-{name}-{shared}",
        storage_endpoint_id=storage_endpoint_id,
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="Automation managed endpoint",
        endpoint_url="https://automation-managed.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_automation_cannot_find_or_delete_private_connection_by_id(db_session):
    user = _user(db_session)
    private = _connection(db_session, user, name="private-id-target", shared=False)
    service = AdminAutomationService(db_session)
    item = S3ConnectionApply(
        state="absent",
        match=S3ConnectionMatch(id=private.id),
    )

    result = service.apply(
        AdminAutomationApplyRequest(s3_connections=[item]),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "skipped"
    assert db_session.query(S3Connection).filter(S3Connection.id == private.id).one()


def test_connection_handler_name_lookup_selects_shared_connection_only(db_session):
    user = _user(db_session)
    private = _connection(db_session, user, name="same-name", shared=False)
    shared = _connection(db_session, user, name="same-name", shared=True)
    service = AdminAutomationService(db_session)

    found = service.s3_connection_handler._find_s3_connection(
        S3ConnectionApply(state="absent", match=S3ConnectionMatch(name="same-name")),
    )

    assert found is not None and found.id == shared.id
    assert found.id != private.id


def test_connection_dry_run_rejects_unknown_managed_endpoint(db_session):
    user = _user(db_session)

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            dry_run=True,
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(name="missing-managed-endpoint"),
                    spec=S3ConnectionSpec(
                        name="missing-managed-endpoint",
                        storage_endpoint_id=999_999,
                        access_key_id="AK-MISSING-ENDPOINT",
                        secret_access_key="SK-MISSING-ENDPOINT",
                    ),
                )
            ],
        ),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is False
    assert result.results[0].error == "Storage endpoint not found"


def test_connection_update_rejects_custom_fields_while_managed(db_session):
    user = _user(db_session)
    endpoint = _endpoint(db_session)
    connection = _connection(
        db_session,
        user,
        name="managed-endpoint-update",
        shared=True,
        storage_endpoint_id=endpoint.id,
    )

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            dry_run=True,
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(id=connection.id),
                    spec=S3ConnectionSpec(
                        endpoint_url="https://ignored-custom.example.test"
                    ),
                )
            ],
        ),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is False
    assert result.results[0].error == (
        "Custom endpoint fields cannot be combined with a managed storage endpoint"
    )


def test_connection_update_detaches_managed_endpoint_explicitly(
    db_session,
    monkeypatch,
):
    user = _user(db_session)
    endpoint = _endpoint(db_session)
    connection = _connection(
        db_session,
        user,
        name="detach-managed-endpoint",
        shared=True,
        storage_endpoint_id=endpoint.id,
    )
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_connection_handler.s3_connections,
        "_refresh_detected_capabilities",
        lambda _connection: None,
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(id=connection.id),
                    spec=S3ConnectionSpec(
                        storage_endpoint_id=None,
                        endpoint_url="https://detached-custom.example.test/",
                        region="custom-region",
                        provider_hint="custom-provider",
                    ),
                )
            ]
        ),
        current_user=user,
        audit_service=_Audit(),
    )

    db_session.refresh(connection)
    config = parse_custom_endpoint_config(connection.custom_endpoint_config)
    assert result.success is True
    assert connection.storage_endpoint_id is None
    assert config.endpoint_url == "https://detached-custom.example.test"
    assert config.region == "custom-region"
    assert config.provider == "custom-provider"


def test_connection_credential_update_uses_service_without_audit_secrets(
    db_session,
    monkeypatch,
):
    user = _user(db_session)
    connection = _connection(
        db_session,
        user,
        name="automation-credential-update",
        shared=True,
    )
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_connection_handler.s3_connections,
        "_refresh_detected_capabilities",
        lambda _connection: None,
    )
    audit = _Audit()

    result = service.apply(
        AdminAutomationApplyRequest(
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(id=connection.id),
                    update_credentials=True,
                    spec=S3ConnectionSpec(
                        access_key_id="AK-AUTOMATION-REPLACEMENT",
                        secret_access_key="SK-AUTOMATION-REPLACEMENT",
                    ),
                )
            ]
        ),
        current_user=user,
        audit_service=audit,
    )

    db_session.refresh(connection)
    metadata = audit.actions[0]["metadata"]
    assert result.success is True
    assert connection.access_key_id == "AK-AUTOMATION-REPLACEMENT"
    assert connection.secret_access_key == "SK-AUTOMATION-REPLACEMENT"
    assert metadata == {
        "credential_fields_updated": ["access_key_id", "secret_access_key"]
    }


def test_connection_credential_dry_run_respects_managed_source_lock(
    db_session,
    monkeypatch,
):
    user = _user(db_session)
    connection = _connection(
        db_session,
        user,
        name="automation-credential-locked",
        shared=True,
    )
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_connection_handler.s3_connections,
        "is_active_managed_source",
        lambda connection_id: connection_id == connection.id,
    )

    result = service.apply(
        AdminAutomationApplyRequest(
            dry_run=True,
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(id=connection.id),
                    update_credentials=True,
                    spec=S3ConnectionSpec(
                        access_key_id="AK-AUTOMATION-BLOCKED",
                    ),
                )
            ],
        ),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is False
    assert "credentials are locked" in (result.results[0].error or "")


def test_connection_remediation_uses_canonical_update_contract(db_session):
    user = _user(db_session)
    connection = _connection(
        db_session,
        user,
        name="automation-remediation",
        shared=True,
    )
    connection.is_active = False
    connection.access_manager = False
    connection.remediation_required = True
    connection.remediation_reason = "Manager access requires explicit activation"
    db_session.commit()
    audit = _Audit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            s3_connections=[
                S3ConnectionApply(
                    match=S3ConnectionMatch(id=connection.id),
                    spec=S3ConnectionSpec(
                        remediation_action="activate_manager",
                    ),
                )
            ]
        ),
        current_user=user,
        audit_service=audit,
    )

    db_session.refresh(connection)
    assert result.success is True
    assert connection.is_active is True
    assert connection.access_manager is True
    assert connection.remediation_required is False
    assert audit.actions[0]["metadata"] == {
        "remediation_action": "activate_manager"
    }


@pytest.mark.parametrize("legacy_field", ["is_shared", "access_manager", "access_browser"])
def test_automation_connection_spec_rejects_visibility_and_access_flags(legacy_field):
    with pytest.raises(ValidationError):
        S3ConnectionSpec.model_validate(
            {
                "name": "invalid-spec",
                "endpoint_url": "https://automation.invalid.test",
                "access_key_id": "AK-INVALID",
                "secret_access_key": "SK-INVALID",
                legacy_field: True,
            }
        )


@pytest.mark.parametrize("removed_field", ["account_admin", "account_role"])
def test_automation_account_link_rejects_removed_role_fields(removed_field):
    with pytest.raises(ValidationError):
        AccountLinkApply.model_validate(
            {
                "user": {"id": 1},
                "account": {"id": 2},
                "role": "portal_user",
                removed_field: False,
            }
        )


def test_automation_present_account_link_requires_canonical_role():
    with pytest.raises(ValidationError):
        AccountLinkApply.model_validate(
            {
                "user": {"id": 1},
                "account": {"id": 2},
            }
        )


def test_automation_creates_shared_manager_only_connection(db_session, monkeypatch):
    user = _user(db_session)
    service = AdminAutomationService(db_session)
    monkeypatch.setattr(
        service.s3_connection_handler.s3_connections,
        "_refresh_detected_capabilities",
        lambda connection: None,
    )
    item = S3ConnectionApply(
        match=S3ConnectionMatch(name="automation-created"),
        spec=S3ConnectionSpec(
            name="automation-created",
            endpoint_url="https://automation-created.example.test",
            access_key_id="AK-AUTOMATION-CREATED",
            secret_access_key="SK-AUTOMATION-CREATED",
        ),
    )

    result = service.apply(
        AdminAutomationApplyRequest(s3_connections=[item]),
        current_user=user,
        audit_service=_Audit(),
    )

    assert result.success is True
    created = db_session.query(S3Connection).filter(S3Connection.name == "automation-created").one()
    assert created.is_shared is True
    assert created.access_manager is True
    assert created.access_browser is False
    assert created.remediation_required is False
