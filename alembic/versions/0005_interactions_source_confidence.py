"""interactions source_confidence

Revision ID: 0005_src_conf
Revises: 0004_interactions_citations
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_src_conf"
down_revision = "0004_interactions_citations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("interactions", sa.Column("source_confidence", sa.String(), nullable=True))


def downgrade():
    op.drop_column("interactions", "source_confidence")
