"""delivery reports

Revision ID: 0002_delivery_reports
Revises: 0001_initial
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_delivery_reports"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "delivery_reports",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_message_id", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("failure_reason", sa.String(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("delivery_reports")
