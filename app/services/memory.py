from datetime import datetime
import logging

from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app.db.models import Farmer, FarmerProfile
from app.db.session import SessionLocal

logger = logging.getLogger("agrik.memory")


def _interaction_table_columns(db) -> set[str]:
    try:
        inspector = inspect(db.bind)
        return {column.get("name") for column in inspector.get_columns("interactions")}
    except SQLAlchemyError as exc:
        logger.warning("Failed to inspect interactions schema: %s", exc)
        return set()


def record_interaction(
    farmer_id: str,
    phone: str | None,
    channel: str,
    message: str,
    response: str,
    language: str,
    citations: list[dict] | None = None,
    source_confidence: float | None = None,
) -> None:
    db = SessionLocal()
    try:
        farmer = db.get(Farmer, farmer_id)
        if farmer is None:
            farmer = Farmer(id=farmer_id, phone=phone or "unknown", preferred_language=language)
            db.add(farmer)
            db.add(FarmerProfile(farmer_id=farmer_id))
        elif phone and farmer.phone != phone:
            farmer.phone = phone

        columns = _interaction_table_columns(db)
        interaction_payload: dict = {
            "farmer_id": farmer_id,
            "channel": channel,
            "message": message,
            "response": response,
            "language": language,
            "created_at": datetime.utcnow(),
        }
        if "source_confidence" in columns:
            interaction_payload["source_confidence"] = str(source_confidence) if source_confidence is not None else None
        if "citations" in columns:
            interaction_payload["citations"] = citations or []

        insert_columns = list(interaction_payload.keys())
        column_sql = ", ".join(insert_columns)
        value_sql = ", ".join([f":{name}" for name in insert_columns])
        db.execute(
            text(f"INSERT INTO interactions ({column_sql}) VALUES ({value_sql})"),
            interaction_payload,
        )
        db.commit()
    except SQLAlchemyError as exc:
        logger.warning("Failed to persist interaction memory: %s", exc)
        db.rollback()
        # Interaction memory is best-effort and should not block replies.
        return
    finally:
        db.close()
