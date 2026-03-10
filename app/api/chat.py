import logging
import asyncio
import base64
import binascii
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import FarmerProfile
from app.db.session import SessionLocal
from app.schemas.chat import (
    ChatAskRequest,
    ChatAudioSynthesisRequest,
    ChatAudioTranscriptionResponse,
    ChatHistoryResponse,
    ChatMessageOut,
)
from app.schemas.models import AdviceResponse
from app.services.audio import (
    AudioUnavailableError,
    AudioValidationError,
    transcribe_audio_bytes,
    synthesize_speech,
    transcribe_audio_upload,
)
from app.services.auth import get_user_from_token
from app.services.chat import create_message, list_messages
from app.services.grik_copilot import AIUnavailableError, generate_grik_chat_advice
from app.services.memory import record_interaction
from app.services.vision import (
    VisionUnavailableError,
    VisionValidationError,
    analyze_crop_media,
    get_vision_model_options,
)

router = APIRouter()
logger = logging.getLogger("agrik.chat")


def _extract_ws_token(websocket: WebSocket) -> str:
    query_token = str(websocket.query_params.get("token", "") or "").strip()
    if query_token:
        return query_token
    auth_header = str(websocket.headers.get("authorization", "") or "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return ""


def _extract_ws_device_id(websocket: WebSocket) -> str:
    query_device = str(websocket.query_params.get("device_id", "") or "").strip()
    if query_device:
        return query_device
    return str(websocket.headers.get("x-device-id", "") or "").strip()


def _chunk_text_for_streaming(text: str, chunk_size: int = 120) -> list[str]:
    cleaned = str(text or "").strip()
    if not cleaned:
        return []
    return [cleaned[i : i + chunk_size] for i in range(0, len(cleaned), chunk_size)]


def _trim_text(value: Any, limit: int = 220) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 3)].rstrip()}..."


