"""Drop redundant S3 connection endpoint columns.

Revision ID: 0008_drop_s3_connection_redundant_columns
Revises: 0007_add_s3_connections_custom_endpoint_config
Create Date: 2026-02-12
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_drop_s3_connection_redundant_columns"
down_revision = "0007_add_s3_connections_custom_endpoint_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT id,
                   storage_endpoint_id,
                   endpoint_url,
                   region,
                   force_path_style,
                   verify_tls,
                   provider_hint,
                   custom_endpoint_config
            FROM s3_connections
            """
        )
    ).mappings()
    for row in rows:
        if row["storage_endpoint_id"] is None:
            cfg = {}
            if row["custom_endpoint_config"]:
                try:
                    parsed = json.loads(row["custom_endpoint_config"])
                    if isinstance(parsed, dict):
                        cfg.update(parsed)
                except Exception:
                    cfg = {}
            if "endpoint_url" not in cfg:
                cfg["endpoint_url"] = row["endpoint_url"]
            if "region" not in cfg:
                cfg["region"] = row["region"]
            if "force_path_style" not in cfg:
                cfg["force_path_style"] = bool(row["force_path_style"])
            if "verify_tls" not in cfg:
                cfg["verify_tls"] = bool(row["verify_tls"])
            if "provider" not in cfg and row["provider_hint"]:
                cfg["provider"] = row["provider_hint"]
            conn.execute(
                sa.text(
                    "UPDATE s3_connections SET custom_endpoint_config = :payload WHERE id = :id"
                ),
                {"payload": json.dumps(cfg), "id": row["id"]},
            )
        else:
            conn.execute(
                sa.text(
                    "UPDATE s3_connections SET custom_endpoint_config = NULL WHERE id = :id"
                ),
                {"id": row["id"]},
            )

    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.drop_column("provider_hint")
        batch_op.drop_column("endpoint_url")
        batch_op.drop_column("region")
        batch_op.drop_column("force_path_style")
        batch_op.drop_column("verify_tls")


def downgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.add_column(sa.Column("provider_hint", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("endpoint_url", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("region", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("force_path_style", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        batch_op.add_column(sa.Column("verify_tls", sa.Boolean(), nullable=False, server_default=sa.text("1")))
