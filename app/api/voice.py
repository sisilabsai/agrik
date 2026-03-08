from typing import Optional
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.models import AdviceResponse
from app.services.grik_copilot import (
    AIUnavailableError,
    generate_grik_chat_advice,
    get_or_create_channel_auth_user,
)
from app.services.memory import record_interaction
from app.services.infobip_voice import send_voice_message_infobip, send_ctc_voice_call_infobip
from app.services.infobip_calls import create_call_infobip, answer_call_infobip, say_call_infobip

router = APIRouter()

WELCOME_PROMPT = "Welcome to AGRIK. Please briefly describe your crop problem after the tone."


class VoiceRequest(BaseModel):
    farmer_id: str
    phone: str
    transcript: str
    locale_hint: str | None = None
    location_hint: str | None = None


class InfobipVoiceMessageRequest(BaseModel):
    to: str
    text: str
    language: str | None = None
    voice_name: str | None = None
    voice_gender: str | None = None
    from_number: str | None = None


class InfobipCallRequest(BaseModel):
    to: str
    from_number: str | None = None
    application_id: str | None = None
    connect_timeout: int = 30


class InfobipCtcRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    destination_a: str = Field(alias="destinationA")
    destination_b: str | None = Field(default=None, alias="destinationB")
    from_number: str | None = Field(default=None, alias="from")
    text: str
    language: str | None = None
    voice_name: str | None = None
    voice_gender: str | None = None


def _generate_voice_ai_advice(
    db: Session,
    farmer_id: str,
    phone: str | None,
    transcript: str,
    locale_hint: str | None,
    location_hint: str | None,
):
    user = get_or_create_channel_auth_user(db, farmer_id=farmer_id, phone=phone)
    advice = generate_grik_chat_advice(
        db=db,
        user=user,
        message=transcript,
        locale_hint=locale_hint,
        location_hint=location_hint,
    )
    return user, advice


def _extract_event(payload: dict) -> str:
    for key in ("event", "eventName", "eventType", "type"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            nested = value.get("name") or value.get("type")
            if isinstance(nested, str) and nested:
                return nested
    return ""


def _extract_call_id(payload: dict) -> Optional[str]:
    for key in ("callId", "call_id", "callID", "callid"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    call_obj = payload.get("call") or payload.get("callDetails") or payload.get("data")
    if isinstance(call_obj, dict):
        value = call_obj.get("id") or call_obj.get("callId")
        if isinstance(value, str) and value:
            return value
    value = payload.get("id")
    if isinstance(value, str) and value:
        return value
    return None


def _extract_phone(payload: dict) -> Optional[str]:
    for key in ("from", "fromNumber", "fromMsisdn", "caller", "source", "msisdn"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            nested = value.get("phoneNumber") or value.get("number") or value.get("msisdn")
            if isinstance(nested, str) and nested:
                return nested
    return None


def _extract_transcript(payload: dict) -> Optional[str]:
    for key in ("text", "transcript", "speechResult", "speechText"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            nested = value.get("text") or value.get("transcript") or value.get("value")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    speech = payload.get("speech")
    if isinstance(speech, dict):
        nested = speech.get("text") or speech.get("transcript")
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
        results = speech.get("results")
        if isinstance(results, list) and results:
            for item in results:
                if isinstance(item, dict):
                    nested = item.get("text") or item.get("transcript")
                    if isinstance(nested, str) and nested.strip():
                        return nested.strip()
    results = payload.get("results")
    if isinstance(results, list) and results:
        for item in results:
            if isinstance(item, dict):
                nested = item.get("text") or item.get("transcript")
                if isinstance(nested, str) and nested.strip():
                    return nested.strip()
    return None


@router.post("/inbound", response_model=AdviceResponse)
def inbound_voice(payload: VoiceRequest, db: Session = Depends(get_db)) -> AdviceResponse:
    try:
        user, advice = _generate_voice_ai_advice(
            db=db,
            farmer_id=payload.farmer_id,
            phone=payload.phone,
            transcript=payload.transcript,
            locale_hint=payload.locale_hint,
            location_hint=payload.location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    record_interaction(
        farmer_id=user.id,
        phone=user.phone,
        channel="voice",
        message=payload.transcript,
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


@router.post("/infobip/tts")
def infobip_tts(payload: InfobipVoiceMessageRequest) -> dict:
    try:
        result = send_voice_message_infobip(
            to=payload.to,
            text=payload.text,
            language=payload.language,
            voice_name=payload.voice_name,
            voice_gender=payload.voice_gender,
            from_number=payload.from_number,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "result": result}


@router.post("/infobip/ctc")
def infobip_ctc(payload: InfobipCtcRequest) -> dict:
    destination_b = payload.destination_b or payload.destination_a
    try:
        result = send_ctc_voice_call_infobip(
            destination_a=payload.destination_a,
            destination_b=destination_b,
            text=payload.text,
            language=payload.language,
            voice_name=payload.voice_name,
            voice_gender=payload.voice_gender,
            from_number=payload.from_number,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "result": result}


@router.post("/infobip/call")
def infobip_outbound_call(payload: InfobipCallRequest) -> dict:
    try:
        result = create_call_infobip(
            to=payload.to,
            from_number=payload.from_number,
            application_id=payload.application_id,
            connect_timeout=payload.connect_timeout,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok", "result": result}


@router.post("/infobip/receive")
async def infobip_receive(request: Request) -> dict:
    payload = await request.json()
    event = _extract_event(payload)
    call_id = _extract_call_id(payload)
    if event in {"CALL_RECEIVED", "CALL_RINGING", ""} and call_id:
        try:
            answer_call_infobip(call_id)
        except ValueError as exc:
            return {"status": "error", "detail": str(exc), "event": event}
    return {"status": "ok", "event": event}


@router.post("/infobip/events")
async def infobip_events(request: Request, db: Session = Depends(get_db)) -> dict:
    payload = await request.json()
    event = _extract_event(payload)
    call_id = _extract_call_id(payload)
    phone = _extract_phone(payload)

    if event == "CALL_ESTABLISHED" and call_id:
        try:
            say_call_infobip(call_id, WELCOME_PROMPT)
        except ValueError as exc:
            return {"status": "error", "detail": str(exc), "event": event}

    transcript = _extract_transcript(payload)
    if transcript and call_id:
        farmer_id = phone or call_id
        try:
            user, advice = _generate_voice_ai_advice(
                db=db,
                farmer_id=farmer_id,
                phone=phone,
                transcript=transcript,
                locale_hint=None,
                location_hint=None,
            )
        except AIUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        record_interaction(
            farmer_id=user.id,
            phone=user.phone,
            channel="voice",
            message=transcript,
            response=advice.reply,
            language=advice.language,
            citations=advice.citations,
            source_confidence=advice.source_confidence,
        )
        try:
            say_call_infobip(call_id, advice.reply, language=advice.language)
        except ValueError as exc:
            return {"status": "error", "detail": str(exc), "event": event}
        return {"status": "ok", "event": event, "reply": advice.reply}

    return {"status": "ok", "event": event}