def _conversation_mode_from_text(text: str) -> str | None:
    normalized = re.sub(r"[^a-z0-9\s]", " ", str(text or "").lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return None

    new_phrases = (
        "start new",
        "new conversation",
        "start a new conversation",
        "start fresh",
        "new chat",
        "begin new",
    )
    continue_phrases = (
        "continue",
        "continue conversation",
        "continue with history",
        "continue previous",
        "previous conversation",
        "use history",
    )
    if re.search(r"\bstart\b.*\bnew\b", normalized):
        return "new"
    if re.search(r"\bnew\b.*\bconversation\b", normalized):
        return "new"
    if re.search(r"\bcontinue\b.*\b(previous|history|conversation)\b", normalized):
        return "continue"
    if any(phrase in normalized for phrase in new_phrases):
        return "new"
    if any(phrase in normalized for phrase in continue_phrases):
        return "continue"
    return None


def _append_session_chat(session_recent_chats: list[dict[str, str]], role: str, message: str) -> None:
    clean_role = "assistant" if str(role).strip().lower() == "assistant" else "user"
    session_recent_chats.append(
        {
            "role": clean_role,
            "message": _trim_text(message, 220),
            "created_at": "",
        }
    )
    if len(session_recent_chats) > 10:
        del session_recent_chats[:-10]


async def _emit_realtime_tts(
    websocket: WebSocket,
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None = None,
    speech_mode: str | None = None,
) -> None:
    tts = await synthesize_speech(
        text=text,
        locale_hint=locale_hint,
        voice_hint=voice_hint,
        speech_mode=speech_mode,
    )
    encoded_audio = base64.b64encode(tts.audio_bytes).decode("ascii")
    chars_per_chunk = 24000
    total_chunks = max(1, (len(encoded_audio) + chars_per_chunk - 1) // chars_per_chunk)
    for index in range(total_chunks):
        start = index * chars_per_chunk
        end = start + chars_per_chunk
        await websocket.send_json(
            {
                "type": "tts.audio.chunk",
                "audio": encoded_audio[start:end],
                "mime_type": tts.mime_type,
                "index": index,
                "is_last": index == total_chunks - 1,
            }
        )
    await websocket.send_json({"type": "tts.audio.end", "model": tts.model})


@router.websocket("/realtime-voice")
async def realtime_voice(websocket: WebSocket) -> None:
    token = _extract_ws_token(websocket)
    device_id = _extract_ws_device_id(websocket) or None
    db = SessionLocal()
    try:
        user = get_user_from_token(db, token, device_id=device_id) if token else None
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

        recent_messages = list_messages(db, user.id, limit=8)
        has_history = len(recent_messages) > 0
        conversation_mode = "new"
        session_recent_chats: list[dict[str, str]] = []
        session_recent_interactions: list[dict[str, str]] = []
        welcome_text = (
            "Hello, this is GRIK live voice. We can continue from earlier context or start fresh. "
            "You can say continue or start new."
            if has_history
            else "Hello, this is GRIK live voice. I am ready. We can discuss your farm or any general question."
        )

        await websocket.accept()
        await websocket.send_json(
            {
                "type": "session.ready",
                "message": "Realtime voice session connected.",
                "has_history": has_history,
                "recent_message_count": len(recent_messages),
                "welcome_text": welcome_text,
                "conversation_mode": conversation_mode,
                "capabilities": {
                    "audio_chunk_ingest": True,
                    "stt_incremental_events": True,
                    "assistant_text_stream": True,
                    "tts_chunk_stream": True,
                    "voice_hint_control": True,
                },
            }
        )

        audio_buffer = bytearray()
        mime_type = "audio/webm"
        locale_hint: str | None = None
        location_hint: str | None = None
        voice_hint: str | None = None

        while True:
            raw: dict[str, Any] = await websocket.receive_json()
            event_type = str(raw.get("type") or "").strip().lower()

            if event_type in {"ping", "session.ping"}:
                await websocket.send_json({"type": "pong", "ts": int(time.time() * 1000)})
                continue

            if event_type == "session.stop":
                await websocket.send_json({"type": "session.stopped"})
                await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                break

            if event_type == "session.update":
                locale_hint = str(raw.get("locale_hint") or "").strip() or locale_hint
                location_hint = str(raw.get("location_hint") or "").strip() or location_hint
                if "voice_hint" in raw:
                    requested_voice_hint = str(raw.get("voice_hint") or "").strip()
                    voice_hint = requested_voice_hint or None
                requested_mode = str(raw.get("conversation_mode") or "").strip().lower()
                if requested_mode in {"new", "continue"}:
                    conversation_mode = requested_mode
                    if conversation_mode == "new":
                        session_recent_chats.clear()
                        session_recent_interactions.clear()
                await websocket.send_json(
                    {
                        "type": "session.updated",
                        "locale_hint": locale_hint,
                        "location_hint": location_hint,
                        "voice_hint": voice_hint,
                        "conversation_mode": conversation_mode,
                    }
                )
                continue

            if event_type == "session.path":
                requested_path = str(raw.get("path") or "").strip().lower()
                if requested_path not in {"new", "continue"}:
                    await websocket.send_json(
                        {"type": "error", "stage": "session.path", "detail": "Path must be 'new' or 'continue'."}
                    )
                    continue
                conversation_mode = requested_path
                if conversation_mode == "new":
                    session_recent_chats.clear()
                    session_recent_interactions.clear()
                    mode_message = "Starting a fresh conversation. What would you like to discuss?"
                else:
                    mode_message = "Continuing with previous context. What should we focus on now?"
                await websocket.send_json(
                    {"type": "session.mode", "mode": conversation_mode, "message": mode_message}
                )
                continue

            if event_type == "audio.chunk":
                incoming_mime = str(raw.get("mime_type") or "").strip().lower()
                if incoming_mime:
                    mime_type = incoming_mime

                encoded = str(raw.get("audio") or "").strip()
                if not encoded:
                    await websocket.send_json({"type": "error", "stage": "audio.chunk", "detail": "Missing base64 audio chunk."})
                    continue
                try:
                    chunk = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError):
                    await websocket.send_json({"type": "error", "stage": "audio.chunk", "detail": "Invalid base64 audio chunk."})
                    continue

                if not chunk:
                    await websocket.send_json({"type": "error", "stage": "audio.chunk", "detail": "Empty audio chunk."})
                    continue

                audio_buffer.extend(chunk)
                # Incremental STT scaffold event (real partial decode can replace this later).
                await websocket.send_json(
                    {
                        "type": "stt.partial",
                        "text": "",
                        "buffer_bytes": len(audio_buffer),
                        "note": "partial scaffold event",
                    }
                )
                continue

            if event_type in {"audio.commit", "audio.flush"}:
                if not audio_buffer:
                    await websocket.send_json({"type": "error", "stage": "audio.commit", "detail": "No buffered audio to transcribe."})
                    continue

                await websocket.send_json({"type": "stt.processing"})
                audio_bytes = bytes(audio_buffer)
                audio_buffer.clear()

                try:
                    transcript_result = await transcribe_audio_bytes(
                        content=audio_bytes,
                        mime_type=mime_type,
                        filename=f"realtime-{int(time.time())}.webm",
                        locale_hint=locale_hint,
                    )
                except (AudioValidationError, AudioUnavailableError) as exc:
                    await websocket.send_json({"type": "error", "stage": "stt", "detail": str(exc)})
                    continue

                transcript = str(transcript_result.get("transcript") or "").strip()
                detected_language = str(transcript_result.get("language") or "").strip() or None
                if not transcript:
                    await websocket.send_json({"type": "error", "stage": "stt", "detail": "No transcript produced."})
                    continue

                await websocket.send_json(
                    {
                        "type": "stt.final",
                        "text": transcript,
                        "language": detected_language,
                        "model": transcript_result.get("model"),
                    }
                )

                requested_mode = _conversation_mode_from_text(transcript)
                if has_history and requested_mode in {"new", "continue"}:
                    conversation_mode = requested_mode
                    if conversation_mode == "new":
                        session_recent_chats.clear()
                        session_recent_interactions.clear()
                        mode_reply = "Starting a fresh conversation. What would you like to discuss?"
                    else:
                        mode_reply = "Great, we will continue with previous context. What should we focus on now?"

                    await websocket.send_json(
                        {"type": "session.mode", "mode": conversation_mode, "message": mode_reply}
                    )
                    await websocket.send_json(
                        {
                            "type": "assistant.text.final",
                            "text": mode_reply,
                            "language": detected_language or locale_hint or "en",
                            "source_confidence": 0.0,
                            "citations": [],
                        }
                    )
                    try:
                        await _emit_realtime_tts(
                            websocket,
                            text=mode_reply,
                            locale_hint=detected_language or locale_hint,
                            voice_hint=voice_hint,
                        )
                    except (AudioValidationError, AudioUnavailableError) as exc:
                        await websocket.send_json({"type": "error", "stage": "tts", "detail": str(exc)})
                    continue

                try:
                    advice = generate_grik_chat_advice(
                        db=db,
                        user=user,
                        message=transcript,
                        locale_hint=locale_hint,
                        location_hint=location_hint,
                        include_stored_history=conversation_mode != "new",
                        session_recent_chats=session_recent_chats if conversation_mode == "new" else None,
                        session_recent_interactions=session_recent_interactions if conversation_mode == "new" else None,
                    )
                except AIUnavailableError as exc:
                    await websocket.send_json({"type": "error", "stage": "assistant", "detail": str(exc)})
                    continue

                reply_text = advice.reply
                # Stream text delta scaffold for realtime UX.
                for delta in _chunk_text_for_streaming(reply_text, chunk_size=140):
                    await websocket.send_json({"type": "assistant.text.delta", "delta": delta})
                    await asyncio.sleep(0.01)
                await websocket.send_json(
                    {
                        "type": "assistant.text.final",
                        "text": reply_text,
                        "language": advice.language,
                        "source_confidence": advice.source_confidence,
                        "citations": advice.citations,
                    }
                )

                _append_session_chat(session_recent_chats, "user", transcript)
                _append_session_chat(session_recent_chats, "assistant", reply_text)

                try:
                    create_message(db, user.id, "user", transcript)
                    create_message(db, user.id, "assistant", reply_text)
                except Exception as exc:
                    logger.warning("Realtime voice message persistence failed user_id=%s error=%s", user.id, exc)

                try:
                    record_interaction(
                        farmer_id=user.id,
                        phone=user.phone,
                        channel="web_realtime_voice",
                        message=transcript,
                        response=reply_text,
                        language=advice.language,
                        citations=advice.citations,
                        source_confidence=advice.source_confidence,
                    )
                except Exception as exc:
                    logger.warning("Realtime voice interaction persistence failed user_id=%s error=%s", user.id, exc)

                try:
                    await _emit_realtime_tts(
                        websocket,
                        text=reply_text,
                        locale_hint=advice.language,
                        voice_hint=voice_hint,
                        speech_mode="summary",
                    )
                except (AudioValidationError, AudioUnavailableError) as exc:
                    await websocket.send_json({"type": "error", "stage": "tts", "detail": str(exc)})
                continue

            if event_type == "text.input":
                text = str(raw.get("text") or "").strip()
                if not text:
                    await websocket.send_json({"type": "error", "stage": "text.input", "detail": "Text cannot be empty."})
                    continue
                requested_mode = _conversation_mode_from_text(text)
                if has_history and requested_mode in {"new", "continue"}:
                    conversation_mode = requested_mode
                    if conversation_mode == "new":
                        session_recent_chats.clear()
                        session_recent_interactions.clear()
                        mode_reply = "Starting a fresh conversation. What would you like to discuss?"
                    else:
                        mode_reply = "Great, we will continue with previous context. What should we focus on now?"
                    await websocket.send_json(
                        {"type": "session.mode", "mode": conversation_mode, "message": mode_reply}
                    )
                    await websocket.send_json(
                        {
                            "type": "assistant.text.final",
                            "text": mode_reply,
                            "language": locale_hint or "en",
                            "source_confidence": 0.0,
                            "citations": [],
                        }
                    )
                    continue
                try:
                    advice = generate_grik_chat_advice(
                        db=db,
                        user=user,
                        message=text,
                        locale_hint=locale_hint,
                        location_hint=location_hint,
                        include_stored_history=conversation_mode != "new",
                        session_recent_chats=session_recent_chats if conversation_mode == "new" else None,
                        session_recent_interactions=session_recent_interactions if conversation_mode == "new" else None,
                    )
                except AIUnavailableError as exc:
                    await websocket.send_json({"type": "error", "stage": "assistant", "detail": str(exc)})
                    continue
                _append_session_chat(session_recent_chats, "user", text)
                _append_session_chat(session_recent_chats, "assistant", advice.reply)
                await websocket.send_json(
                    {
                        "type": "assistant.text.final",
                        "text": advice.reply,
                        "language": advice.language,
                        "source_confidence": advice.source_confidence,
                        "citations": advice.citations,
                    }
                )
                continue

            await websocket.send_json({"type": "error", "stage": "event", "detail": f"Unsupported event type '{event_type}'."})

    except WebSocketDisconnect:
        logger.info("Realtime voice websocket disconnected")
    finally:
        db.close()


@router.post("/transcribe-audio", response_model=ChatAudioTranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    locale_hint: str | None = Form(None),
    user=Depends(get_current_user),
) -> ChatAudioTranscriptionResponse:
    logger.info(
        "GRIK audio transcription request received user_id=%s filename=%s",
        user.id,
        audio.filename or "uploaded-audio",
    )
    try:
        result = await transcribe_audio_upload(audio, locale_hint=locale_hint)
    except AudioValidationError as exc:
        logger.warning("GRIK audio transcription validation failed user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except AudioUnavailableError as exc:
        logger.warning("GRIK audio transcription unavailable user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=503, detail=str(exc))

    return ChatAudioTranscriptionResponse(
        transcript=result.get("transcript", ""),
        language=result.get("language"),
        confidence=result.get("confidence"),
        model=result.get("model", ""),
    )


@router.post("/synthesize-audio")
async def synthesize_audio(
    payload: ChatAudioSynthesisRequest,
    user=Depends(get_current_user),
) -> Response:
    logger.info(
        "GRIK audio synthesis request received user_id=%s text_chars=%s locale_hint=%s",
        user.id,
        len(payload.text or ""),
        payload.locale_hint or "",
    )
    try:
        result = await synthesize_speech(
            text=payload.text,
            locale_hint=payload.locale_hint,
            voice_hint=payload.voice_hint,
            speech_mode=payload.speech_mode,
        )
    except AudioValidationError as exc:
        logger.warning("GRIK audio synthesis validation failed user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except AudioUnavailableError as exc:
        logger.warning("GRIK audio synthesis unavailable user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=503, detail=str(exc))

    return Response(
        content=result.audio_bytes,
        media_type=result.mime_type,
        headers={
            "Cache-Control": "no-store",
            "X-GRIK-TTS-Model": result.model,
            "X-GRIK-TTS-Speech-Mode": (payload.speech_mode or "full").strip().lower() or "full",
        },
    )


@router.post("/ask", response_model=AdviceResponse)
def ask(payload: ChatAskRequest, db: Session = Depends(get_db), user=Depends(get_current_user)) -> AdviceResponse:
    logger.info("GRIK chat request received user_id=%s", user.id)
    try:
        advice = generate_grik_chat_advice(
            db=db,
            user=user,
            message=payload.message,
            locale_hint=payload.locale_hint,
            location_hint=payload.location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    reply_text = advice.reply

    try:
        create_message(db, user.id, "user", payload.message)
        create_message(db, user.id, "assistant", reply_text)
    except Exception as exc:
        logger.warning("Failed to persist chat messages user_id=%s error=%s", user.id, exc)

    try:
        record_interaction(
            farmer_id=user.id,
            phone=user.phone,
            channel="web",
            message=payload.message,
            response=reply_text,
            language=advice.language,
            citations=advice.citations,
            source_confidence=advice.source_confidence,
        )
    except Exception as exc:
        logger.warning("Failed to persist interaction memory user_id=%s error=%s", user.id, exc)

    logger.info(
        "GRIK chat response ready user_id=%s language=%s source_confidence=%s",
        user.id,
        advice.language,
        advice.source_confidence,
    )

    return AdviceResponse(
        reply=reply_text,
        language=advice.language,
        sources=advice.sources,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
        citation_text=advice.citation_text,
        follow_ups=advice.follow_ups,
    )


@router.post("/ask-multimodal", response_model=AdviceResponse)
async def ask_multimodal(
    message: str = Form(...),
    locale_hint: str | None = Form(None),
    location_hint: str | None = Form(None),
    crop_hint: str | None = Form(None),
    vision_model_preference: str | None = Form(None, alias="model_preference"),
    deep_analysis: bool = Form(False),
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> AdviceResponse:
    if not files:
        raise HTTPException(status_code=400, detail="Attach at least one image or extracted video frame.")

    logger.info("GRIK multimodal chat request received user_id=%s files=%s", user.id, len(files))
    try:
        media_analysis = await analyze_crop_media(
            files=files,
            farmer_message=message,
            crop_hint=crop_hint,
            model_preference=vision_model_preference,
            deep_analysis=deep_analysis,
        )
    except VisionValidationError as exc:
        logger.warning("GRIK multimodal validation failed user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except VisionUnavailableError as exc:
        logger.warning("GRIK multimodal vision unavailable user_id=%s error=%s", user.id, exc)
        raise HTTPException(status_code=503, detail=str(exc))

    crop_context_line = f"Target crop selected by farmer: {crop_hint}" if crop_hint else "Target crop selected by farmer: not provided"
    augmented_message = (
        f"{message}\n\n"
        f"{crop_context_line}\n"
        "Visual analysis context from attached media:\n"
        f"{media_analysis.to_prompt_context()}\n\n"
        "Use this as probabilistic evidence. Recommend safe, field-verifiable next actions."
    )

    try:
        advice = generate_grik_chat_advice(
            db=db,
            user=user,
            message=augmented_message,
            locale_hint=locale_hint,
            location_hint=location_hint,
        )
    except AIUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    hint_parts = [f"Media attached: {media_analysis.media_count} file(s)"]
    if crop_hint:
        hint_parts.append(f"Crop: {crop_hint}")
    if vision_model_preference:
        hint_parts.append(f"Model pref: {vision_model_preference}")
    if deep_analysis:
        hint_parts.append("Deep analysis: on")
    user_message = f"{message}\n\n[{' | '.join(hint_parts)}]"
    reply_text = advice.reply

    try:
        create_message(db, user.id, "user", user_message)
        create_message(db, user.id, "assistant", reply_text)
    except Exception as exc:
        logger.warning("Failed to persist multimodal chat messages user_id=%s error=%s", user.id, exc)

    try:
        record_interaction(
            farmer_id=user.id,
            phone=user.phone,
            channel="web",
            message=user_message,
            response=reply_text,
            language=advice.language,
            citations=advice.citations,
            source_confidence=advice.source_confidence,
        )
    except Exception as exc:
        logger.warning("Failed to persist multimodal interaction memory user_id=%s error=%s", user.id, exc)

    return AdviceResponse(
        reply=reply_text,
        language=advice.language,
        sources=advice.sources,
        citations=advice.citations,
        source_confidence=advice.source_confidence,
        citation_text=advice.citation_text,
        follow_ups=advice.follow_ups,
        media_analysis=media_analysis.to_response_dict(),
    )


@router.get("/vision/options")
def vision_options(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    profile = db.query(FarmerProfile).filter(FarmerProfile.farmer_id == user.id).first()
    crops = [str(item).strip() for item in ((profile.crops if profile else []) or []) if str(item).strip()]
    return {
        "models": get_vision_model_options(),
        "crops": crops,
    }


@router.get("/history", response_model=ChatHistoryResponse)
def history(limit: int = 30, db: Session = Depends(get_db), user=Depends(get_current_user)) -> ChatHistoryResponse:
    rows = list_messages(db, user.id, limit=limit)
    items = [
        ChatMessageOut(id=row.id, role=row.role, message=row.message, created_at=row.created_at)
        for row in reversed(rows)
    ]
    return ChatHistoryResponse(items=items)
