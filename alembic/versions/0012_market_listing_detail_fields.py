"""market listing detail fields

Revision ID: 0012_listing_detail_fields
Revises: 0011_marketplace_media_columns
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_listing_detail_fields"
down_revision = "0011_marketplace_media_columns"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("market_listings"):
        return

    if not _has_column(inspector, "market_listings", "description"):
        op.add_column("market_listings", sa.Column("description", sa.Text(), nullable=True))
    if not _has_column(inspector, "market_listings", "contact_name"):
        op.add_column("market_listings", sa.Column("contact_name", sa.String(), nullable=True))
    if not _has_column(inspector, "market_listings", "contact_phone"):
        op.add_column("market_listings", sa.Column("contact_phone", sa.String(), nullable=True))
    if not _has_column(inspector, "market_listings", "contact_whatsapp"):
        op.add_column("market_listings", sa.Column("contact_whatsapp", sa.String(), nullable=True))

    # Backfill phone contacts for existing records from market_users.
    bind.execute(
        sa.text(
            """
            UPDATE market_listings
            SET contact_phone = (
                SELECT phone
                FROM market_users
                WHERE market_users.id = market_listings.user_id
            )
            WHERE (contact_phone IS NULL OR contact_phone = '')
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE market_listings
            SET contact_whatsapp = contact_phone
            WHERE (contact_whatsapp IS NULL OR contact_whatsapp = '')
              AND contact_phone IS NOT NULL
              AND contact_phone <> ''
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("market_listings"):
        return

    if _has_column(inspector, "market_listings", "contact_whatsapp"):
        op.drop_column("market_listings", "contact_whatsapp")
    if _has_column(inspector, "market_listings", "contact_phone"):
        op.drop_column("market_listings", "contact_phone")
    if _has_column(inspector, "market_listings", "contact_name"):
        op.drop_column("market_listings", "contact_name")
    if _has_column(inspector, "market_listings", "description"):
        op.drop_column("market_listings", "description")
