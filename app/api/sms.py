import json
from urllib.parse import parse_qs
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.models import AdviceResponse
from app.services.grik_copilot import (
    AIUnavailableError,
    generate_grik_chat_advice,
    get_or_create_channel_auth_user,
)
from app.services.memory import record_interaction
from app.services.sms_providers import (
    parse_twilio,
    parse_africas_talking,
    validate_twilio_signature,
    validate_africas_talking_signature,
)
from app.services.outbound_queue import send_and_record, send_with_fallback
from app.services.delivery_reports import record_delivery_report
from app.core.config import get_twilio_config, get_africas_talking_config, get_default_sms_provider
from app.services.marketplace_sms import handle_marketplace_sms

router = APIRouter()

class SmsRequest(BaseModel):
    farmer_id: str
    phone: str
    message: str
    locale_hint: str | None = None
    location_hint: str | None = None


def _generate_sms_ai_advice(
    db: Session,
    farmer_id: str,
    phone: str,
    message: str,
    locale_hint: str | None,
    location_hint: str | None,
):
    user = get_or_create_channel_auth_user(db, farmer_id=farmer_id, phone=phone)
    advice = generate_grik_chat_advice(
        db=db,
        user=user,
        message=message,
        locale_hint=locale_hint,
        location_hint=location_hint,
    )
    return user, advice

@router.post("/inbound", response_model=AdviceResponse)
def inbound_sms(payload: SmsRequest, db: Session = Depends(get_db)) -> AdviceResponse:
    market_reply = handle_marketplace_sms(payload.phone, payload.message)
    if market_reply:
        record_interaction(
            farmer_id=payload.farmer_id,
            phone=payload.phone,
            channel="sms",
            message=payload.message,
            response=market_reply,
            language=payload.locale_hint or "en",
            citations=[],
            source_confidence=0.0,
        )
        return AdviceResponse(
            reply=market_reply,
            language=payload.locale_hint or "en",
            sources=[],
            citations=[],
            source_confidence=0.0,
            citation_text="",
        )

    try:
        user, advice = _generate_sms_ai_advice(
            db=db,
            farmer_id=payload.farmer_id,
            phone=payload.phone,
            message=payload.message,
            locale_hint=payload.locale_hint,
            location_hint=payload.location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    record_interaction(
        farmer_id=user.id,
        phone=user.phone,
        channel="sms",
        message=payload.message,
        response=advice.reply,
        language=advice.language,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
    )
    return AdviceResponse(
        reply=advice.reply,
        language=advice.language,
        sources=advice.sources,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
        citation_text=advice.citation_text,
    )


@router.post("/twilio")
async def inbound_twilio(request: Request, db: Session = Depends(get_db)) -> dict:
    form = await request.form()
    form_dict = dict(form)
    cfg = get_twilio_config()
    signature = request.headers.get("X-Twilio-Signature", "")
    if cfg["auth_token"] and signature:
        if not validate_twilio_signature(str(request.url), form_dict, signature, cfg["auth_token"]):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    parsed = parse_twilio(form_dict)
    market_reply = handle_marketplace_sms(parsed.phone, parsed.message)
    if market_reply:
        record_interaction(
            farmer_id=parsed.farmer_id,
            phone=parsed.phone,
            channel="sms",
            message=parsed.message,
            response=market_reply,
            language="en",
            citations=[],
            source_confidence=0.0,
        )
        delivery = send_and_record("twilio", parsed.phone, market_reply)
        return {"message": market_reply, "delivery": delivery}

    try:
        user, advice = _generate_sms_ai_advice(
            db=db,
            farmer_id=parsed.farmer_id,
            phone=parsed.phone,
            message=parsed.message,
            locale_hint=parsed.locale_hint,
            location_hint=parsed.location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    record_interaction(
        farmer_id=user.id,
        phone=user.phone,
        channel="sms",
        message=parsed.message,
        response=advice.reply,
        language=advice.language,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
    )
    delivery = send_and_record("twilio", parsed.phone, advice.reply)
    return {"message": advice.reply, "delivery": delivery}


@router.post("/africastalking")
async def inbound_africas_talking(request: Request, db: Session = Depends(get_db)) -> dict:
    raw_body = await request.body()
    cfg = get_africas_talking_config()
    sig = request.headers.get("X-AT-Signature", "") or request.headers.get("X-At-Signature", "")
    if cfg["signature_secret"] and sig:
        if not validate_africas_talking_signature(raw_body, sig, cfg["signature_secret"]):
            raise HTTPException(status_code=403, detail="Invalid Africa's Talking signature")

    if request.headers.get("content-type", "").startswith("application/json"):
        payload = json.loads(raw_body.decode("utf-8"))
    else:
        parsed_form = parse_qs(raw_body.decode("utf-8"), keep_blank_values=True)
        payload = {k: v[0] for k, v in parsed_form.items()}

    parsed = parse_africas_talking(payload)
    market_reply = handle_marketplace_sms(parsed.phone, parsed.message)
    preferred = get_default_sms_provider()
    if market_reply:
        record_interaction(
            farmer_id=parsed.farmer_id,
            phone=parsed.phone,
            channel="sms",
            message=parsed.message,
            response=market_reply,
            language="en",
            citations=[],
            source_confidence=0.0,
        )
        delivery = send_with_fallback(parsed.phone, market_reply, preferred=preferred)
        return {"message": market_reply, "delivery": delivery}

    try:
        user, advice = _generate_sms_ai_advice(
            db=db,
            farmer_id=parsed.farmer_id,
            phone=parsed.phone,
            message=parsed.message,
            locale_hint=parsed.locale_hint,
            location_hint=parsed.location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    record_interaction(
        farmer_id=user.id,
        phone=user.phone,
        channel="sms",
        message=parsed.message,
        response=advice.reply,
        language=advice.language,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
    )
    delivery = send_with_fallback(parsed.phone, advice.reply, preferred=preferred)
    return {"message": advice.reply, "delivery": delivery}


@router.post("/africastalking/dlr")
async def africastalking_delivery_report(request: Request) -> dict:
    raw_body = await request.body()
    cfg = get_africas_talking_config()
    sig = request.headers.get("X-AT-Signature", "") or request.headers.get("X-At-Signature", "")
    if cfg["signature_secret"] and sig:
        if not validate_africas_talking_signature(raw_body, sig, cfg["signature_secret"]):
            raise HTTPException(status_code=403, detail="Invalid Africa's Talking signature")

    if request.headers.get("content-type", "").startswith("application/json"):
        payload = json.loads(raw_body.decode("utf-8"))
    else:
        parsed_form = parse_qs(raw_body.decode("utf-8"), keep_blank_values=True)
        payload = {k: v[0] for k, v in parsed_form.items()}

    record_delivery_report(
        provider="africas_talking",
        status=payload.get("status", "unknown"),
        payload=payload,
        provider_message_id=payload.get("id") or payload.get("messageId"),
        phone=payload.get("phoneNumber") or payload.get("to"),
        failure_reason=payload.get("failureReason"),
    )
    return {"status": "ok"}


@router.post("/twilio/dlr")
async def twilio_delivery_report(request: Request) -> dict:
    form = await request.form()
    payload = dict(form)
    record_delivery_report(
        provider="twilio",
        status=payload.get("MessageStatus", "unknown"),
        payload=payload,
        provider_message_id=payload.get("MessageSid"),
        phone=payload.get("To"),
        failure_reason=payload.get("ErrorMessage") or payload.get("ErrorCode"),
    )
    return {"status": "ok"}
