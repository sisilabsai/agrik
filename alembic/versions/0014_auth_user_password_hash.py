"""auth user password hash

Revision ID: 0014_auth_user_password_hash
Revises: 0013_auth_user_profiles
Create Date: 2026-02-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0014_auth_user_password_hash"
down_revision = "0013_auth_user_profiles"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("auth_users"):
        return

    if not _has_column(inspector, "auth_users", "password_hash"):
        op.add_column("auth_users", sa.Column("password_hash", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("auth_users"):
        return

    if _has_column(inspector, "auth_users", "password_hash"):
        op.drop_column("auth_users", "password_hash")
