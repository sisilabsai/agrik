from logging.config import fileConfig
import os
import sys
from pathlib import Path
from alembic import context
from sqlalchemy import engine_from_config, pool

# Ensure project root is on sys.path so "app" is importable
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.session import Base
from app import db as _  # ensure models are imported

# this is the Alembic Config object
config = context.config

# interpret the config file for Python logging
fileConfig(config.config_file_name)

# set sqlalchemy.url from env DATABASE_URL
if os.getenv("DATABASE_URL"):
    # Alembic uses ConfigParser internally, so raw '%' characters in a database
    # URL must be escaped before assigning the option.
    config.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL").replace("%", "%%"))

# add your model's MetaData object for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
from app.db.models import Farmer, FarmerProfile, Interaction, FarmerLocation, DeliveryReport, OutboundMessage  # noqa

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
