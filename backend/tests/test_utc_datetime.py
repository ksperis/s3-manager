# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, select
from sqlalchemy.exc import StatementError

from app.db.utc_datetime import UTCDateTime
from app.models.portal_sharing import PortalPublicLinkCreate
from app.utils.time import assume_utc, normalize_utc, utcnow


def test_utcnow_returns_aware_utc() -> None:
    value = utcnow()

    assert value.tzinfo is UTC
    assert value.utcoffset() == timedelta(0)


def test_normalize_utc_rejects_naive_values_and_converts_offsets() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        normalize_utc(datetime(2026, 1, 1))

    value = datetime(2026, 1, 1, 1, tzinfo=timezone(timedelta(hours=1)))

    assert normalize_utc(value) == datetime(2026, 1, 1, tzinfo=UTC)


def test_assume_utc_accepts_naive_values_and_converts_offsets() -> None:
    assert assume_utc(None) is None
    assert assume_utc(datetime(2026, 1, 1)) == datetime(2026, 1, 1, tzinfo=UTC)

    value = datetime(2026, 1, 1, 1, tzinfo=timezone(timedelta(hours=1)))

    assert assume_utc(value) == datetime(2026, 1, 1, tzinfo=UTC)


def test_persisted_api_datetime_requires_an_explicit_timezone() -> None:
    with pytest.raises(ValidationError):
        PortalPublicLinkCreate(
            object_key="report.csv",
            expires_at="2026-08-03T12:00:00",
        )

    payload = PortalPublicLinkCreate(
        object_key="report.csv",
        expires_at="2026-08-03T14:00:00+02:00",
    )

    assert payload.expires_at is not None
    assert normalize_utc(payload.expires_at) == datetime(2026, 8, 3, 12, tzinfo=UTC)


def test_utc_datetime_normalizes_sqlite_round_trip() -> None:
    engine = create_engine("sqlite:///:memory:")
    metadata = MetaData()
    rows = Table(
        "rows",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("occurred_at", UTCDateTime(), nullable=False),
    )
    metadata.create_all(engine)
    source = datetime(2026, 8, 2, 15, 30, tzinfo=timezone(timedelta(hours=2)))

    with engine.begin() as connection:
        connection.execute(rows.insert().values(occurred_at=source))
        stored = connection.execute(select(rows.c.occurred_at)).scalar_one()

    assert stored == datetime(2026, 8, 2, 13, 30, tzinfo=UTC)
    assert stored.tzinfo is UTC


def test_utc_datetime_rejects_naive_values() -> None:
    engine = create_engine("sqlite:///:memory:")
    metadata = MetaData()
    rows = Table(
        "rows",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("occurred_at", UTCDateTime(), nullable=False),
    )
    metadata.create_all(engine)

    with pytest.raises(StatementError, match="timezone-aware"):
        with engine.begin() as connection:
            connection.execute(
                rows.insert().values(occurred_at=datetime(2026, 8, 2, 13, 30))
            )
