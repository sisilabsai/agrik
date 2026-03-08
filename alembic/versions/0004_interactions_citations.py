"""interactions citations

Revision ID: 0004_interactions_citations
Revises: 0003_outbound_messages
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_interactions_citations"
down_revision = "0003_outbound_messages"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("interactions", sa.Column("citations", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column("interactions", "citations")
