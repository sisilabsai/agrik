"""admin tables

Revision ID: 0015_admin_tables
Revises: 0014_auth_user_password_hash
Create Date: 2026-03-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0015_admin_tables"
down_revision = "0014_auth_user_password_hash"
branch_labels = None
depends_on = None


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("admin_users"):
        op.create_table(
            "admin_users",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="active"),
            sa.Column("verification_status", sa.String(), nullable=False, server_default="unverified"),
            sa.Column("otp_hash", sa.String(), nullable=True),
            sa.Column("otp_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("otp_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("otp_last_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("email"),
        )

    inspector = sa.inspect(bind)
    if inspector.has_table("admin_users") and not _has_index(inspector, "admin_users", "ix_admin_users_email"):
        op.create_index("ix_admin_users_email", "admin_users", ["email"], unique=False)

    if not inspector.has_table("admin_activities"):
        op.create_table(
            "admin_activities",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("admin_id", sa.String(), nullable=False),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("details", sa.JSON(), nullable=False),
            sa.Column("ip_address", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("admin_activities"):
        op.drop_table("admin_activities")

    inspector = sa.inspect(bind)
    if inspector.has_table("admin_users"):
        if _has_index(inspector, "admin_users", "ix_admin_users_email"):
            op.drop_index("ix_admin_users_email", table_name="admin_users")
        op.drop_table("admin_users")
