from datetime import datetime
from pydantic import BaseModel


class ChatAskRequest(BaseModel):
    message: str
    locale_hint: str | None = None
    location_hint: str | None = None


class ChatAudioTranscriptionResponse(BaseModel):
    transcript: str
    language: str | None = None
    confidence: float | None = None
    model: str


class ChatAudioSynthesisRequest(BaseModel):
    text: str
    locale_hint: str | None = None
    voice_hint: str | None = None
    speech_mode: str | None = None


class ChatMessageOut(BaseModel):
    id: int
    role: str
    message: str
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    items: list[ChatMessageOut]
