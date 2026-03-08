import logging
from typing import Any, Dict
from sqlalchemy.exc import SQLAlchemyError
from app.db.session import SessionLocal
from app.db.models import DeliveryReport


logger = logging.getLogger("agrik.sms")


def record_delivery_report(
    provider: str,
    status: str,
    payload: Dict[str, Any],
    provider_message_id: str | None = None,
    phone: str | None = None,
    failure_reason: str | None = None,
) -> None:
    db = SessionLocal()
    try:
        db.add(
            DeliveryReport(
                provider=provider,
                provider_message_id=provider_message_id,
                phone=phone,
                status=status,
                failure_reason=failure_reason,
                raw_payload=payload,
            )
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Failed to record delivery report: %s", exc)
        raise
    finally:
        db.close()
