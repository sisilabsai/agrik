"""platform services table

Revision ID: 0010_platform_services_table
Revises: 0009_profile_subscriptions_chat
Create Date: 2026-02-11 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_platform_services_table"
down_revision = "0009_profile_subscriptions_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    def has_table(name: str) -> bool:
        return inspector.has_table(name)

    def has_index(table: str, index_name: str) -> bool:
        return any(idx.get("name") == index_name for idx in inspector.get_indexes(table))

    if not has_table("platform_services"):
        op.create_table(
            "platform_services",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("service_type", sa.String(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("price", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(), nullable=False, server_default="UGX"),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if has_table("platform_services") and not has_index("platform_services", "idx_platform_services_service_type"):
        op.create_index("idx_platform_services_service_type", "platform_services", ["service_type"])

    # Backfill any platform records created by the earlier placeholder owner approach.
    rows = bind.execute(
        sa.text(
            """
            SELECT ms.service_type, ms.description, ms.price, ms.currency, ms.status, ms.created_at, ms.updated_at
            FROM market_services ms
            JOIN market_users mu ON mu.id = ms.user_id
            WHERE mu.phone = :phone
            """
        ),
        {"phone": "AGRIK_PLATFORM"},
    ).fetchall()

    if rows:
        platform_services = sa.table(
            "platform_services",
            sa.column("service_type", sa.String()),
            sa.column("description", sa.Text()),
            sa.column("price", sa.Float()),
            sa.column("currency", sa.String()),
            sa.column("status", sa.String()),
            sa.column("created_at", sa.DateTime(timezone=True)),
            sa.column("updated_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(
            platform_services,
            [
                {
                    "service_type": row.service_type,
                    "description": row.description,
                    "price": row.price,
                    "currency": row.currency or "UGX",
                    "status": row.status or "open",
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in rows
            ],
        )


def downgrade() -> None:
    op.drop_index("idx_platform_services_service_type", table_name="platform_services")
    op.drop_table("platform_services")
