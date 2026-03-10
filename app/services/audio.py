import asyncio
import base64
import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

import httpx
from fastapi import UploadFile

from app.core.config import get_ai_provider_config
from app.services.language import detect_language, normalize_locale_hint

logger = logging.getLogger("agrik.audio")

SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/ogg",
    "audio/webm",
    "audio/mp4",
    "audio/x-m4a",
    "audio/flac",
}

SUPPORTED_AUDIO_SUFFIXES = {
    ".wav",
    ".mp3",
    ".ogg",
    ".webm",
    ".m4a",
    ".mp4",
    ".flac",
}

MODEL_UNAVAILABLE_TTL_SECONDS = 900
_MODEL_UNAVAILABLE_UNTIL: Dict[str, float] = {}
_COQUI_LOCK = threading.Lock()
_COQUI_MODEL: Any = None
_COQUI_CONFIG: Any = None
_COQUI_MODEL_TAG: str = ""
_FASTER_WHISPER_LOCK = threading.Lock()
_FASTER_WHISPER_MODEL: Any = None
_FASTER_WHISPER_MODEL_TAG: str = ""
_OPENAI_WHISPER_LOCK = threading.Lock()
_OPENAI_WHISPER_MODEL: Any = None
_OPENAI_WHISPER_MODEL_TAG: str = ""

VOICE_PROFILE_ALIASES = {
    "auto": "auto",
    "default": "auto",
    "standard": "neutral",
    "neutral": "neutral",
    "global": "neutral",
    "uganda": "uganda",
    "ugandan": "uganda",
    "ug": "uganda",
    "kampala": "uganda",
    "east_africa": "east_africa",
    "eastafrica": "east_africa",
    "east-africa": "east_africa",
    "ea": "east_africa",
    "swahili": "east_africa",
}

LOCALE_VOICE_PROFILE_MAP = {
    "lg": "uganda",
    "nyn": "uganda",
    "ach": "uganda",
    "teo": "uganda",
    "sw": "east_africa",
}

LOCALE_STT_LANGUAGE_MAP = {
    "en": "en",
    "sw": "sw",
}


class AudioUnavailableError(RuntimeError):
    pass


class AudioValidationError(ValueError):
    pass


@dataclass
class ValidatedAudio:
    filename: str
    mime_type: str
    content: bytes


@dataclass
class AudioSynthesisResult:
    audio_bytes: bytes
    mime_type: str
    model: str


def _trim(text: Any, limit: int = 260) -> str:
    cleaned = str(text or "").strip()
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: max(0, limit - 3)].rstrip()}..."


def _speech_friendly_text(text: str) -> str:
    spoken = str(text or "")
    # Keep the product name spoken like a name instead of individual letters.
    spoken = re.sub(r"\bGRIK\b", "Grik", spoken)
    spoken = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", spoken)
    spoken = re.sub(r"`([^`]*)`", r"\1", spoken)
    spoken = re.sub(r"^#{1,6}\s*", "", spoken, flags=re.MULTILINE)
    spoken = re.sub(r"^\s*[-*+]\s+", "", spoken, flags=re.MULTILINE)
    spoken = re.sub(r"^\s*\d+\.\s+", "", spoken, flags=re.MULTILINE)
    spoken = spoken.replace("**", " ").replace("__", " ")
    spoken = spoken.replace("*", " ").replace("_", " ")
    spoken = re.sub(r"(^|\s)#(\w+)", r"\1\2", spoken)
    spoken = re.sub(r"\s+", " ", spoken).strip()
    return spoken


