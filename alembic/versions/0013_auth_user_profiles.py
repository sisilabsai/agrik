"""auth user profiles

Revision ID: 0013_auth_user_profiles
Revises: 0012_listing_detail_fields
Create Date: 2026-02-22
"""

from alembic import op
import sqlalchemy as sa

revision = "0013_auth_user_profiles"
down_revision = "0012_listing_detail_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("auth_user_profiles"):
        op.create_table(
            "auth_user_profiles",
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("full_name", sa.String(), nullable=False),
            sa.Column("district", sa.String(), nullable=False),
            sa.Column("parish", sa.String(), nullable=False),
            sa.Column("crops", sa.JSON(), nullable=False),
            sa.Column("organization_name", sa.String(), nullable=True),
            sa.Column("service_categories", sa.JSON(), nullable=False),
            sa.Column("focus_crops", sa.JSON(), nullable=False),
            sa.Column("onboarding_stage", sa.String(), nullable=False, server_default="completed"),
            sa.Column("profile_data", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"]),
            sa.PrimaryKeyConstraint("user_id"),
        )


def downgrade() -> None:
    op.drop_table("auth_user_profiles")
