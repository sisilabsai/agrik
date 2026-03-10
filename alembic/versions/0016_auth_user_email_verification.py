"""auth user email verification and reset fields

Revision ID: 0016_auth_user_email_verification
Revises: 0015_admin_tables
Create Date: 2026-03-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_auth_user_email_verification"
down_revision = "0015_admin_tables"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("auth_users"):
        return

    additions = [
        ("email", sa.Column("email", sa.String(), nullable=True)),
        ("email_verification_code_hash", sa.Column("email_verification_code_hash", sa.String(), nullable=True)),
        ("email_verification_expires_at", sa.Column("email_verification_expires_at", sa.DateTime(timezone=True), nullable=True)),
        ("email_verification_attempts", sa.Column("email_verification_attempts", sa.Integer(), nullable=False, server_default="0")),
        ("email_verification_last_sent_at", sa.Column("email_verification_last_sent_at", sa.DateTime(timezone=True), nullable=True)),
        ("email_verified_at", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)),
        ("password_reset_code_hash", sa.Column("password_reset_code_hash", sa.String(), nullable=True)),
        ("password_reset_expires_at", sa.Column("password_reset_expires_at", sa.DateTime(timezone=True), nullable=True)),
        ("password_reset_attempts", sa.Column("password_reset_attempts", sa.Integer(), nullable=False, server_default="0")),
        ("password_reset_last_sent_at", sa.Column("password_reset_last_sent_at", sa.DateTime(timezone=True), nullable=True)),
    ]

    for column_name, column in additions:
        if not _has_column(inspector, "auth_users", column_name):
            op.add_column("auth_users", column)

    bind.execute(sa.text("UPDATE auth_users SET email = lower(phone || '@pending.agrik.local') WHERE email IS NULL"))
    op.alter_column("auth_users", "email", nullable=False)

    inspector = sa.inspect(bind)
    if not _has_index(inspector, "auth_users", "ix_auth_users_email"):
        op.create_index("ix_auth_users_email", "auth_users", ["email"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("auth_users"):
        return

    if _has_index(inspector, "auth_users", "ix_auth_users_email"):
        op.drop_index("ix_auth_users_email", table_name="auth_users")

    for column_name in [
        "password_reset_last_sent_at",
        "password_reset_attempts",
        "password_reset_expires_at",
        "password_reset_code_hash",
        "email_verified_at",
        "email_verification_last_sent_at",
        "email_verification_attempts",
        "email_verification_expires_at",
        "email_verification_code_hash",
        "email",
    ]:
        inspector = sa.inspect(bind)
        if _has_column(inspector, "auth_users", column_name):
            op.drop_column("auth_users", column_name)
