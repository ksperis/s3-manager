# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize and constrain Storage Endpoint URLs.

Revision ID: 0118_canonical_storage_endpoint_urls
Revises: 0117_remove_storage_endpoint_admin_endpoint
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0118_canonical_storage_endpoint_urls"
down_revision = "0117_remove_storage_endpoint_admin_endpoint"
branch_labels = None
depends_on = None


storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("endpoint_url", sa.String()),
)


def _canonical_url(endpoint_id: int, value: object) -> str:
    if not isinstance(value, str):
        raise ValueError(
            f"Storage Endpoint {endpoint_id} has an invalid endpoint URL."
        )
    normalized = value.strip().rstrip("/")
    if not normalized:
        raise ValueError(
            f"Storage Endpoint {endpoint_id} has an empty endpoint URL."
        )
    return normalized


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(storage_endpoints.c.id, storage_endpoints.c.endpoint_url)
    ).all()
    canonical_urls: dict[str, int] = {}
    updates: list[tuple[int, str]] = []
    for row in rows:
        normalized = _canonical_url(row.id, row.endpoint_url)
        duplicate_id = canonical_urls.get(normalized)
        if duplicate_id is not None:
            raise ValueError(
                "Storage Endpoints "
                f"{duplicate_id} and {row.id} normalize to the same endpoint URL: "
                f"{normalized}"
            )
        canonical_urls[normalized] = row.id
        updates.append((row.id, normalized))

    for endpoint_id, endpoint_url in updates:
        bind.execute(
            storage_endpoints.update()
            .where(storage_endpoints.c.id == endpoint_id)
            .values(endpoint_url=endpoint_url)
        )

    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_storage_endpoints_endpoint_url_canonical",
            "endpoint_url = trim(endpoint_url) "
            "AND endpoint_url NOT LIKE '%/' "
            "AND length(endpoint_url) > 0",
        )


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_storage_endpoints_endpoint_url_canonical",
            type_="check",
        )
