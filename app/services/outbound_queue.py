from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, List
import logging
from sqlalchemy.exc import SQLAlchemyError
from app.db.session import SessionLocal
from app.db.models import OutboundMessage
from app.services.outbound_sms import send_sms_africas_talking
from app.services.outbound_twilio import send_sms_twilio
from app.services.outbound_infobip import send_sms_infobip
from app.core.config import (
    get_africas_talking_config,
    get_twilio_config,
    get_infobip_config,
    get_default_sms_provider,
)
from app.core.metrics import OUTBOUND_SEND_COUNT

logger = logging.getLogger("agrik.outbound")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def enqueue_outbound(provider: str, phone: str, message: str) -> int:
    db = SessionLocal()
    try:
        msg = OutboundMessage(
            provider=provider,
            phone=phone,
            message=message,
            status="pending",
            attempts=0,
            next_attempt_at=_now(),
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        return msg.id
    finally:
        db.close()


def _mark_sent(db, msg: OutboundMessage, response: Dict[str, str]) -> None:
    msg.status = "sent"
    msg.last_error = None
    msg.next_attempt_at = None
    msg.attempts = msg.attempts + 1
    db.commit()


def _mark_failed(db, msg: OutboundMessage, error: str, retry_in_seconds: Optional[int]) -> None:
    msg.status = "failed"
    msg.last_error = error
    msg.attempts = msg.attempts + 1
    if retry_in_seconds is not None:
        msg.next_attempt_at = _now() + timedelta(seconds=retry_in_seconds)
        msg.status = "pending"
    db.commit()


def _send(provider: str, phone: str, message: str) -> Dict[str, str]:
    try:
        if provider == "africas_talking":
            return send_sms_africas_talking(phone, message)
        if provider == "twilio":
            return send_sms_twilio(phone, message)
        if provider == "infobip":
            return send_sms_infobip(phone, message)
        raise ValueError(f"Unknown provider: {provider}")
    except Exception as exc:
        logger.error("Outbound send failed provider=%s error=%s", provider, exc)
        return {"status_code": "error", "response_text": str(exc)}


def _is_success(response: Dict[str, str]) -> bool:
    status_code = response.get("status_code", "")
    return status_code.isdigit() and 200 <= int(status_code) < 300


def _should_fallback(response: Dict[str, str]) -> bool:
    status_code = response.get("status_code", "")
    if status_code in {"401", "403", "error"}:
        return True
    if status_code.isdigit() and int(status_code) >= 500:
        return True
    return False


def _provider_available(provider: str) -> bool:
    if provider == "africas_talking":
        cfg = get_africas_talking_config()
        return bool(cfg.get("username") and cfg.get("api_key"))
    if provider == "twilio":
        cfg = get_twilio_config()
        has_sender = bool(cfg.get("from_number") or cfg.get("messaging_service_sid"))
        return bool(cfg.get("account_sid") and cfg.get("auth_token") and has_sender)
    if provider == "infobip":
        cfg = get_infobip_config()
        sms_from = cfg.get("sms_from") or cfg.get("voice_from")
        return bool(cfg.get("api_key") and sms_from)
    return False


def _provider_sequence(preferred: Optional[str] = None) -> List[str]:
    preferred = preferred or get_default_sms_provider()
    candidates = [preferred, "africas_talking", "infobip", "twilio"]
    seen = set()
    ordered: List[str] = []
    for provider in candidates:
        if not provider or provider in seen:
            continue
        seen.add(provider)
        if _provider_available(provider):
            ordered.append(provider)
    return ordered


def send_and_record(provider: str, phone: str, message: str, max_retries: int = 3) -> Dict[str, str]:
    msg_id = enqueue_outbound(provider, phone, message)
    db = SessionLocal()
    try:
        msg = db.get(OutboundMessage, msg_id)
        if msg is None:
            raise SQLAlchemyError("Outbound message missing")

        response = _send(provider, phone, message)
        status_code = response.get("status_code", "")
        if status_code.isdigit() and 200 <= int(status_code) < 300:
            _mark_sent(db, msg, response)
            OUTBOUND_SEND_COUNT.labels(provider=provider, status="success").inc()
            return response

        retry_in = 2 ** msg.attempts
        _mark_failed(db, msg, response.get("response_text", "send failed"), retry_in_seconds=retry_in)
        OUTBOUND_SEND_COUNT.labels(provider=provider, status="failed").inc()
        return response
    finally:
        db.close()


def send_with_fallback(phone: str, message: str, preferred: Optional[str] = None) -> Dict[str, str]:
    providers = _provider_sequence(preferred)
    if not providers:
        return {"status_code": "error", "response_text": "No SMS providers configured"}

    last_response: Dict[str, str] = {"status_code": "error", "response_text": "Send failed"}
    for provider in providers:
        response = send_and_record(provider, phone, message)
        response["provider"] = provider
        last_response = response
        if _is_success(response):
            return response
        if not _should_fallback(response):
            return response

    return last_response
