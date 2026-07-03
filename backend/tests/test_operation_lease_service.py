# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

from app.db import BackendOperationLease
from app.services.operation_lease_service import OperationLeaseService
from app.utils.time import utcnow


def test_operation_lease_acquire_conflict_release_and_reacquire(db_session):
    service = OperationLeaseService(db_session)

    first = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-a")
    assert first is not None

    conflict = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-b")
    assert conflict is None
    assert service.current_owner("healthchecks:run") == "backend-a"

    service.release(first)

    second = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-b")
    assert second is not None
    assert service.current_owner("healthchecks:run") == "backend-b"


def test_operation_lease_same_owner_renews(db_session):
    service = OperationLeaseService(db_session)

    first = service.acquire("quota-monitor:alerts", ttl_seconds=60, owner="backend-a")
    renewed = service.acquire("quota-monitor:alerts", ttl_seconds=120, owner="backend-a")

    assert first is not None
    assert renewed is not None
    assert renewed.lease_until > first.lease_until
    assert db_session.query(BackendOperationLease).count() == 1


def test_operation_lease_expired_row_can_be_taken(db_session):
    expired = BackendOperationLease(
        operation_name="billing:daily:2026-07-03",
        lease_owner="backend-a",
        lease_until=utcnow() - timedelta(seconds=1),
        acquired_at=utcnow() - timedelta(minutes=10),
        updated_at=utcnow() - timedelta(minutes=10),
    )
    db_session.add(expired)
    db_session.commit()

    service = OperationLeaseService(db_session)
    acquired = service.acquire("billing:daily:2026-07-03", ttl_seconds=60, owner="backend-b")

    assert acquired is not None
    assert service.current_owner("billing:daily:2026-07-03") == "backend-b"
