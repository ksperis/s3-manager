"""Add custom endpoint config for S3 connections.

Revision ID: 0007_add_s3_connections_custom_endpoint_config
Revises: 0006_add_s3_connections_visibility
Create Date: 2026-02-12
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0007_add_s3_connections_custom_endpoint_config"
down_revision = "0006_add_s3_connections_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.add_column(sa.Column("custom_endpoint_config", sa.Text(), nullable=True))
        batch_op.alter_column("endpoint_url", existing_type=sa.String(), nullable=True)

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT id, storage_endpoint_id, endpoint_url, region, force_path_style, verify_tls
            FROM s3_connections
            """
        )
    ).mappings()
    for row in rows:
        if row["storage_endpoint_id"] is None:
            payload = json.dumps(
                {
                    "endpoint_url": row["endpoint_url"],
                    "region": row["region"],
                    "force_path_style": bool(row["force_path_style"]),
                    "verify_tls": bool(row["verify_tls"]),
                }
            )
            conn.execute(
                sa.text(
                    "UPDATE s3_connections SET custom_endpoint_config = :payload WHERE id = :id"
                ),
                {"payload": payload, "id": row["id"]},
            )
        else:
            conn.execute(
                sa.text(
                    "UPDATE s3_connections SET endpoint_url = NULL, region = NULL, custom_endpoint_config = NULL WHERE id = :id"
                ),
                {"id": row["id"]},
            )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.drop_column("custom_endpoint_config")
        batch_op.alter_column("endpoint_url", existing_type=sa.String(), nullable=False)
