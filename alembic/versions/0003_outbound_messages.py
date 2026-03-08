"""outbound messages

Revision ID: 0003_outbound_messages
Revises: 0002_delivery_reports
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_outbound_messages"
down_revision = "0002_delivery_reports"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "outbound_messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("attempts", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("outbound_messages")
