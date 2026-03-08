"""initial schema

Revision ID: 0001_initial
Revises: 
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "farmers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("preferred_language", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "farmer_profiles",
        sa.Column("farmer_id", sa.String(), sa.ForeignKey("farmers.id"), primary_key=True),
        sa.Column("crops", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("planting_dates", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("soil_profile", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("climate_exposure", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("yield_estimates", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "interactions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("farmer_id", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("response", sa.Text(), nullable=False),
        sa.Column("language", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "farmer_locations",
        sa.Column("farmer_id", sa.String(), sa.ForeignKey("farmers.id"), primary_key=True),
        sa.Column("parish", sa.String(), nullable=True),
        sa.Column("district", sa.String(), nullable=True),
        sa.Column("geometry_wkt", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("farmer_locations")
    op.drop_table("interactions")
    op.drop_table("farmer_profiles")
    op.drop_table("farmers")