def _extract_markdown_section(text: str, heading: str) -> str:
    if not text.strip():
        return ""
    pattern = re.compile(
        rf"^\s*###\s+{re.escape(heading)}\s*$\n?(.*?)(?=^\s*###\s+|\Z)",
        flags=re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def _plain_text_lines(text: str) -> list[str]:
    cleaned = str(text or "")
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    lines: list[str] = []
    for raw in cleaned.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("|"):
            continue
        line = re.sub(r"^\s*[-*+]\s+", "", line)
        line = re.sub(r"^\s*\d+\.\s+", "", line)
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    return lines


def _first_sentence(text: str, max_chars: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if not cleaned:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    sentence = parts[0].strip()
    if len(sentence) <= max_chars:
        return sentence
    return _truncate_tts_text(sentence, max_chars)


def _table_action_sentences(section: str, limit: int = 2) -> list[str]:
    sentences: list[str] = []
    ordinal_labels = ["First", "Then", "Next"]
    for raw in section.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            continue
        if re.search(r"\baction\b", line, flags=re.IGNORECASE):
            continue
        if re.fullmatch(r"\|\s*:?-{2,}:?\s*\|\s*:?-{2,}:?\s*\|\s*:?-{2,}:?\s*\|?", line):
            continue
        columns = [part.strip() for part in line.strip("|").split("|")]
        if len(columns) < 2:
            continue
        action = re.sub(r"\s+", " ", columns[0]).strip(" .")
        how = re.sub(r"\s+", " ", columns[1]).strip(" .")
        if not action or not how:
            continue
        prefix = ordinal_labels[min(len(sentences), len(ordinal_labels) - 1)]
        sentences.append(f"{prefix}, {action.lower()}: {how}.")
        if len(sentences) >= limit:
            break
    return sentences


def summarize_text_for_voice(text: str, max_chars: int = 520) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""

    diagnosis_section = _extract_markdown_section(raw, "Quick diagnosis")
    actions_section = _extract_markdown_section(raw, "Immediate actions (today)")
    monitoring_section = _extract_markdown_section(raw, "Monitoring checklist")

    summary_parts: list[str] = []

    diagnosis_lines = _plain_text_lines(diagnosis_section)
    diagnosis_text = _first_sentence(" ".join(diagnosis_lines) or diagnosis_section, max_chars=220)
    if diagnosis_text:
        summary_parts.append(diagnosis_text)

    action_sentences = _table_action_sentences(actions_section, limit=2)
    if not action_sentences:
        action_lines = _plain_text_lines(actions_section)[:2]
        action_sentences = [f"Action: {line}." for line in action_lines if line]
    summary_parts.extend(action_sentences[:2])

    monitoring_lines = _plain_text_lines(monitoring_section)
    if monitoring_lines:
        monitoring_phrase = monitoring_lines[0].rstrip(".")
        if monitoring_phrase:
            monitoring_phrase = monitoring_phrase[:1].lower() + monitoring_phrase[1:]
            summary_parts.append(f"Monitor for {monitoring_phrase}.")

    if not summary_parts:
        fallback = _first_sentence(_speech_friendly_text(raw), max_chars=max_chars)
        return fallback

    summary = " ".join(part.strip() for part in summary_parts if part.strip())
    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) <= max_chars:
        return summary
    return _truncate_tts_text(summary, max_chars)


def _truncate_tts_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    candidate = text[: max_chars + 1]
    min_boundary = int(max_chars * 0.6)
    for separator in (". ", "? ", "! ", "; ", ", "):
        boundary = candidate.rfind(separator)
        if boundary >= min_boundary:
            return candidate[: boundary + 1].strip()
    trimmed = candidate[:max_chars].rstrip(" .,:;!?")
    return f"{trimmed}."


def _normalize_voice_profile(value: str | None) -> str | None:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    if not normalized:
        return None
    return VOICE_PROFILE_ALIASES.get(normalized)


def _voice_profile_from_locale(locale_hint: str | None) -> str | None:
    normalized_locale = normalize_locale_hint(locale_hint)
    if not normalized_locale:
        return None
    return LOCALE_VOICE_PROFILE_MAP.get(normalized_locale)


def _effective_voice_profile(
    *,
    voice_hint: str | None,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> str | None:
    requested_profile = _normalize_voice_profile(voice_hint)
    if requested_profile and requested_profile != "auto":
        return requested_profile

    default_profile = _normalize_voice_profile(str(cfg.get("tts_voice_profile_default") or ""))
    if default_profile and default_profile != "auto":
        return default_profile

    return _voice_profile_from_locale(locale_hint)


def _cfg_value_for_profile(cfg: Dict[str, Any], base_key: str, profile: str | None) -> str:
    if not profile:
        return ""
    return str(cfg.get(f"{base_key}_{profile}") or "").strip()


def _resolve_hf_tts_voice_preset(
    *,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
    configured_voice: str,
) -> str:
    requested = str(voice_hint or "").strip()
    requested_profile = _normalize_voice_profile(requested)
    if requested and not requested_profile:
        return requested

    profile = _effective_voice_profile(voice_hint=requested, locale_hint=locale_hint, cfg=cfg)
    from_profile = _cfg_value_for_profile(cfg, "hf_tts_voice_preset", profile)
    if from_profile:
        return from_profile
    return str(configured_voice or "").strip()


def _resolve_elevenlabs_voice_id(
    *,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
    default_voice_id: str,
) -> str:
    requested = str(voice_hint or "").strip()
    requested_profile = _normalize_voice_profile(requested)
    if requested and not requested_profile:
        return requested

    profile = _effective_voice_profile(voice_hint=requested, locale_hint=locale_hint, cfg=cfg)
    from_profile = _cfg_value_for_profile(cfg, "elevenlabs_voice_id", profile)
    if from_profile:
        return from_profile

    return str(default_voice_id or "").strip()


def _model_unavailable_key(model_id: str) -> str:
    return str(model_id or "").strip().lower()


def _is_model_temporarily_unavailable(model_id: str) -> bool:
    until = _MODEL_UNAVAILABLE_UNTIL.get(_model_unavailable_key(model_id), 0.0)
    return time.time() < until


def _mark_model_unavailable(model_id: str) -> None:
    key = _model_unavailable_key(model_id)
    if not key:
        return
    _MODEL_UNAVAILABLE_UNTIL[key] = time.time() + MODEL_UNAVAILABLE_TTL_SECONDS


def _looks_like_audio(content: bytes, mime_type: str, filename: str) -> bool:
    lower_mime = str(mime_type or "").split(";")[0].strip().lower()
    if lower_mime in SUPPORTED_AUDIO_MIME_TYPES:
        return True

    lowered_name = str(filename or "").strip().lower()
    if any(lowered_name.endswith(suffix) for suffix in SUPPORTED_AUDIO_SUFFIXES):
        return True

    # WAV
    if content.startswith(b"RIFF") and b"WAVE" in content[:16]:
        return True
    # MP3
    if content.startswith(b"ID3") or content.startswith(b"\xff\xfb"):
        return True
    # OGG
    if content.startswith(b"OggS"):
        return True
    # FLAC
    if content.startswith(b"fLaC"):
        return True
    # WebM / Matroska
    if content.startswith(b"\x1a\x45\xdf\xa3"):
        return True
    # MP4 / M4A
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return True
    return False


def _normalize_audio_mime(content: bytes, mime_type: str, filename: str) -> str:
    lower_mime = str(mime_type or "").split(";")[0].strip().lower()
    if lower_mime in SUPPORTED_AUDIO_MIME_TYPES:
        if lower_mime == "audio/mp3":
            return "audio/mpeg"
        if lower_mime in {"audio/x-wav", "audio/wave"}:
            return "audio/wav"
        if lower_mime == "audio/x-m4a":
            return "audio/mp4"
        return lower_mime

    lowered_name = str(filename or "").strip().lower()
    if lowered_name.endswith(".wav"):
        return "audio/wav"
    if lowered_name.endswith(".mp3"):
        return "audio/mpeg"
    if lowered_name.endswith(".ogg"):
        return "audio/ogg"
    if lowered_name.endswith(".webm"):
        return "audio/webm"
    if lowered_name.endswith(".flac"):
        return "audio/flac"
    if lowered_name.endswith(".m4a") or lowered_name.endswith(".mp4"):
        return "audio/mp4"

    if content.startswith(b"RIFF") and b"WAVE" in content[:16]:
        return "audio/wav"
    if content.startswith(b"ID3") or content.startswith(b"\xff\xfb"):
        return "audio/mpeg"
    if content.startswith(b"OggS"):
        return "audio/ogg"
    if content.startswith(b"fLaC"):
        return "audio/flac"
    if content.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return "audio/mp4"
    return "application/octet-stream"


def _audio_suffix_for_mime(mime_type: str, filename: str) -> str:
    suffix = Path(str(filename or "").strip()).suffix.lower()
    if suffix in SUPPORTED_AUDIO_SUFFIXES:
        return suffix

    normalized_mime = str(mime_type or "").split(";")[0].strip().lower()
    if normalized_mime in {"audio/wav", "audio/x-wav", "audio/wave"}:
        return ".wav"
    if normalized_mime in {"audio/mpeg", "audio/mp3"}:
        return ".mp3"
    if normalized_mime == "audio/ogg":
        return ".ogg"
    if normalized_mime == "audio/webm":
        return ".webm"
    if normalized_mime in {"audio/mp4", "audio/x-m4a"}:
        return ".m4a"
    if normalized_mime == "audio/flac":
        return ".flac"
    return ".wav"


def _parse_error_detail(payload: Any, fallback_text: str = "") -> str:
    if isinstance(payload, dict):
        for key in ("error", "message", "detail", "warning"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return _trim(value, 260)
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            nested = _parse_error_detail(first, "")
            if nested:
                return nested
        if isinstance(first, str) and first.strip():
            return _trim(first, 260)
    return _trim(fallback_text, 260) if fallback_text else "Unknown audio model error."


def _extract_estimated_wait(payload: Any, default_wait: float) -> float:
    if isinstance(payload, dict):
        raw = payload.get("estimated_time")
        try:
            wait = float(raw)
        except (TypeError, ValueError):
            wait = default_wait
        return min(12.0, max(0.5, wait))
    return min(12.0, max(0.5, default_wait))


def _extract_transcript(payload: Any) -> str:
    if isinstance(payload, str):
        return payload.strip()

    if isinstance(payload, dict):
        for key in ("text", "transcript", "generated_text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        chunks = payload.get("chunks")
        if isinstance(chunks, list):
            parts: list[str] = []
            for item in chunks:
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            if parts:
                return " ".join(parts).strip()

        output = payload.get("output")
        if output is not None:
            maybe = _extract_transcript(output)
            if maybe:
                return maybe

    if isinstance(payload, list) and payload:
        parts: list[str] = []
        for item in payload:
            maybe = _extract_transcript(item)
            if maybe:
                parts.append(maybe)
        if parts:
            return " ".join(parts).strip()

    return ""


def _parse_data_uri_base64(value: str) -> bytes:
    if not value:
        return b""
    raw = value.strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1].strip()
    try:
        return base64.b64decode(raw, validate=True)
    except (ValueError, TypeError):
        return b""


def _extract_audio_bytes(payload: Any) -> bytes:
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)

    if isinstance(payload, list) and payload:
        # Some providers may return raw PCM as integer array.
        if all(isinstance(item, int) and 0 <= item <= 255 for item in payload):
            return bytes(payload)
        for item in payload:
            audio = _extract_audio_bytes(item)
            if audio:
                return audio

    if not isinstance(payload, dict):
        return b""

    for key in ("audio", "generated_audio", "blob", "data"):
        value = payload.get(key)
        if isinstance(value, str):
            decoded = _parse_data_uri_base64(value)
            if decoded:
                return decoded
        if isinstance(value, list):
            nested = _extract_audio_bytes(value)
            if nested:
                return nested
        if isinstance(value, dict):
            nested = _extract_audio_bytes(value)
            if nested:
                return nested
    return b""


def _normalize_output_mime(header_value: str, payload_bytes: bytes) -> str:
    raw = str(header_value or "").split(";")[0].strip().lower()
    if raw.startswith("audio/"):
        if raw in {"audio/x-wav", "audio/wave"}:
            return "audio/wav"
        if raw == "audio/mp3":
            return "audio/mpeg"
        if raw == "audio/x-m4a":
            return "audio/mp4"
        return raw
    return _normalize_audio_mime(payload_bytes, "", "grik-audio")


def _validate_audio_bytes(
    *,
    content: bytes,
    filename: str,
    incoming_mime: str,
    cfg: Dict[str, Any],
) -> ValidatedAudio:
    if not content:
        raise AudioValidationError(f"Empty audio upload: {filename}.")

    max_file_mb = max(1, int(cfg.get("hf_audio_max_file_mb", 12)))
    max_bytes = max_file_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise AudioValidationError(f"Audio file too large: {filename}. Limit is {max_file_mb} MB.")

    incoming_mime = str(incoming_mime or "").split(";")[0].strip().lower()
    if not _looks_like_audio(content, incoming_mime, filename):
        raise AudioValidationError(
            f"Unsupported audio format for {filename}. Use WAV, MP3, OGG, WEBM, M4A, MP4, or FLAC."
        )

    return ValidatedAudio(
        filename=filename,
        mime_type=_normalize_audio_mime(content, incoming_mime, filename),
        content=content,
    )


async def _validate_audio_upload(upload: UploadFile, cfg: Dict[str, Any]) -> ValidatedAudio:
    filename = upload.filename or "uploaded-audio"
    content = await upload.read()
    await upload.close()
    incoming_mime = str(upload.content_type or "").split(";")[0].strip().lower()
    return _validate_audio_bytes(
        content=content,
        filename=filename,
        incoming_mime=incoming_mime,
        cfg=cfg,
    )


def _ensure_audio_provider_ready(
    cfg: Dict[str, Any],
    model_key: str,
    mode: str,
    *,
    check_model_unavailable: bool = True,
) -> tuple[str, float, bool]:
    token = str(cfg.get("hf_token") or "").strip()
    if not token:
        raise AudioUnavailableError("HUGGINGFACE_API_TOKEN is missing for the Hugging Face audio backend.")

    model = str(cfg.get(model_key) or "").strip()
    if not model:
        raise AudioUnavailableError(f"{model_key.upper()} is missing. Audio fallback is disabled.")

    if check_model_unavailable and _is_model_temporarily_unavailable(model):
        raise AudioUnavailableError(
            f"Audio model '{model}' is temporarily marked unavailable after repeated provider errors."
        )

    timeout = float(cfg.get("hf_audio_timeout", cfg.get("hf_timeout", 60.0)))
    verify_ssl = bool(cfg.get("hf_verify_ssl", True))
    logger.info("Audio %s provider prepared model=%s", mode, model)
    return token, timeout, verify_ssl


def _build_audio_model_endpoints(cfg: Dict[str, Any], model: str) -> list[str]:
    configured = str(cfg.get("hf_audio_inference_base_url") or "").strip()
    env_extra = os.getenv("HF_AUDIO_ALT_BASE_URLS", "")
    env_candidates = [part.strip() for part in env_extra.split(",") if part and part.strip()]
    defaults = ["https://router.huggingface.co/hf-inference/models"]
    candidates = [configured, *env_candidates, *defaults]

    endpoints: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        base = _normalize_audio_inference_base(candidate)
        if not base:
            continue
        if "api-inference.huggingface.co" in base.lower():
            logger.warning("Ignoring deprecated Hugging Face audio endpoint base=%s", base)
            continue
        endpoint = f"{base}/{model}"
        if endpoint in seen:
            continue
        seen.add(endpoint)
        endpoints.append(endpoint)
    if not endpoints:
        fallback = f"https://router.huggingface.co/hf-inference/models/{model}"
        endpoints.append(fallback)
    return endpoints


def _normalize_audio_inference_base(candidate: str) -> str:
    raw = str(candidate or "").strip().strip("\"'")
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw.lstrip('/')}"
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        logger.warning("Ignoring invalid Hugging Face audio endpoint base=%s", candidate)
        return ""
    normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
    return normalized


def _is_name_resolution_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(
        fragment in message
        for fragment in (
            "name or service not known",
            "temporary failure in name resolution",
            "failed to resolve",
            "nodename nor servname provided",
        )
    )


def _format_audio_request_error(*, mode: str, endpoint: str, exc: Exception) -> str:
    if _is_name_resolution_error(exc):
        host = urlparse(endpoint).netloc or endpoint
        return (
            f"Hugging Face {mode.upper()} could not resolve '{host}'. "
            "Check HF_AUDIO_INFERENCE_BASE_URL or the server DNS configuration."
        )
    return f"Hugging Face {mode.upper()} request failed: {exc}"


def _dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in items:
        item = str(raw or "").strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def _stt_candidate_models(cfg: Dict[str, Any]) -> list[str]:
    primary = str(cfg.get("hf_stt_model") or "").strip()
    alt = cfg.get("hf_stt_alt_models") or []
    alt = [str(item).strip() for item in alt if str(item).strip()]
    return _dedupe_keep_order([primary, *alt])


def _normalize_coqui_language(locale_hint: str | None, cfg: Dict[str, Any]) -> str:
    normalized = normalize_locale_hint(locale_hint)
    if normalized in {"en", "sw", "lg", "nyn", "ach", "teo"}:
        return normalized
    fallback = str(cfg.get("coqui_tts_default_language") or "en").strip().lower()
    return fallback or "en"


def _pcm_wav_bytes(samples: Any, sample_rate: int = 24000) -> bytes:
    try:
        import numpy as np  # type: ignore
    except ImportError as exc:
        raise AudioUnavailableError("numpy is required for local Coqui TTS output conversion.") from exc

    arr = np.asarray(samples, dtype=np.float32)
    if arr.size == 0:
        raise AudioUnavailableError("Local Coqui TTS returned empty audio samples.")
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767.0).astype(np.int16)

    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _default_coqui_model_dir(model_id: str) -> Path:
    normalized = str(model_id or "").strip().lower()
    if normalized == "intronhealth/afro-tts":
        return Path("runtime/models/intronhealth/afro-tts")
    safe = str(model_id or "").strip().replace("\\", "_").replace("/", "_") or "default"
    return Path("runtime/models") / safe


