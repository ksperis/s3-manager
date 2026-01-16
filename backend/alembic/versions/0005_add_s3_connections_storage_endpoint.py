"""Link S3 connections to storage endpoints.

Revision ID: 0005_add_s3_connections_storage_endpoint
Revises: 0004_add_user_s3_connections
Create Date: 2026-02-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "0005_add_s3_connections_storage_endpoint"
down_revision = "0004_add_user_s3_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("s3_connections")}
    existing_indexes = {idx["name"] for idx in inspector.get_indexes("s3_connections")}
    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("s3_connections")}

    if "storage_endpoint_id" not in existing_columns:
        op.add_column("s3_connections", sa.Column("storage_endpoint_id", sa.Integer(), nullable=True))

    if "ix_s3_connections_storage_endpoint_id" not in existing_indexes:
        op.create_index(
            "ix_s3_connections_storage_endpoint_id",
            "s3_connections",
            ["storage_endpoint_id"],
            unique=False,
        )
    if "fk_s3_connections_storage_endpoint" not in existing_fks:
        with op.batch_alter_table("s3_connections") as batch_op:
            batch_op.create_foreign_key(
                "fk_s3_connections_storage_endpoint",
                "storage_endpoints",
                ["storage_endpoint_id"],
                ["id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections") as batch_op:
        batch_op.drop_constraint("fk_s3_connections_storage_endpoint", type_="foreignkey")
    op.drop_index("ix_s3_connections_storage_endpoint_id", table_name="s3_connections")
    op.drop_column("s3_connections", "storage_endpoint_id")
