import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import get_database_url


class Base(DeclarativeBase):
    pass


def _engine_connect_args(database_url: str) -> dict:
    url = database_url.lower()
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    if "postgresql" in url:
        timeout = os.getenv("DB_CONNECT_TIMEOUT", "5").strip() or "5"
        try:
            return {"connect_timeout": int(timeout)}
        except ValueError:
            return {"connect_timeout": 5}
    return {}


DATABASE_URL = get_database_url()
engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=_engine_connect_args(DATABASE_URL),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
