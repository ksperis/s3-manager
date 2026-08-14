# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.db import StorageEndpoint, StorageProvider, User, UserRole
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    StorageEndpointApply,
    StorageEndpointMatch,
    StorageEndpointSpec,
)
from app.services.admin_automation_service import AdminAutomationService
from app.services.admin_automation_storage_endpoint_resolver import (
    resolve_storage_endpoint,
)


class _Audit:
    def __init__(self) -> None:
        self.actions: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.actions.append(kwargs)


def _actor(db_session) -> User:
    actor = User(
        email="storage-endpoint-automation@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )
    db_session.add(actor)
    db_session.commit()
    db_session.refresh(actor)
    return actor


def _endpoint(db_session, **overrides) -> StorageEndpoint:
    values = {
        "name": "Existing endpoint",
        "endpoint_url": "https://existing-endpoint.example.com",
        "provider": StorageProvider.CEPH.value,
        "force_path_style": False,
        "verify_tls": True,
        "is_default": False,
        "is_editable": True,
    }
    values.update(overrides)
    endpoint = StorageEndpoint(**values)
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def test_automation_creates_endpoint_with_coordinates_and_default(db_session):
    actor = _actor(db_session)
    audit = _Audit()

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            storage_endpoints=[
                StorageEndpointApply(
                    match=StorageEndpointMatch(name="Created endpoint"),
                    spec=StorageEndpointSpec(
                        endpoint_url="https://created-endpoint.example.com",
                        provider=StorageProvider.OTHER,
                        latitude=48.8566,
                        longitude=2.3522,
                        set_default=True,
                    ),
                )
            ]
        ),
        current_user=actor,
        audit_service=audit,
    )

    endpoint = (
        db_session.query(StorageEndpoint)
        .filter(StorageEndpoint.name == "Created endpoint")
        .one()
    )
    assert result.success is True
    assert result.results[0].action == "created"
    assert endpoint.latitude == 48.8566
    assert endpoint.longitude == 2.3522
    assert endpoint.is_default is True
    assert [action["action"] for action in audit.actions] == [
        "create_storage_endpoint"
    ]


def test_automation_updates_endpoint_coordinates(db_session):
    actor = _actor(db_session)
    endpoint = _endpoint(db_session, latitude=None, longitude=None)

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            storage_endpoints=[
                StorageEndpointApply(
                    match=StorageEndpointMatch(id=endpoint.id),
                    spec=StorageEndpointSpec(latitude=43.3, longitude=5.4),
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    db_session.refresh(endpoint)
    assert result.success is True
    assert result.results[0].diff == {
        "latitude": {"from": None, "to": 43.3},
        "longitude": {"from": None, "to": 5.4},
    }
    assert endpoint.latitude == 43.3
    assert endpoint.longitude == 5.4


def test_automation_skips_equal_provider_and_secret_values(db_session):
    actor = _actor(db_session)
    endpoint = _endpoint(
        db_session,
        admin_secret_key="unchanged-secret",
    )

    result = AdminAutomationService(db_session).apply(
        AdminAutomationApplyRequest(
            storage_endpoints=[
                StorageEndpointApply(
                    match=StorageEndpointMatch(id=endpoint.id),
                    spec=StorageEndpointSpec(
                        provider=StorageProvider.CEPH,
                        admin_secret_key="unchanged-secret",
                    ),
                    update_secrets=True,
                )
            ]
        ),
        current_user=actor,
        audit_service=_Audit(),
    )

    assert result.success is True
    assert result.results[0].action == "skipped"
    assert result.results[0].diff is None


def test_shared_endpoint_resolver_normalizes_urls_and_rejects_missing_references(
    db_session,
):
    endpoint = _endpoint(db_session)

    resolved = resolve_storage_endpoint(
        db_session,
        endpoint_url=f"{endpoint.endpoint_url}/",
    )

    assert resolved is not None and resolved.id == endpoint.id
    with pytest.raises(ValueError, match="Storage endpoint not found"):
        resolve_storage_endpoint(
            db_session,
            endpoint_name="Missing endpoint",
        )


def test_storage_endpoint_match_rejects_ambiguous_selectors():
    with pytest.raises(ValidationError, match="requires exactly one"):
        StorageEndpointMatch(
            id=1,
            name="Ambiguous endpoint",
        )