def _resolve_coqui_paths(cfg: Dict[str, Any]) -> tuple[str, Path, Path, Path]:
    model_id = str(cfg.get("coqui_tts_model_id") or "intronhealth/afro-tts").strip()
    model_dir_raw = str(cfg.get("coqui_tts_model_dir") or "").strip()
    config_path_raw = str(cfg.get("coqui_tts_config_path") or "").strip()
    checkpoint_dir_raw = str(cfg.get("coqui_tts_checkpoint_dir") or "").strip()

    model_dir = Path(model_dir_raw) if model_dir_raw else _default_coqui_model_dir(model_id)
    config_path = Path(config_path_raw) if config_path_raw else (model_dir / "config.json")
    checkpoint_dir = Path(checkpoint_dir_raw) if checkpoint_dir_raw else model_dir
    return model_id, model_dir, config_path, checkpoint_dir


def _required_coqui_files(model_id: str) -> list[str]:
    normalized = str(model_id or "").strip().lower()
    if normalized == "intronhealth/afro-tts":
        return ["model.pth", "dvae.pth", "mel_stats.pth", "vocab.json"]
    return ["model.pth"]


def _validate_local_coqui_assets(
    *,
    model_id: str,
    model_dir: Path,
    config_path: Path,
    checkpoint_dir: Path,
) -> None:
    missing: list[str] = []
    if not model_dir.exists():
        missing.append(str(model_dir))
    if not config_path.exists():
        missing.append(str(config_path))
    if not checkpoint_dir.exists():
        missing.append(str(checkpoint_dir))
    else:
        for filename in _required_coqui_files(model_id):
            required_path = checkpoint_dir / filename
            if not required_path.exists():
                missing.append(str(required_path))

    if not missing:
        return
    listed = "; ".join(missing[:6])
    if len(missing) > 6:
        listed = f"{listed}; ..."
    raise AudioUnavailableError(
        "Local Coqui TTS assets are incomplete. Missing: "
        f"{listed}. Ensure intronhealth/afro-tts files are present locally and "
        "set COQUI_TTS_MODEL_DIR / COQUI_TTS_CONFIG_PATH / COQUI_TTS_CHECKPOINT_DIR."
    )


