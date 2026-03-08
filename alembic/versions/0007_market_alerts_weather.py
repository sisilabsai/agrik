"""market alerts weather fields

Revision ID: 0007_market_alerts_weather
Revises: 0006_merge_marketplace_heads
Create Date: 2026-02-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_market_alerts_weather"
down_revision = "0006_merge_marketplace_heads"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "market_alerts",
        sa.Column("min_interval_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column(
        "market_alerts",
        sa.Column("last_notified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("market_alerts", "last_notified_at")
    op.drop_column("market_alerts", "min_interval_hours")
