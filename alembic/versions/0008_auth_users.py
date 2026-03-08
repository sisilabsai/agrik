"""auth users

Revision ID: 0008_auth_users
Revises: 0007_market_alerts_weather
Create Date: 2026-02-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0008_auth_users"
down_revision = "0007_market_alerts_weather"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("auth_users"):
        op.create_table(
            "auth_users",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("phone", sa.String(), nullable=False, unique=True),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("verification_status", sa.String(), nullable=False, server_default="unverified"),
            sa.Column("otp_hash", sa.String()),
            sa.Column("otp_expires_at", sa.DateTime(timezone=True)),
            sa.Column("otp_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("otp_last_sent_at", sa.DateTime(timezone=True)),
            sa.Column("last_login_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if inspector.has_table("auth_users"):
        existing = {idx.get("name") for idx in inspector.get_indexes("auth_users")}
        if "idx_auth_users_phone" not in existing:
            op.create_index("idx_auth_users_phone", "auth_users", ["phone"])


def downgrade():
    op.drop_index("idx_auth_users_phone", table_name="auth_users")
    op.drop_table("auth_users")