def _resolve_coqui_speaker_path(
    voice_hint: str | None,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Path:
    explicit_voice = str(voice_hint or "").strip()
    explicit_profile = _normalize_voice_profile(explicit_voice)
    if explicit_voice and not explicit_profile:
        explicit_path = Path(explicit_voice)
        if not explicit_path.exists():
            raise AudioValidationError(f"Speaker reference WAV not found: {explicit_path}")
        return explicit_path

    profile = _effective_voice_profile(voice_hint=explicit_voice, locale_hint=locale_hint, cfg=cfg)
    from_profile = _cfg_value_for_profile(cfg, "coqui_tts_speaker_wav", profile)
    if from_profile:
        profile_path = Path(from_profile)
        if not profile_path.exists():
            raise AudioValidationError(f"Speaker reference WAV not found: {profile_path}")
        return profile_path

    _, model_dir, _, _ = _resolve_coqui_paths(cfg)
    configured = str(cfg.get("coqui_tts_speaker_wav") or "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(model_dir / "audios" / "reference_accent.wav")
    candidates.append(model_dir / "reference_accent.wav")

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate

    if configured:
        fallback_checked = ", ".join(str(item) for item in candidates[1:])
        raise AudioValidationError(
            f"Speaker reference WAV not found: {configured}. Checked fallbacks: {fallback_checked}"
        )
    raise AudioValidationError(
        "COQUI_TTS_SPEAKER_WAV is required for afro-tts voice cloning. "
        "Set it or place reference_accent.wav under the model directory."
    )


def _ensure_local_coqui_model(cfg: Dict[str, Any]) -> tuple[Any, Any]:
    global _COQUI_MODEL, _COQUI_CONFIG, _COQUI_MODEL_TAG

    model_id, model_dir, config_path, checkpoint_dir = _resolve_coqui_paths(cfg)
    model_tag = f"{model_id}|{model_dir}|{config_path}|{checkpoint_dir}"

    with _COQUI_LOCK:
        if _COQUI_MODEL is not None and _COQUI_CONFIG is not None and _COQUI_MODEL_TAG == model_tag:
            return _COQUI_MODEL, _COQUI_CONFIG

        _validate_local_coqui_assets(
            model_id=model_id,
            model_dir=model_dir,
            config_path=config_path,
            checkpoint_dir=checkpoint_dir,
        )

        try:
            from TTS.tts.configs.xtts_config import XttsConfig  # type: ignore
            from TTS.tts.models.xtts import Xtts  # type: ignore
        except ImportError as exc:
            raise AudioUnavailableError("TTS package is not installed. Run `pip install TTS`.") from exc

        config = XttsConfig()
        config.load_json(str(config_path))
        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=str(checkpoint_dir), eval=True)

        use_cuda = bool(cfg.get("coqui_tts_use_cuda", True))
        if use_cuda:
            try:
                import torch  # type: ignore

                if torch.cuda.is_available():
                    model.cuda()
            except Exception:
                logger.warning("Coqui TTS CUDA initialization skipped; running on CPU.")

        _COQUI_MODEL = model
        _COQUI_CONFIG = config
        _COQUI_MODEL_TAG = model_tag
        return _COQUI_MODEL, _COQUI_CONFIG


def _synthesize_local_coqui(
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> AudioSynthesisResult:
    model, config = _ensure_local_coqui_model(cfg)
    speaker_path = _resolve_coqui_speaker_path(voice_hint, locale_hint, cfg)

    gpt_cond_len = max(1, int(cfg.get("coqui_tts_gpt_cond_len", 3)))
    language = _normalize_coqui_language(locale_hint, cfg)

    outputs = model.synthesize(
        text,
        config,
        speaker_wav=str(speaker_path),
        gpt_cond_len=gpt_cond_len,
        language=language,
    )

    wav_samples = outputs.get("wav") if isinstance(outputs, dict) else None
    if wav_samples is None:
        raise AudioUnavailableError("Afro-TTS did not return wav samples.")

    audio_bytes = _pcm_wav_bytes(wav_samples, sample_rate=24000)
    model_name = str(cfg.get("coqui_tts_model_id") or "intronhealth/afro-tts")
    return AudioSynthesisResult(audio_bytes=audio_bytes, mime_type="audio/wav", model=model_name)


async def _synthesize_local_coqui_async(
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> AudioSynthesisResult:
    return await asyncio.to_thread(
        _synthesize_local_coqui,
        text=text,
        locale_hint=locale_hint,
        voice_hint=voice_hint,
        cfg=cfg,
    )


def _edge_voice_for_locale(locale_hint: str | None, cfg: Dict[str, Any], voice_hint: str | None) -> str:
    requested_voice = str(voice_hint or "").strip()
    requested_profile = _normalize_voice_profile(requested_voice)
    if requested_voice and not requested_profile:
        return requested_voice

    profile = _effective_voice_profile(voice_hint=requested_voice, locale_hint=locale_hint, cfg=cfg)
    from_profile = _cfg_value_for_profile(cfg, "edge_tts_voice", profile)
    if from_profile:
        return from_profile

    normalized = normalize_locale_hint(locale_hint) or "en"
    by_lang = {
        "en": str(cfg.get("edge_tts_voice_en") or "").strip(),
        "sw": str(cfg.get("edge_tts_voice_sw") or "").strip(),
        "lg": str(cfg.get("edge_tts_voice_lg") or "").strip(),
        "nyn": str(cfg.get("edge_tts_voice_nyn") or "").strip(),
        "ach": str(cfg.get("edge_tts_voice_ach") or "").strip(),
        "teo": str(cfg.get("edge_tts_voice_teo") or "").strip(),
    }
    selected = by_lang.get(normalized, "")
    if selected:
        return selected
    default_voice = str(cfg.get("edge_tts_voice_default") or "").strip()
    return default_voice or "en-NG-EzinneNeural"


def _edge_tts_error_detail(exc: Exception) -> str:
    status = getattr(exc, "status", None)
    if status == 403:
        return (
            "edge-tts request was rejected by the upstream speech service (HTTP 403). "
            "Try again later or switch TTS_BACKEND to piper/elevenlabs/huggingface/coqui."
        )
    if status == 429:
        return "edge-tts rate limit hit (HTTP 429). Try again in a moment."
    if status == 503:
        return "edge-tts service is temporarily unavailable (HTTP 503). Try again shortly."
    message = _trim(exc, 260)
    if message:
        return f"edge-tts request failed: {message}"
    return "edge-tts request failed."


def _piper_config_path_for_model(model_path: Path, configured: str) -> Path:
    raw = str(configured or "").strip()
    if raw:
        return Path(raw)
    return Path(f"{model_path}.json")


def _resolve_piper_assets(
    *,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> tuple[str, Path, Path, str]:
    binary = str(cfg.get("piper_binary_path") or "piper").strip() or "piper"
    binary_resolved = shutil.which(binary) or binary

    profile = _effective_voice_profile(voice_hint=voice_hint, locale_hint=locale_hint, cfg=cfg)
    model_raw = _cfg_value_for_profile(cfg, "piper_model_path", profile) or str(cfg.get("piper_model_path") or "").strip()
    if not model_raw:
        raise AudioUnavailableError("PIPER_MODEL_PATH is missing. Piper TTS is disabled.")

    model_path = Path(model_raw)
    if not model_path.exists():
        raise AudioUnavailableError(f"Piper model file not found: {model_path}")

    config_raw = _cfg_value_for_profile(cfg, "piper_model_config_path", profile) or str(cfg.get("piper_model_config_path") or "").strip()
    config_path = _piper_config_path_for_model(model_path, config_raw)
    if not config_path.exists():
        raise AudioUnavailableError(f"Piper model config file not found: {config_path}")

    speaker_id = _cfg_value_for_profile(cfg, "piper_speaker_id", profile) or str(cfg.get("piper_speaker_id") or "").strip()
    return binary_resolved, model_path, config_path, speaker_id


async def _synthesize_piper_tts(
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> AudioSynthesisResult:
    binary, model_path, config_path, speaker_id = _resolve_piper_assets(
        locale_hint=locale_hint,
        voice_hint=voice_hint,
        cfg=cfg,
    )

    timeout = float(cfg.get("hf_audio_timeout", cfg.get("hf_timeout", 60.0)))
    length_scale = float(cfg.get("piper_length_scale", 1.0))
    noise_scale = float(cfg.get("piper_noise_scale", 0.667))
    noise_w = float(cfg.get("piper_noise_w", 0.8))

    fd, output_file = tempfile.mkstemp(prefix="agrik-piper-", suffix=".wav")
    os.close(fd)
    try:
        command = [
            binary,
            "--model",
            str(model_path),
            "--config",
            str(config_path),
            "--output_file",
            output_file,
            "--length_scale",
            str(length_scale),
            "--noise_scale",
            str(noise_scale),
            "--noise_w",
            str(noise_w),
        ]
        if speaker_id:
            command.extend(["--speaker", str(speaker_id)])

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise AudioUnavailableError(
                f"Piper binary was not found: {binary}. Install Piper and set PIPER_BINARY_PATH."
            ) from exc

        try:
            _, stderr = await asyncio.wait_for(process.communicate(input=f"{text}\n".encode("utf-8")), timeout=timeout)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise AudioUnavailableError("Piper TTS timed out.") from exc

        if process.returncode != 0:
            detail = _trim(stderr.decode("utf-8", errors="ignore"), 300) or "Unknown Piper error."
            raise AudioUnavailableError(f"Piper TTS failed: {detail}")

        audio_bytes = Path(output_file).read_bytes() if Path(output_file).exists() else b""
        if not audio_bytes:
            raise AudioUnavailableError("Piper TTS returned no audio bytes.")

        return AudioSynthesisResult(
            audio_bytes=audio_bytes,
            mime_type="audio/wav",
            model=f"piper:{model_path.name}",
        )
    finally:
        try:
            Path(output_file).unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to clean up Piper temp output file: %s", output_file)


async def _synthesize_edge_tts(
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> AudioSynthesisResult:
    try:
        import edge_tts  # type: ignore
    except ImportError as exc:
        raise AudioUnavailableError("edge-tts package is not installed. Run `pip install edge-tts`.") from exc

    voice = _edge_voice_for_locale(locale_hint, cfg, voice_hint)
    rate = str(cfg.get("edge_tts_rate") or "+0%").strip() or "+0%"
    pitch = str(cfg.get("edge_tts_pitch") or "+0Hz").strip() or "+0Hz"

    chunks: list[bytes] = []
    try:
        communicator = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
        async for event in communicator.stream():
            if event.get("type") == "audio":
                data = event.get("data")
                if isinstance(data, (bytes, bytearray)):
                    chunks.append(bytes(data))
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        detail = _edge_tts_error_detail(exc)
        logger.warning("Edge TTS synthesis failed voice=%s locale=%s error=%s", voice, locale_hint or "", detail)
        raise AudioUnavailableError(detail) from exc

    if not chunks:
        raise AudioUnavailableError("edge-tts returned no audio bytes.")
    return AudioSynthesisResult(
        audio_bytes=b"".join(chunks),
        mime_type="audio/mpeg",
        model=f"edge-tts:{voice}",
    )


def _ensure_elevenlabs_ready(cfg: Dict[str, Any]) -> tuple[str, str, str, str, str, float, bool]:
    api_key = str(cfg.get("elevenlabs_api_key") or "").strip()
    if not api_key:
        raise AudioUnavailableError("ELEVENLABS_API_KEY is missing. ElevenLabs TTS is disabled.")

    base_url = str(cfg.get("elevenlabs_base_url") or "https://api.elevenlabs.io").strip().rstrip("/")
    if not base_url:
        base_url = "https://api.elevenlabs.io"

    voice_id = str(cfg.get("elevenlabs_voice_id") or "").strip()
    if not voice_id:
        raise AudioUnavailableError("ELEVENLABS_VOICE_ID is missing. ElevenLabs TTS is disabled.")

    model_id = str(cfg.get("elevenlabs_model_id") or "eleven_multilingual_v2").strip() or "eleven_multilingual_v2"
    output_format = str(cfg.get("elevenlabs_output_format") or "mp3_44100_128").strip() or "mp3_44100_128"
    timeout = float(cfg.get("hf_audio_timeout", cfg.get("hf_timeout", 60.0)))
    verify_ssl = bool(cfg.get("hf_verify_ssl", True))
    return api_key, base_url, voice_id, model_id, output_format, timeout, verify_ssl


async def _synthesize_elevenlabs(
    *,
    text: str,
    locale_hint: str | None,
    voice_hint: str | None,
    cfg: Dict[str, Any],
) -> AudioSynthesisResult:
    (
        api_key,
        base_url,
        default_voice_id,
        model_id,
        output_format,
        timeout,
        verify_ssl,
    ) = _ensure_elevenlabs_ready(cfg)

    voice_id = _resolve_elevenlabs_voice_id(
        locale_hint=locale_hint,
        voice_hint=voice_hint,
        cfg=cfg,
        default_voice_id=default_voice_id,
    )
    endpoint = f"{base_url}/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/*,application/json",
        "Content-Type": "application/json",
    }

    voice_settings = {
        "stability": min(1.0, max(0.0, float(cfg.get("elevenlabs_stability", 0.5)))),
        "similarity_boost": min(1.0, max(0.0, float(cfg.get("elevenlabs_similarity_boost", 0.75)))),
        "style": min(1.0, max(0.0, float(cfg.get("elevenlabs_style", 0.0)))),
        "use_speaker_boost": bool(cfg.get("elevenlabs_speaker_boost", True)),
    }
    payload: Dict[str, Any] = {
        "text": text,
        "model_id": model_id,
        "voice_settings": voice_settings,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout, verify=verify_ssl) as client:
            response = await client.post(
                endpoint,
                params={"output_format": output_format},
                headers=headers,
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise AudioUnavailableError(f"ElevenLabs TTS request failed: {exc}") from exc

    body: Any = None
    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = None
        detail = _parse_error_detail(body, response.text)
        raise AudioUnavailableError(f"ElevenLabs TTS error ({response.status_code}): {detail}")

    audio_bytes = bytes(response.content or b"")
    if not audio_bytes:
        raise AudioUnavailableError("ElevenLabs returned empty audio output.")

    mime_type = _normalize_output_mime(str(response.headers.get("content-type") or ""), audio_bytes)
    return AudioSynthesisResult(
        audio_bytes=audio_bytes,
        mime_type=mime_type,
        model=f"elevenlabs:{model_id}:{voice_id}",
    )


def _whisper_language_for_locale(locale_hint: str | None) -> str | None:
    normalized = normalize_locale_hint(locale_hint)
    if not normalized:
        return None
    return LOCALE_STT_LANGUAGE_MAP.get(normalized)


def _normalize_stt_backend_name(value: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    aliases = {
        "hf": "huggingface",
        "faster-whisper": "faster-whisper",
        "fasterwhisper": "faster-whisper",
        "openai-whisper": "openai-whisper",
        "openaiwhisper": "openai-whisper",
        "whisper": "openai-whisper",
        "local-whisper": "openai-whisper",
        "local": "openai-whisper",
        "none": "",
        "off": "",
        "disabled": "",
    }
    return aliases.get(normalized, normalized)


def _openai_whisper_model_label(cfg: Dict[str, Any]) -> str:
    return (
        str(cfg.get("openai_whisper_model_path") or "").strip()
        or str(cfg.get("openai_whisper_model") or "small").strip()
        or "small"
    )


def _ensure_openai_whisper_model(cfg: Dict[str, Any]) -> Any:
    global _OPENAI_WHISPER_MODEL, _OPENAI_WHISPER_MODEL_TAG

    configured_model_path = str(cfg.get("openai_whisper_model_path") or "").strip()
    model_name = str(cfg.get("openai_whisper_model") or "small").strip() or "small"
    model_dir = str(cfg.get("openai_whisper_model_dir") or "runtime/models/openai-whisper").strip() or "runtime/models/openai-whisper"
    device = str(cfg.get("openai_whisper_device") or "cpu").strip().lower() or "cpu"
    model_source = configured_model_path or model_name
    model_tag = f"{model_source}|{model_dir}|{device}"

    with _OPENAI_WHISPER_LOCK:
        if _OPENAI_WHISPER_MODEL is not None and _OPENAI_WHISPER_MODEL_TAG == model_tag:
            return _OPENAI_WHISPER_MODEL

        try:
            import whisper  # type: ignore
        except ImportError as exc:
            raise AudioUnavailableError(
                "openai-whisper is not installed. Run `pip install openai-whisper` "
                "or `pip install git+https://github.com/openai/whisper.git`."
            ) from exc

        download_root = Path(model_dir)
        download_root.mkdir(parents=True, exist_ok=True)
        try:
            model = whisper.load_model(model_source, device=device, download_root=str(download_root))
        except Exception as exc:
            raise AudioUnavailableError(
                f"Failed to load OpenAI Whisper model '{model_source}': {_trim(exc, 260)}"
            ) from exc

        _OPENAI_WHISPER_MODEL = model
        _OPENAI_WHISPER_MODEL_TAG = model_tag
        return _OPENAI_WHISPER_MODEL


def _transcribe_openai_whisper(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    model = _ensure_openai_whisper_model(cfg)
    language_hint = _whisper_language_for_locale(locale_hint)
    device = str(cfg.get("openai_whisper_device") or "cpu").strip().lower() or "cpu"

    fd, temp_path = tempfile.mkstemp(
        prefix="agrik-openai-whisper-",
        suffix=_audio_suffix_for_mime(validated.mime_type, validated.filename),
    )
    os.close(fd)
    path = Path(temp_path)
    try:
        path.write_bytes(validated.content)
        options: Dict[str, Any] = {
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "fp16": device != "cpu",
        }
        if language_hint:
            options["language"] = language_hint
        try:
            result = model.transcribe(str(path), **options)
        except Exception as exc:
            detail = _trim(exc, 260)
            if "ffmpeg" in detail.lower():
                raise AudioUnavailableError(
                    "OpenAI Whisper transcription failed because ffmpeg is missing. Install ffmpeg on the server."
                ) from exc
            raise AudioUnavailableError(f"OpenAI Whisper transcription failed: {detail}") from exc

        transcript = str((result or {}).get("text") or "").strip()
        if not transcript:
            raise AudioUnavailableError("OpenAI Whisper returned no transcript.")

        detected_language = str((result or {}).get("language") or "").strip() or detect_language(
            transcript,
            normalize_locale_hint(locale_hint),
        )[0]
        return {
            "transcript": transcript,
            "language": detected_language or "en",
            "confidence": 0.8,
            "model": f"openai-whisper:{_openai_whisper_model_label(cfg)}",
        }
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to clean up OpenAI Whisper temp file: %s", path)


async def _transcribe_local_openai_whisper_async(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    return await asyncio.to_thread(
        _transcribe_openai_whisper,
        validated=validated,
        locale_hint=locale_hint,
        cfg=cfg,
    )


def prewarm_audio_runtime(cfg: Dict[str, Any] | None = None) -> str:
    active_cfg = cfg or get_ai_provider_config()
    backend = _normalize_stt_backend_name(active_cfg.get("stt_backend"))
    if backend == "openai-whisper":
        _ensure_openai_whisper_model(active_cfg)
        return f"openai-whisper:{_openai_whisper_model_label(active_cfg)}"
    if backend == "faster-whisper":
        _ensure_faster_whisper_model(active_cfg)
        model_label = (
            str(active_cfg.get("faster_whisper_model_path") or "").strip()
            or str(active_cfg.get("faster_whisper_model_size") or "small").strip()
            or "small"
        )
        return f"faster-whisper:{model_label}"
    return backend or "none"


def _ensure_faster_whisper_model(cfg: Dict[str, Any]) -> Any:
    global _FASTER_WHISPER_MODEL, _FASTER_WHISPER_MODEL_TAG

    configured_model_path = str(cfg.get("faster_whisper_model_path") or "").strip()
    model_size = str(cfg.get("faster_whisper_model_size") or "small").strip() or "small"
    model_dir = str(cfg.get("faster_whisper_model_dir") or "runtime/models/faster-whisper").strip() or "runtime/models/faster-whisper"
    device = str(cfg.get("faster_whisper_device") or "cpu").strip().lower() or "cpu"
    compute_type = str(cfg.get("faster_whisper_compute_type") or "int8").strip().lower() or "int8"
    cpu_threads = max(1, int(cfg.get("faster_whisper_cpu_threads", 4)))
    num_workers = max(1, int(cfg.get("faster_whisper_num_workers", 1)))
    model_source = configured_model_path or model_size
    model_tag = f"{model_source}|{model_dir}|{device}|{compute_type}|{cpu_threads}|{num_workers}"

    with _FASTER_WHISPER_LOCK:
        if _FASTER_WHISPER_MODEL is not None and _FASTER_WHISPER_MODEL_TAG == model_tag:
            return _FASTER_WHISPER_MODEL

        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as exc:
            raise AudioUnavailableError(
                "faster-whisper is not installed. Run `pip install faster-whisper`."
            ) from exc

        download_root = Path(model_dir)
        download_root.mkdir(parents=True, exist_ok=True)
        model_name_or_path = configured_model_path or model_size
        try:
            model = WhisperModel(
                model_name_or_path,
                device=device,
                compute_type=compute_type,
                cpu_threads=cpu_threads,
                num_workers=num_workers,
                download_root=str(download_root),
            )
        except Exception as exc:
            raise AudioUnavailableError(
                f"Failed to load faster-whisper model '{model_name_or_path}': {_trim(exc, 260)}"
            ) from exc

        _FASTER_WHISPER_MODEL = model
        _FASTER_WHISPER_MODEL_TAG = model_tag
        return _FASTER_WHISPER_MODEL


def _transcribe_faster_whisper(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    model = _ensure_faster_whisper_model(cfg)
    beam_size = max(1, int(cfg.get("faster_whisper_beam_size", 1)))
    vad_filter = bool(cfg.get("faster_whisper_vad_filter", True))
    language_hint = _whisper_language_for_locale(locale_hint)

    fd, temp_path = tempfile.mkstemp(
        prefix="agrik-stt-",
        suffix=_audio_suffix_for_mime(validated.mime_type, validated.filename),
    )
    os.close(fd)
    path = Path(temp_path)
    try:
        path.write_bytes(validated.content)
        try:
            segments, info = model.transcribe(
                str(path),
                language=language_hint,
                beam_size=beam_size,
                vad_filter=vad_filter,
            )
        except Exception as exc:
            raise AudioUnavailableError(f"faster-whisper transcription failed: {_trim(exc, 260)}") from exc

        parts = [str(segment.text or "").strip() for segment in segments if str(segment.text or "").strip()]
        transcript = " ".join(parts).strip()
        if not transcript:
            raise AudioUnavailableError("faster-whisper returned no transcript.")

        detected_language = getattr(info, "language", None) or detect_language(transcript, normalize_locale_hint(locale_hint))[0]
        probability = getattr(info, "language_probability", None)
        try:
            confidence = round(float(probability), 3) if probability is not None else 0.78
        except (TypeError, ValueError):
            confidence = 0.78
        return {
            "transcript": transcript,
            "language": str(detected_language or "en"),
            "confidence": confidence,
            "model": (
                f"faster-whisper:{str(cfg.get('faster_whisper_model_path') or '').strip() or str(cfg.get('faster_whisper_model_size') or 'small').strip() or 'small'}"
            ),
        }
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to clean up faster-whisper temp file: %s", path)


async def _transcribe_local_faster_whisper_async(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    return await asyncio.to_thread(
        _transcribe_faster_whisper,
        validated=validated,
        locale_hint=locale_hint,
        cfg=cfg,
    )


async def _transcribe_huggingface_audio(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    token, timeout, verify_ssl = _ensure_audio_provider_ready(
        cfg,
        "hf_stt_model",
        "stt",
        check_model_unavailable=False,
    )
    models = _stt_candidate_models(cfg)
    if not models:
        raise AudioUnavailableError("HF_STT_MODEL is missing. Audio fallback is disabled.")

    normalized_locale = normalize_locale_hint(locale_hint)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": validated.mime_type,
        "Accept": "application/json",
    }
    attempts_per_endpoint = 2
    last_error = ""

    async with httpx.AsyncClient(timeout=timeout, verify=verify_ssl) as client:
        for model in models:
            if _is_model_temporarily_unavailable(model):
                continue
            endpoints = _build_audio_model_endpoints(cfg, model)
            if not endpoints:
                continue
            only_missing_path = True

            for endpoint in endpoints:
                for attempt in range(1, attempts_per_endpoint + 1):
                    try:
                        response = await client.post(endpoint, headers=headers, content=validated.content)
                    except httpx.HTTPError as exc:
                        only_missing_path = False
                        last_error = _format_audio_request_error(mode="stt", endpoint=endpoint, exc=exc)
                        if attempt < attempts_per_endpoint:
                            await asyncio.sleep(1.1 * attempt)
                        continue

                    payload: Any = None
                    try:
                        payload = response.json()
                    except ValueError:
                        payload = None

                    if response.status_code >= 400:
                        detail = _parse_error_detail(payload, response.text)
                        can_retry = response.status_code in {429, 503} and attempt < attempts_per_endpoint
                        if can_retry:
                            only_missing_path = False
                            wait_for = _extract_estimated_wait(payload, default_wait=1.2 * attempt)
                            logger.warning(
                                "Audio STT retry status=%s model=%s endpoint=%s file=%s wait=%.1fs detail=%s",
                                response.status_code,
                                model,
                                endpoint,
                                validated.filename,
                                wait_for,
                                detail,
                            )
                            await asyncio.sleep(wait_for)
                            continue
                        if response.status_code in {404, 410}:
                            last_error = (
                                f"Hugging Face STT model path unavailable on endpoint '{endpoint}': {detail}"
                            )
                            break
                        only_missing_path = False
                        last_error = (
                            f"Hugging Face STT model error ({response.status_code}) for {validated.filename}: {detail}"
                        )
                        if attempt < attempts_per_endpoint:
                            await asyncio.sleep(0.8 * attempt)
                        continue

                    only_missing_path = False
                    transcript = _extract_transcript(payload)
                    if not transcript and isinstance(payload, dict) and payload.get("error"):
                        detail = _parse_error_detail(payload, "")
                        if attempt < attempts_per_endpoint:
                            wait_for = _extract_estimated_wait(payload, default_wait=1.2 * attempt)
                            logger.warning(
                                "Audio STT warmup retry model=%s endpoint=%s file=%s wait=%.1fs detail=%s",
                                model,
                                endpoint,
                                validated.filename,
                                wait_for,
                                detail,
                            )
                            await asyncio.sleep(wait_for)
                            continue
                        last_error = f"Hugging Face STT model error for {validated.filename}: {detail}"
                        continue

                    if not transcript:
                        transcript = _trim(response.text, 400) if response.text else ""
                    transcript = transcript.strip()

                    if transcript:
                        language, confidence = detect_language(transcript, normalized_locale)
                        return {
                            "transcript": transcript,
                            "language": language,
                            "confidence": round(float(confidence), 3),
                            "model": model,
                        }

                    last_error = "Speech-to-text model returned no transcript."

                continue

            if only_missing_path:
                _mark_model_unavailable(model)

    raise AudioUnavailableError(last_error or "Speech-to-text request failed. Try again.")


async def _transcribe_validated_audio(
    *,
    validated: ValidatedAudio,
    locale_hint: str | None,
    cfg: Dict[str, Any],
) -> Dict[str, Any]:
    async def _transcribe_with_backend(backend_name: str) -> Dict[str, Any]:
        normalized = _normalize_stt_backend_name(backend_name)
        if normalized == "huggingface":
            return await _transcribe_huggingface_audio(
                validated=validated,
                locale_hint=locale_hint,
                cfg=cfg,
            )
        if normalized == "faster-whisper":
            return await _transcribe_local_faster_whisper_async(
                validated=validated,
                locale_hint=locale_hint,
                cfg=cfg,
            )
        if normalized == "openai-whisper":
            return await _transcribe_local_openai_whisper_async(
                validated=validated,
                locale_hint=locale_hint,
                cfg=cfg,
            )
        raise AudioUnavailableError(f"Unsupported STT backend: {backend_name or 'unknown'}.")

    primary_backend = _normalize_stt_backend_name(cfg.get("stt_backend"))
    fallback_backend = _normalize_stt_backend_name(cfg.get("stt_fallback_backend"))
    errors: list[str] = []

    backends = [backend for backend in [primary_backend, fallback_backend] if backend]
    seen: set[str] = set()
    ordered_backends: list[str] = []
    for backend in backends:
        if backend in seen:
            continue
        seen.add(backend)
        ordered_backends.append(backend)

    for backend in ordered_backends:
        try:
            result = await _transcribe_with_backend(backend)
            logger.info(
                "STT succeeded backend=%s file=%s model=%s",
                backend,
                validated.filename,
                result.get("model", backend),
            )
            return result
        except AudioUnavailableError as exc:
            detail = str(exc)
            errors.append(f"{backend}: {detail}")
            logger.warning("STT backend failed backend=%s file=%s error=%s", backend, validated.filename, detail)

    raise AudioUnavailableError("; ".join(errors) or "Speech-to-text request failed. Try again.")


async def transcribe_audio_upload(upload: UploadFile, locale_hint: str | None = None) -> Dict[str, Any]:
    cfg = get_ai_provider_config()
    validated = await _validate_audio_upload(upload, cfg)
    return await _transcribe_validated_audio(validated=validated, locale_hint=locale_hint, cfg=cfg)


async def transcribe_audio_bytes(
    *,
    content: bytes,
    mime_type: str,
    filename: str = "realtime-audio",
    locale_hint: str | None = None,
) -> Dict[str, Any]:
    cfg = get_ai_provider_config()
    validated = _validate_audio_bytes(
        content=content,
        filename=filename,
        incoming_mime=mime_type,
        cfg=cfg,
    )
    return await _transcribe_validated_audio(validated=validated, locale_hint=locale_hint, cfg=cfg)


async def synthesize_speech(
    text: str,
    locale_hint: str | None = None,
    voice_hint: str | None = None,
    speech_mode: str | None = None,
) -> AudioSynthesisResult:
    cfg = get_ai_provider_config()
    backend = str(cfg.get("tts_backend") or "edge-tts").strip().lower()
    cleaned = str(text or "").strip()
    if not cleaned:
        raise AudioValidationError("Text is required for speech synthesis.")
    normalized_speech_mode = str(speech_mode or "full").strip().lower()
    source_text = summarize_text_for_voice(cleaned) if normalized_speech_mode == "summary" else cleaned

    if backend in {"elevenlabs", "eleven-labs", "eleven_labs"}:
        max_chars = max(80, int(cfg.get("elevenlabs_tts_max_chars", 2000)))
    elif backend == "piper":
        max_chars = max(80, int(cfg.get("piper_tts_max_chars", 800)))
    else:
        max_chars = max(80, int(cfg.get("hf_tts_max_chars", 800)))
    speech_text = _speech_friendly_text(source_text)
    if not speech_text:
        raise AudioValidationError("Text is required for speech synthesis.")
    prepared_text = _truncate_tts_text(speech_text, max_chars)

    if backend in {"edge", "edge-tts", "edge_tts"}:
        return await _synthesize_edge_tts(
            text=prepared_text,
            locale_hint=locale_hint,
            voice_hint=voice_hint,
            cfg=cfg,
        )
    if backend in {"elevenlabs", "eleven-labs", "eleven_labs"}:
        return await _synthesize_elevenlabs(
            text=prepared_text,
            locale_hint=locale_hint,
            voice_hint=voice_hint,
            cfg=cfg,
        )
    if backend == "piper":
        return await _synthesize_piper_tts(
            text=prepared_text,
            locale_hint=locale_hint,
            voice_hint=voice_hint,
            cfg=cfg,
        )
    if backend in {"coqui", "afro-tts", "afro_tts", "local"}:
        return await _synthesize_local_coqui_async(
            text=prepared_text,
            locale_hint=locale_hint,
            voice_hint=voice_hint,
            cfg=cfg,
        )

    token, timeout, verify_ssl = _ensure_audio_provider_ready(cfg, "hf_tts_model", "tts")
    model = str(cfg.get("hf_tts_model") or "").strip()
    endpoints = _build_audio_model_endpoints(cfg, model)
    if not endpoints:
        raise AudioUnavailableError("No Hugging Face audio inference endpoint is configured.")

    normalized_locale = normalize_locale_hint(locale_hint)
    configured_voice = str(cfg.get("hf_tts_voice_preset") or "").strip()
    selected_voice = _resolve_hf_tts_voice_preset(
        locale_hint=locale_hint,
        voice_hint=voice_hint,
        cfg=cfg,
        configured_voice=configured_voice,
    )

    payload_variants: list[Dict[str, Any]] = [{"inputs": prepared_text}]
    variant_with_params: Dict[str, Any] | None = None
    params: Dict[str, Any] = {}
    if normalized_locale:
        params["language"] = normalized_locale
    if selected_voice:
        params["speaker"] = selected_voice
    if params:
        variant_with_params = {"inputs": prepared_text, "parameters": params}
        payload_variants.insert(0, variant_with_params)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "audio/*,application/json",
    }

    had_404 = False
    last_error = ""
    async with httpx.AsyncClient(timeout=timeout, verify=verify_ssl) as client:
        for endpoint in endpoints:
            for payload in payload_variants:
                attempts = 2
                for attempt in range(1, attempts + 1):
                    try:
                        response = await client.post(endpoint, headers=headers, json=payload)
                    except httpx.HTTPError as exc:
                        last_error = _format_audio_request_error(mode="tts", endpoint=endpoint, exc=exc)
                        if attempt < attempts:
                            await asyncio.sleep(1.1 * attempt)
                        continue

                    body: Any = None
                    try:
                        body = response.json()
                    except ValueError:
                        body = None

                    if response.status_code >= 400:
                        detail = _parse_error_detail(body, response.text)
                        can_retry = response.status_code in {429, 503} and attempt < attempts
                        if can_retry:
                            wait_for = _extract_estimated_wait(body, default_wait=1.2 * attempt)
                            logger.warning(
                                "Audio TTS retry status=%s model=%s endpoint=%s wait=%.1fs detail=%s",
                                response.status_code,
                                model,
                                endpoint,
                                wait_for,
                                detail,
                            )
                            await asyncio.sleep(wait_for)
                            continue
                        if response.status_code in {404, 410}:
                            had_404 = True
                            last_error = (
                                f"Hugging Face TTS model path was not found on endpoint '{endpoint}': {detail}"
                            )
                            break
                        # If parameterized payload fails with validation, retry without parameters.
                        if payload is variant_with_params and response.status_code in {400, 422}:
                            logger.info("Audio TTS retrying without optional parameters model=%s detail=%s", model, detail)
                            break
                        last_error = f"Hugging Face TTS model error ({response.status_code}): {detail}"
                        if attempt < attempts:
                            await asyncio.sleep(0.8 * attempt)
                        continue

                    content_type = str(response.headers.get("content-type") or "").lower()
                    audio_bytes = b""

                    if "application/json" in content_type:
                        if isinstance(body, dict) and body.get("error"):
                            detail = _parse_error_detail(body, "")
                            if attempt < attempts:
                                wait_for = _extract_estimated_wait(body, default_wait=1.2 * attempt)
                                logger.warning(
                                    "Audio TTS warmup retry model=%s endpoint=%s wait=%.1fs detail=%s",
                                    model,
                                    endpoint,
                                    wait_for,
                                    detail,
                                )
                                await asyncio.sleep(wait_for)
                                continue
                            last_error = f"Hugging Face TTS model error: {detail}"
                            continue
                        audio_bytes = _extract_audio_bytes(body)
                    else:
                        audio_bytes = bytes(response.content or b"")

                    if audio_bytes:
                        mime_type = _normalize_output_mime(content_type, audio_bytes)
                        return AudioSynthesisResult(
                            audio_bytes=audio_bytes,
                            mime_type=mime_type,
                            model=model,
                        )

                    last_error = "TTS model returned no playable audio output."
                    if attempt < attempts:
                        await asyncio.sleep(0.8 * attempt)
                        continue

                # Continue trying next payload variant (or endpoint).
                continue

    if had_404:
        _mark_model_unavailable(model)
    raise AudioUnavailableError(last_error or "Text-to-speech request failed. Try shorter text.")
