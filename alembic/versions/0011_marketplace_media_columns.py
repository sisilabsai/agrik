"""marketplace media columns

Revision ID: 0011_marketplace_media_columns
Revises: 0010_platform_services_table
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_marketplace_media_columns"
down_revision = "0010_platform_services_table"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("market_listings") and not _has_column(inspector, "market_listings", "media_urls"):
        op.add_column(
            "market_listings",
            sa.Column("media_urls", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )

    if inspector.has_table("market_services") and not _has_column(inspector, "market_services", "media_urls"):
        op.add_column(
            "market_services",
            sa.Column("media_urls", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("market_services") and _has_column(inspector, "market_services", "media_urls"):
        op.drop_column("market_services", "media_urls")

    if inspector.has_table("market_listings") and _has_column(inspector, "market_listings", "media_urls"):
        op.drop_column("market_listings", "media_urls")
