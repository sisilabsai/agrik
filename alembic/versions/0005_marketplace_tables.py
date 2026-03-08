"""marketplace tables

Revision ID: 0005_marketplace_tables
Revises: 0004_interactions_citations
Create Date: 2026-02-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_marketplace_tables"
down_revision = "0004_interactions_citations"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    def has_table(name: str) -> bool:
        return inspector.has_table(name)

    def has_index(table: str, index_name: str) -> bool:
        return any(idx.get("name") == index_name for idx in inspector.get_indexes(table))

    if not has_table("market_users"):
        op.create_table(
            "market_users",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("phone", sa.String(), nullable=False, unique=True),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("verification_status", sa.String(), nullable=False, server_default="unverified"),
            sa.Column("preferred_language", sa.String()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not has_table("market_locations"):
        op.create_table(
            "market_locations",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("market_users.id"), nullable=False),
            sa.Column("parish", sa.String()),
            sa.Column("district", sa.String()),
            sa.Column("latitude", sa.Float()),
            sa.Column("longitude", sa.Float()),
            sa.Column("geometry_wkt", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not has_table("market_listings"):
        op.create_table(
            "market_listings",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("market_users.id"), nullable=False),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("crop", sa.String(), nullable=False),
            sa.Column("quantity", sa.Float()),
            sa.Column("unit", sa.String()),
            sa.Column("price", sa.Float()),
            sa.Column("currency", sa.String(), nullable=False, server_default="UGX"),
            sa.Column("grade", sa.String()),
            sa.Column("availability_start", sa.DateTime(timezone=True)),
            sa.Column("availability_end", sa.DateTime(timezone=True)),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("market_locations.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if has_table("market_listings") and not has_index("market_listings", "idx_market_listings_crop"):
        op.create_index("idx_market_listings_crop", "market_listings", ["crop"])

    if not has_table("market_offers"):
        op.create_table(
            "market_offers",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("listing_id", sa.BigInteger(), sa.ForeignKey("market_listings.id"), nullable=False),
            sa.Column("user_id", sa.String(), sa.ForeignKey("market_users.id"), nullable=False),
            sa.Column("price", sa.Float()),
            sa.Column("quantity", sa.Float()),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not has_table("market_services"):
        op.create_table(
            "market_services",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("market_users.id"), nullable=False),
            sa.Column("service_type", sa.String(), nullable=False),
            sa.Column("description", sa.Text()),
            sa.Column("coverage_radius_km", sa.Float()),
            sa.Column("price", sa.Float()),
            sa.Column("currency", sa.String(), nullable=False, server_default="UGX"),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("market_locations.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not has_table("market_alerts"):
        op.create_table(
            "market_alerts",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("market_users.id"), nullable=False),
            sa.Column("alert_type", sa.String(), nullable=False),
            sa.Column("crop", sa.String()),
            sa.Column("threshold", sa.Float()),
            sa.Column("channel", sa.String(), nullable=False, server_default="sms"),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("market_locations.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not has_table("market_prices"):
        op.create_table(
            "market_prices",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("crop", sa.String(), nullable=False),
            sa.Column("market", sa.String()),
            sa.Column("district", sa.String()),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(), nullable=False, server_default="UGX"),
            sa.Column("source", sa.String()),
            sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if has_table("market_prices") and not has_index("market_prices", "idx_market_prices_crop"):
        op.create_index("idx_market_prices_crop", "market_prices", ["crop"])


def downgrade():
    op.drop_index("idx_market_prices_crop", table_name="market_prices")
    op.drop_table("market_prices")
    op.drop_table("market_alerts")
    op.drop_table("market_services")
    op.drop_table("market_offers")
    op.drop_index("idx_market_listings_crop", table_name="market_listings")
    op.drop_table("market_listings")
    op.drop_table("market_locations")
    op.drop_table("market_users")
