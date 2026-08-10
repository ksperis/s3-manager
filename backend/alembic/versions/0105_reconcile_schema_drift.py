# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Reconcile storage coordinate types and orphan permission columns.

Revision ID: 0105_reconcile_schema_drift
Revises: 0104_canonical_s3_account_identities
Create Date: 2026-08-10
"""

from __future__ import annotations

import math
import os
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0105_reconcile_schema_drift"
down_revision = "0104_canonical_s3_account_identities"
branch_labels = None
depends_on = None


_OBSOLETE_PERMISSION_COLUMN = "can_access_manager_bucket_usage_stats"
_BACKUP_VERIFIED_ENV = "S3_MANAGER_DB_BACKUP_VERIFIED"
_storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("name", sa.String()),
    sa.column("latitude"),
    sa.column("longitude"),
)


def _columns(bind: Any, table_name: str) -> dict[str, dict[str, Any]]:
    return {
        str(column["name"]): column
        for column in sa.inspect(bind).get_columns(table_name)
    }


def _is_float_type(column: dict[str, Any]) -> bool:
    return isinstance(column["type"], sa.Float)


def _parse_coordinate(
    value: Any,
    *,
    minimum: float,
    maximum: float,
) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        parsed = float(value)
    except (OverflowError, TypeError, ValueError):
        return None
    if not math.isfinite(parsed) or parsed < minimum or parsed > maximum:
        return None
    return parsed


def _canonical_coordinates(bind: Any) -> list[tuple[int, float | None, float | None]]:
    rows = bind.execute(
        sa.select(
            _storage_endpoints.c.id,
            _storage_endpoints.c.name,
            _storage_endpoints.c.latitude,
            _storage_endpoints.c.longitude,
        ).order_by(_storage_endpoints.c.id.asc())
    ).all()
    canonical: list[tuple[int, float | None, float | None]] = []
    invalid: list[str] = []
    for row in rows:
        latitude = _parse_coordinate(
            row.latitude,
            minimum=-90,
            maximum=90,
        )
        longitude = _parse_coordinate(
            row.longitude,
            minimum=-180,
            maximum=180,
        )
        if row.latitude is not None and not (
            isinstance(row.latitude, str) and not row.latitude.strip()
        ) and latitude is None:
            invalid.append(f"{row.id} ({row.name}): latitude={row.latitude!r}")
        if row.longitude is not None and not (
            isinstance(row.longitude, str) and not row.longitude.strip()
        ) and longitude is None:
            invalid.append(f"{row.id} ({row.name}): longitude={row.longitude!r}")
        canonical.append((int(row.id), latitude, longitude))

    if invalid:
        details = ", ".join(invalid[:10])
        suffix = " ..." if len(invalid) > 10 else ""
        raise RuntimeError(
            "Cannot canonicalize storage endpoint coordinates: "
            f"{details}{suffix}. Repair latitude/longitude before upgrading."
        )
    return canonical


def _alter_coordinate_types(bind: Any, target_type: sa.types.TypeEngine) -> None:
    columns = _columns(bind, "storage_endpoints")
    changes = {
        name: column
        for name, column in columns.items()
        if name in {"latitude", "longitude"}
        and (
            not _is_float_type(column)
            if isinstance(target_type, sa.Float)
            else _is_float_type(column)
        )
    }
    if not changes:
        return
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        for name, column in changes.items():
            postgresql_cast = (
                f"CAST({name} AS DOUBLE PRECISION)"
                if isinstance(target_type, sa.Float)
                else f"CAST({name} AS TEXT)"
            )
            batch_op.alter_column(
                name,
                existing_type=column["type"],
                type_=target_type,
                existing_nullable=bool(column["nullable"]),
                postgresql_using=postgresql_cast,
            )


def _drop_obsolete_permission(bind: Any, table_name: str) -> None:
    if _OBSOLETE_PERMISSION_COLUMN not in _columns(bind, table_name):
        return
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.drop_column(_OBSOLETE_PERMISSION_COLUMN)


def _require_verified_backup(bind: Any) -> None:
    tables = [
        table_name
        for table_name in ("users", "ui_groups")
        if _OBSOLETE_PERMISSION_COLUMN in _columns(bind, table_name)
    ]
    if not tables:
        return
    backup_verified = str(os.getenv(_BACKUP_VERIFIED_ENV) or "").strip().lower()
    if backup_verified not in {"1", "true", "yes", "on"}:
        raise RuntimeError(
            "Schema drift cleanup will drop obsolete permission data from "
            f"{', '.join(tables)}. Verify a restorable database backup, then set "
            f"{_BACKUP_VERIFIED_ENV}=true."
        )


def _restore_obsolete_permission(bind: Any, table_name: str) -> None:
    if _OBSOLETE_PERMISSION_COLUMN in _columns(bind, table_name):
        return
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                _OBSOLETE_PERMISSION_COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )


def upgrade() -> None:
    bind = op.get_bind()
    _require_verified_backup(bind)
    canonical = _canonical_coordinates(bind)
    for endpoint_id, latitude, longitude in canonical:
        bind.execute(
            _storage_endpoints.update()
            .where(_storage_endpoints.c.id == endpoint_id)
            .values(latitude=latitude, longitude=longitude)
        )
    _alter_coordinate_types(bind, sa.Float())
    _drop_obsolete_permission(bind, "users")
    _drop_obsolete_permission(bind, "ui_groups")


def downgrade() -> None:
    bind = op.get_bind()
    _alter_coordinate_types(bind, sa.String())
    _restore_obsolete_permission(bind, "users")
    _restore_obsolete_permission(bind, "ui_groups")
