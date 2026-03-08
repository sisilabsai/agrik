"""profile subscriptions chat tables

Revision ID: 0009_profile_subscriptions_chat
Revises: 0008_auth_users
Create Date: 2026-02-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0009_profile_subscriptions_chat"
down_revision = "0008_auth_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    def has_table(name: str) -> bool:
        return inspector.has_table(name)

    def has_index(table: str, index_name: str) -> bool:
        return any(idx.get("name") == index_name for idx in inspector.get_indexes(table))

    if not has_table("auth_user_settings"):
        op.create_table(
            "auth_user_settings",
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("preferred_language", sa.String(), nullable=True),
            sa.Column("district", sa.String(), nullable=True),
            sa.Column("parish", sa.String(), nullable=True),
            sa.Column("sms_opt_in", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("voice_opt_in", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("weather_alerts", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("price_alerts", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"]),
            sa.PrimaryKeyConstraint("user_id"),
        )

    if not has_table("auth_subscriptions"):
        op.create_table(
            "auth_subscriptions",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("plan", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="trial"),
            sa.Column("starts_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("provider", sa.String(), nullable=True),
            sa.Column("external_ref", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"]),
        )
    if has_table("auth_subscriptions") and not has_index("auth_subscriptions", "ix_auth_subscriptions_user_id"):
        op.create_index("ix_auth_subscriptions_user_id", "auth_subscriptions", ["user_id"])

    if not has_table("chat_messages"):
        op.create_table(
            "chat_messages",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("channel", sa.String(), nullable=False, server_default="web"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"]),
        )
    if has_table("chat_messages") and not has_index("chat_messages", "ix_chat_messages_user_id"):
        op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_user_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_auth_subscriptions_user_id", table_name="auth_subscriptions")
    op.drop_table("auth_subscriptions")
    op.drop_table("auth_user_settings")
