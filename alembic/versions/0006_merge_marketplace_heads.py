"""merge marketplace heads

Revision ID: 0006_merge_marketplace_heads
Revises: 0005_src_conf, 0005_marketplace_tables
Create Date: 2026-02-10
"""

from alembic import op

revision = "0006_merge_marketplace_heads"
down_revision = ("0005_src_conf", "0005_marketplace_tables")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
