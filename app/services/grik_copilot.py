import json
import logging
import re
import time
import uuid
from collections import Counter, defaultdict, deque
from threading import Lock
from typing import Any, Dict, List

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_ai_provider_config, get_min_confidence_threshold
from app.db.models import AuthUser, ChatMessage, Interaction, MarketPrice
from app.services.ai_brain import AdviceResult
from app.services.citations import format_citations_short
from app.services.external_sources import fetch_external_knowledge
from app.services.language import detect_language, normalize_locale_hint
from app.services.market_intel import predict_price_trends
from app.services.retrieval import retrieve_grounded_advice
from app.services.user_profile import get_or_create_farmer, get_or_create_farmer_profile
from app.services.user_settings import get_or_create_settings
from app.services.weather import geocode_location, get_daily_forecast, summarize_daily_forecast

logger = logging.getLogger("agrik.grik_copilot")

_PROVIDER_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_PROVIDER_RATE_LOCK = Lock()


class AIUnavailableError(RuntimeError):
    pass


LANGUAGE_NAME = {
    "en": "English",
    "sw": "Swahili",
    "lg": "Luganda",
    "nyn": "Runyankole",
    "ach": "Acholi",
    "teo": "Ateso",
}

LANGUAGE_PILOT_NOTE = {
    "lg": "Luganda translation support is currently in pilot mode, so core guidance is kept in English for reliability.",
    "nyn": "Runyankole translation support is currently in pilot mode, so core guidance is kept in English for reliability.",
    "ach": "Acholi translation support is currently in pilot mode, so core guidance is kept in English for reliability.",
    "teo": "Ateso translation support is currently in pilot mode, so core guidance is kept in English for reliability.",
}


def _trim(value: Any, limit: int = 320) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 3)].rstrip()}..."


def _dict_to_text(value: Any, limit: int = 240) -> str:
    if value in (None, "", [], {}):
        return ""
    try:
        return _trim(json.dumps(value, ensure_ascii=True), limit=limit)
    except (TypeError, ValueError):
        return _trim(value, limit=limit)


def _normalize_markdown(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"[ \t]+\n", "\n", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _extract_completion_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first, dict) else {}
    content = message.get("content") if isinstance(message, dict) else ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            chunk = item.get("text") or item.get("content")
            if isinstance(chunk, str):
                parts.append(chunk)
        return "\n".join([p.strip() for p in parts if p and p.strip()]).strip()
    return ""


def _retry_after_seconds(value: str | None, default_wait: float) -> float:
    try:
        wait = float(str(value or "").strip())
    except ValueError:
        wait = default_wait
    return min(8.0, max(0.5, wait))


def _advisory_provider(cfg: Dict[str, Any]) -> str:
    return str(cfg.get("advisory_provider") or cfg.get("provider") or "none").strip().lower()


def _wait_for_provider_slot(provider_key: str, requests_per_minute: int) -> None:
    if requests_per_minute <= 0:
        return
    while True:
        now = time.monotonic()
        with _PROVIDER_RATE_LOCK:
            bucket = _PROVIDER_RATE_BUCKETS[provider_key]
            while bucket and (now - bucket[0]) >= 60.0:
                bucket.popleft()
            if len(bucket) < requests_per_minute:
                bucket.append(now)
                return
            wait_for = max(0.25, 60.0 - (now - bucket[0]))
        logger.info("AI rate limiter waiting provider=%s wait=%.2fs rpm=%s", provider_key, wait_for, requests_per_minute)
        time.sleep(min(wait_for, 5.0))


def _gemini_candidate_models(cfg: Dict[str, Any]) -> List[str]:
    candidates = [
        str(cfg.get("gemini_model") or "").strip(),
        str(cfg.get("gemini_fallback_model") or "").strip(),
        *[str(item).strip() for item in (cfg.get("gemini_alt_models") or []) if str(item).strip()],
    ]
    ordered: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(candidate)
    return ordered


def _extract_gemini_text(payload: Dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first = candidates[0] if isinstance(candidates[0], dict) else {}
    content = first.get("content") if isinstance(first, dict) else {}
    parts = content.get("parts") if isinstance(content, dict) else []
    if not isinstance(parts, list):
        return ""
    chunks: List[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())
    return "\n".join(chunks).strip()


def _call_hf_chat(
    models: List[str],
    messages: List[Dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> str:
    cfg = get_ai_provider_config()
    if cfg.get("provider") != "huggingface":
        return ""
    if not cfg.get("hf_token"):
        return ""

    base_url = str(cfg.get("hf_base_url") or "").rstrip("/")
    if not base_url:
        return ""
    endpoint = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.get('hf_token')}",
        "Content-Type": "application/json",
    }

    tried_models: List[str] = []
    for model in models:
        clean_model = (model or "").strip()
        if not clean_model:
            continue
        if clean_model in tried_models:
            continue
        tried_models.append(clean_model)

        payload = {
            "model": clean_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        attempts = 3
        with httpx.Client(timeout=cfg.get("hf_timeout", 30.0), verify=cfg.get("hf_verify_ssl", True)) as client:
            for attempt in range(1, attempts + 1):
                try:
                    response = client.post(endpoint, headers=headers, json=payload)
                except httpx.HTTPError as exc:
                    if attempt < attempts:
                        wait_for = _retry_after_seconds(None, default_wait=0.9 * attempt)
                        logger.warning(
                            "Hugging Face chat transport retry model=%s attempt=%s/%s wait=%.1fs error=%s",
                            clean_model,
                            attempt,
                            attempts,
                            wait_for,
                            exc,
                        )
                        time.sleep(wait_for)
                        continue
                    logger.warning("Hugging Face chat failed model=%s error=%s", clean_model, exc)
                    break

                if response.status_code in {429, 503} and attempt < attempts:
                    wait_for = _retry_after_seconds(response.headers.get("retry-after"), default_wait=1.2 * attempt)
                    logger.warning(
                        "Hugging Face chat retry status=%s model=%s attempt=%s/%s wait=%.1fs",
                        response.status_code,
                        clean_model,
                        attempt,
                        attempts,
                        wait_for,
                    )
                    time.sleep(wait_for)
                    continue

                try:
                    response.raise_for_status()
                    data = response.json()
                except (httpx.HTTPError, ValueError) as exc:
                    logger.warning("Hugging Face chat failed model=%s error=%s", clean_model, exc)
                    break

                data_dict = data if isinstance(data, dict) else {}
                text = _extract_completion_text(data_dict)
                if text:
                    return text
                choices = data_dict.get("choices")
                first_choice = choices[0] if isinstance(choices, list) and choices else {}
                message_obj = first_choice.get("message") if isinstance(first_choice, dict) else {}
                reasoning = message_obj.get("reasoning") if isinstance(message_obj, dict) else ""
                finish_reason = first_choice.get("finish_reason") if isinstance(first_choice, dict) else ""
                if finish_reason == "length" and reasoning:
                    logger.info(
                        "HF response ended before final answer model=%s max_tokens=%s",
                        clean_model,
                        max_tokens,
                    )
                break
    return ""


def _call_huggingface(messages: List[Dict[str, str]]) -> str:
    cfg = get_ai_provider_config()
    models = _chat_candidate_models(cfg)
    return _call_hf_chat(
        models=models,
        messages=messages,
        max_tokens=int(cfg.get("hf_max_tokens", 900)),
        temperature=float(cfg.get("hf_temperature", 0.2)),
    )


def _chat_candidate_models(cfg: Dict[str, Any]) -> List[str]:
    candidates = [
        str(cfg.get("hf_model") or "").strip(),
        str(cfg.get("hf_fallback_model") or "").strip(),
        *[str(item).strip() for item in (cfg.get("hf_alt_models") or []) if str(item).strip()],
    ]
    ordered: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(candidate)
    return ordered


def _call_gemini_chat(
    models: List[str],
    messages: List[Dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> str:
    cfg = get_ai_provider_config()
    if not cfg.get("gemini_api_key"):
        return ""

    base_url = str(cfg.get("gemini_base_url") or "").rstrip("/")
    if not base_url:
        return ""

    system_parts = [{"text": str(message.get("content") or "").strip()} for message in messages if message.get("role") == "system" and str(message.get("content") or "").strip()]
    contents: List[Dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "").strip().lower()
        if role == "system":
            continue
        content = str(message.get("content") or "").strip()
        if not content:
            continue
        contents.append(
            {
                "role": "model" if role == "assistant" else "user",
                "parts": [{"text": content}],
            }
        )

    if not contents:
        return ""

    headers = {
        "Content-Type": "application/json",
        "X-goog-api-key": str(cfg.get("gemini_api_key")),
    }
    client_timeout = float(cfg.get("gemini_timeout", 30.0))
    requests_per_minute = int(cfg.get("gemini_requests_per_minute", 12))
    tried_models: List[str] = []
    for model in models:
        clean_model = (model or "").strip()
        if not clean_model or clean_model in tried_models:
            continue
        tried_models.append(clean_model)
        endpoint = f"{base_url}/models/{clean_model}:generateContent"
        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_parts:
            payload["systemInstruction"] = {"parts": system_parts}

        attempts = 3
        with httpx.Client(timeout=client_timeout) as client:
            for attempt in range(1, attempts + 1):
                _wait_for_provider_slot(f"gemini:{clean_model}", requests_per_minute)
                try:
                    response = client.post(endpoint, headers=headers, json=payload)
                except httpx.HTTPError as exc:
                    if attempt < attempts:
                        wait_for = _retry_after_seconds(None, default_wait=0.9 * attempt)
                        logger.warning(
                            "Gemini chat transport retry model=%s attempt=%s/%s wait=%.1fs error=%s",
                            clean_model,
                            attempt,
                            attempts,
                            wait_for,
                            exc,
                        )
                        time.sleep(wait_for)
                        continue
                    logger.warning("Gemini chat failed model=%s error=%s", clean_model, exc)
                    break

                if response.status_code in {429, 503} and attempt < attempts:
                    wait_for = _retry_after_seconds(response.headers.get("retry-after"), default_wait=1.2 * attempt)
                    logger.warning(
                        "Gemini chat retry status=%s model=%s attempt=%s/%s wait=%.1fs",
                        response.status_code,
                        clean_model,
                        attempt,
                        attempts,
                        wait_for,
                    )
                    time.sleep(wait_for)
                    continue

                try:
                    response.raise_for_status()
                    data = response.json()
                except (httpx.HTTPError, ValueError) as exc:
                    logger.warning("Gemini chat failed model=%s error=%s", clean_model, exc)
                    break

                data_dict = data if isinstance(data, dict) else {}
                text = _extract_gemini_text(data_dict)
                if text:
                    return text
                break
    return ""


def _call_advisory_chat(
    messages: List[Dict[str, str]],
    purpose: str,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    models: List[str] | None = None,
) -> str:
    cfg = get_ai_provider_config()
    provider = _advisory_provider(cfg)
    if provider == "gemini":
        return _call_gemini_chat(
            models=models or _gemini_candidate_models(cfg),
            messages=messages,
            max_tokens=max_tokens or int(cfg.get("gemini_max_output_tokens", 900)),
            temperature=temperature if temperature is not None else float(cfg.get("gemini_temperature", 0.2)),
        )
    if provider == "huggingface":
        return _call_hf_chat(
            models=models or _chat_candidate_models(cfg),
            messages=messages,
            max_tokens=max_tokens or int(cfg.get("hf_max_tokens", 900)),
            temperature=temperature if temperature is not None else float(cfg.get("hf_temperature", 0.2)),
        )
    raise AIUnavailableError(
        f"GRIK advisory provider '{provider or 'none'}' is not supported. Configure GRIK_CHAT_PROVIDER=gemini or huggingface."
    )


def _require_advisory_generation(messages: List[Dict[str, str]], purpose: str) -> str:
    cfg = get_ai_provider_config()
    provider = _advisory_provider(cfg)
    if provider == "gemini":
        if not cfg.get("gemini_api_key"):
            raise AIUnavailableError("GEMINI_API_KEY is missing for GRIK advisory generation.")
        if not _gemini_candidate_models(cfg):
            raise AIUnavailableError("GEMINI_MODEL is missing and no Gemini fallback advisory model is configured.")
        generated = _call_advisory_chat(messages, purpose)
        if not generated.strip():
            raise AIUnavailableError(f"Gemini did not return a usable response for {purpose} across configured models.")
        return generated
    if provider == "huggingface":
        if not cfg.get("hf_token"):
            raise AIUnavailableError("HUGGINGFACE_API_TOKEN is missing. GRIK fallback replies are disabled.")
        if not _chat_candidate_models(cfg):
            raise AIUnavailableError("HF_MODEL is missing and no fallback advisory model is configured.")
        generated = _call_advisory_chat(messages, purpose)
        if not generated.strip():
            raise AIUnavailableError(f"Hugging Face did not return a usable response for {purpose} across configured models.")
        return generated
    raise AIUnavailableError(
        f"GRIK advisory provider '{provider or 'none'}' is not configured. Set GRIK_CHAT_PROVIDER=gemini for dashboard brain requests."
    )


def _translation_quality_ok(text: str) -> bool:
    lowered = text.lower()
    if not text.strip():
        return False
    if "<think>" in lowered:
        return False
    required_sections = [
        "### quick diagnosis",
        "### immediate actions (today)",
        "### 7-day plan",
        "### monitoring checklist",
    ]
    if any(section not in lowered for section in required_sections):
        return False
    if not re.search(r"^\|\s*-{2,}\s*\|\s*-{2,}\s*\|\s*-{2,}\s*\|", text, flags=re.MULTILINE):
        return False

    tokens = re.findall(r"[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF']+", lowered)
    if len(tokens) < 35:
        return False
    counts = Counter(tokens)
    most_common_ratio = counts.most_common(1)[0][1] / max(1, len(tokens))
    if most_common_ratio > 0.18:
        return False
    return True


def _translate_markdown(text: str, language: str) -> tuple[str, bool]:
    cfg = get_ai_provider_config()
    if cfg.get("provider") != "huggingface":
        return text, False
    if not cfg.get("hf_translation_enabled", True):
        return text, False

    targets = cfg.get("hf_translation_targets") or []
    if language not in targets:
        return text, False
    target_name = LANGUAGE_NAME.get(language)
    if not target_name:
        return text, False

    translation_model = str(cfg.get("hf_translation_model") or "").strip()
    if not translation_model:
        return text, False

    messages = [
        {
            "role": "system",
            "content": (
                "You are an agricultural translation assistant. "
                "Translate accurately and keep markdown structure exactly."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Translate the following advisory from English to {target_name}.\n"
                "Rules:\n"
                "- Keep markdown headings, bullet list structure, and table pipe delimiters unchanged.\n"
                "- Keep crop and disease names in English when no reliable local term is known.\n"
                "- Do not add new facts.\n\n"
                f"{text}"
            ),
        },
    ]
    translated = _call_hf_chat(
        models=[translation_model],
        messages=messages,
        max_tokens=int(cfg.get("hf_translation_max_tokens", 900)),
        temperature=0.1,
    )
    translated = _normalize_markdown(translated)
    if _normalize_markdown(text).lower() == translated.lower():
        return text, False
    if not _translation_quality_ok(translated):
        return text, False
    return translated, True


def _translate_follow_ups(follow_ups: List[str], language: str) -> List[str]:
    if not follow_ups:
        return follow_ups
    cfg = get_ai_provider_config()
    if cfg.get("provider") != "huggingface":
        return follow_ups
    if not cfg.get("hf_translation_enabled", True):
        return follow_ups
    targets = cfg.get("hf_translation_targets") or []
    if language not in targets:
        return follow_ups
    target_name = LANGUAGE_NAME.get(language)
    if not target_name:
        return follow_ups
    translation_model = str(cfg.get("hf_translation_model") or "").strip()
    if not translation_model:
        return follow_ups

    numbered = "\n".join([f"{idx + 1}. {item}" for idx, item in enumerate(follow_ups)])
    messages = [
        {"role": "system", "content": "Translate user-facing suggestion prompts accurately."},
        {
            "role": "user",
            "content": (
                f"Translate these questions from English to {target_name}.\n"
                "Return exactly three numbered prompts and keep each as a short user request.\n\n"
                f"{numbered}"
            ),
        },
    ]
    translated = _call_hf_chat(
        models=[translation_model],
        messages=messages,
        max_tokens=220,
        temperature=0.1,
    )
    if not translated:
        return follow_ups

    parsed: List[str] = []
    for raw in translated.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^\d+\.\s*", "", line).strip()
        if not line:
            continue
        line = line.rstrip(".")
        parsed.append(line)
        if len(parsed) >= 3:
            break
    return parsed if len(parsed) >= 2 else follow_ups


def _collect_citations(grounded_items: List[Dict[str, Any]]) -> tuple[List[str], List[Dict[str, str]], List[str]]:
    sources: List[str] = []
    citations: List[Dict[str, str]] = []
    references: List[str] = []
    seen_source_labels: set[str] = set()
    seen_citation_keys: set[tuple[str, str, str, str, str]] = set()

    for idx, item in enumerate(grounded_items, start=1):
        title = _trim(item.get("title") or item.get("crop") or item.get("source_type") or "Uganda manuals", 80)
        source_id = _trim(item.get("source_id") or item.get("source_type") or "manuals", 72)
        page = _trim(item.get("page") or "", 24)
        file_name = _trim(item.get("file") or "", 96)
        url = _trim(item.get("url") or "", 240)
        excerpt = _trim(item.get("text", ""), 240)

        source_label = title or source_id
        if source_label and source_label not in seen_source_labels:
            seen_source_labels.add(source_label)
            sources.append(source_label)

        citation_key = (source_id, title, page, file_name, url)
        if citation_key not in seen_citation_keys:
            seen_citation_keys.add(citation_key)
            citations.append(
                {
                    "source_id": source_id,
                    "title": title,
                    "page": page,
                    "file": file_name,
                    "url": url,
                }
            )

        references.append(f"[R{idx}] {title}: {excerpt}")

    return sources, citations, references


def _load_weather_signal(location_text: str | None) -> Dict[str, Any] | None:
    if not location_text:
        return None
    geo = geocode_location(location_text)
    if not geo:
        return None
    lat = geo.get("latitude")
    lon = geo.get("longitude")
    if lat is None or lon is None:
        return None

    forecast = get_daily_forecast(lat, lon, days=5)
    if not forecast:
        return None
    summary = summarize_daily_forecast(forecast)
    days = summary.get("days") if isinstance(summary, dict) else []
    days = days if isinstance(days, list) else []

    location_name = ", ".join([part for part in (geo.get("name"), geo.get("admin1"), geo.get("country")) if isinstance(part, str) and part.strip()])
    return {
        "location_name": location_name or location_text,
        "next_rain_date": summary.get("next_rain_date"),
        "days": days[:3],
    }


def _format_weather_line(weather_signal: Dict[str, Any] | None) -> str:
    if not weather_signal:
        return ""
    location_name = weather_signal.get("location_name") or "the farm area"
    next_rain = weather_signal.get("next_rain_date")
    days = weather_signal.get("days") or []
    if next_rain:
        return f"{location_name}: next meaningful rain expected on {next_rain}."
    if days:
        first = days[0]
        rain = first.get("precipitation_mm")
        max_temp = first.get("temp_max_c")
        min_temp = first.get("temp_min_c")
        return f"{location_name}: today rain {rain}mm, temperatures {min_temp}-{max_temp}C."
    return ""


def _load_market_signal(db: Session, district: str | None, crops: List[str]) -> Dict[str, Any] | None:
    predictions = predict_price_trends(db, district=district, limit=8)
    crop_set = {crop.strip().lower() for crop in crops if crop and crop.strip()}
    if crop_set:
        crop_predictions = [pred for pred in predictions if pred.crop.lower() in crop_set]
        if crop_predictions:
            predictions = crop_predictions
    top_predictions = predictions[:3]

    rows = db.query(MarketPrice).order_by(MarketPrice.captured_at.desc()).limit(60).all()
    filtered_prices: List[MarketPrice] = []
    seen_crops: set[str] = set()
    for row in rows:
        if district and row.district and row.district.lower() != district.lower():
            continue
        crop_name = (row.crop or "").strip().lower()
        if crop_set and crop_name and crop_name not in crop_set:
            continue
        if crop_name in seen_crops:
            continue
        seen_crops.add(crop_name)
        filtered_prices.append(row)
        if len(filtered_prices) >= 3:
            break

    if not top_predictions and not filtered_prices:
        return None
    return {
        "predictions": [
            {
                "crop": pred.crop,
                "district": pred.district,
                "predicted_price": pred.predicted_price,
                "currency": pred.currency,
                "direction": pred.direction,
                "confidence": pred.confidence,
                "horizon_days": pred.horizon_days,
            }
            for pred in top_predictions
        ],
        "latest_prices": [
            {
                "crop": row.crop,
                "district": row.district,
                "market": row.market,
                "price": row.price,
                "currency": row.currency,
                "captured_at": row.captured_at.isoformat() if row.captured_at else None,
            }
            for row in filtered_prices
        ],
    }


def _format_market_line(market_signal: Dict[str, Any] | None) -> str:
    if not market_signal:
        return ""
    predictions = market_signal.get("predictions") or []
    if predictions:
        top = predictions[0]
        return (
            f"Price signal: {top.get('crop')} trend is {top.get('direction')} over next "
            f"{top.get('horizon_days')} days ({top.get('currency')}{top.get('predicted_price')})."
        )
    latest = market_signal.get("latest_prices") or []
    if latest:
        top = latest[0]
        return f"Latest market record: {top.get('crop')} at {top.get('currency')}{top.get('price')}."
    return ""


def _recent_chat_memory(db: Session, user_id: str) -> List[Dict[str, str]]:
    rows = db.query(ChatMessage).filter(ChatMessage.user_id == user_id).order_by(ChatMessage.created_at.desc()).limit(6).all()
    return [
        {
            "role": row.role,
            "message": _trim(row.message, 220),
            "created_at": row.created_at.isoformat() if row.created_at else "",
        }
        for row in reversed(rows)
    ]


def _recent_interaction_memory(db: Session, farmer_id: str) -> List[Dict[str, str]]:
    try:
        rows = (
            db.query(Interaction.message, Interaction.response, Interaction.created_at)
            .filter(Interaction.farmer_id == farmer_id)
            .order_by(Interaction.created_at.desc())
            .limit(4)
            .all()
        )
    except SQLAlchemyError as exc:
        logger.warning("Interaction memory unavailable: %s", exc)
        return []
    return [
        {
            "message": _trim(message, 180),
            "response": _trim(response, 200),
            "created_at": created_at.isoformat() if created_at else "",
        }
        for message, response, created_at in reversed(rows)
    ]


def _guess_crop(
    question: str,
    profile_crops: List[str],
    grounded_items: List[Dict[str, Any]],
    recent_chats: List[Dict[str, str]] | None = None,
) -> str:
    lowered = question.lower()
    for crop in profile_crops:
        if crop and crop.lower() in lowered:
            return crop
    if recent_chats and profile_crops:
        for item in reversed(recent_chats):
            if (item.get("role") or "").lower() != "user":
                continue
            text = (item.get("message") or "").lower()
            if not text:
                continue
            for crop in profile_crops:
                if crop and crop.lower() in text:
                    return crop
    if profile_crops and any(token in lowered for token in ["my crop", "my field", "our crop", "our field"]):
        return profile_crops[0]
    if profile_crops:
        return profile_crops[0]
    for item in grounded_items:
        crop = str(item.get("crop", "")).strip()
        if crop:
            return crop
    return "your crop"


def _is_establishment_question(question: str) -> bool:
    lowered = question.lower()
    stage_terms = [
        "just completed planting",
        "just planted",
        "completed planting",
        "after planting",
        "newly planted",
        "post-planting",
        "post planting",
        "germination",
        "emergence",
    ]
    planning_terms = [
        "maximize",
        "maximise",
        "harvest",
        "yield",
        "weekly checklist",
        "protection checklist",
    ]
    return any(term in lowered for term in stage_terms) or (
        "plant" in lowered and any(term in lowered for term in planning_terms)
    )


def _is_pre_plant_question(question: str) -> bool:
    lowered = question.lower()
    preplant_terms = [
        "planning to plant",
        "plan to plant",
        "before planting",
        "pre-plant",
        "pre plant",
        "next month",
        "this season",
        "before i plant",
        "before attempting to plant",
    ]
    return any(term in lowered for term in preplant_terms)


def _is_general_non_agri_question(question: str) -> bool:
    lowered = str(question or "").strip().lower()
    if not lowered:
        return False

    agri_tokens = [
        "farm",
        "crop",
        "maize",
        "beans",
        "cassava",
        "banana",
        "coffee",
        "rice",
        "sorghum",
        "millet",
        "groundnut",
        "soil",
        "fertilizer",
        "pest",
        "disease",
        "spray",
        "plant",
        "harvest",
        "yield",
        "market",
        "weather",
        "rain",
        "livestock",
        "agronomy",
    ]
    if any(token in lowered for token in agri_tokens):
        return False

    conversational_tokens = [
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you",
        "thank you",
        "thanks",
        "what is",
        "who is",
        "where is",
        "when did",
        "why is",
        "can you explain",
        "tell me about",
        "summarize",
        "joke",
        "story",
    ]
    if any(token in lowered for token in conversational_tokens):
        return True
    return False


def _classify_query_intent(question: str) -> str:
    lowered = question.lower()
    if _is_general_non_agri_question(question):
        return "general_conversation"
    if _is_pre_plant_question(question):
        return "pre_plant_planning"
    if _is_establishment_question(question):
        return "establishment"
    if any(token in lowered for token in ["best crops", "what crops", "which crops", "what to plant", "plant this month", "plant this season"]):
        return "crop_selection"
    if any(token in lowered for token in ["monitoring plan", "7-day pest", "7 day pest", "scouting plan", "pest monitoring"]):
        return "pest_monitoring"
    if any(token in lowered for token in ["price", "market", "sell", "buyer", "harvest timing", "storage and sale"]):
        return "market_planning"
    if any(token in lowered for token in ["weather", "rain", "drought", "dry spell", "forecast"]):
        return "weather_planning"
    symptom_terms = [
        "yellow",
        "spot",
        "curl",
        "wilt",
        "holes",
        "frass",
        "weak",
        "disease",
        "pest",
        "leaves",
        "leaf",
        "streak",
        "rot",
        "stunted",
        "help",
        "immediate actions",
        "what should i do first today",
    ]
    if any(term in lowered for term in symptom_terms):
        return "symptom_diagnosis"
    return "general_agronomy"


def _normalize_follow_up_key(text: str) -> str:
    key = re.sub(r"\s+", " ", text or "").strip().lower()
    key = re.sub(r"[^\w\s]", "", key)
    return key


def _sanitize_follow_up_prompt(text: str) -> str:
    prompt = re.sub(r"\s+", " ", str(text or "")).strip()
    prompt = prompt.strip("\"' ")
    prompt = prompt.rstrip(".?")
    return prompt


def _is_incomplete_follow_up(text: str) -> bool:
    prompt = _sanitize_follow_up_prompt(text)
    if not prompt:
        return True

    words = re.findall(r"[A-Za-z0-9]+", prompt)
    if len(words) < 4:
        return True

    lowered = prompt.lower()
    if lowered.endswith(("...", "…", ":", ";", ",", "-", "/")):
        return True

    trailing_tokens = {
        "a",
        "an",
        "and",
        "around",
        "about",
        "for",
        "from",
        "if",
        "in",
        "into",
        "my",
        "of",
        "on",
        "or",
        "the",
        "to",
        "under",
        "using",
        "with",
    }
    if words and words[-1].lower() in trailing_tokens:
        return True

    return False


def _fallback_follow_up_prompts(
    *,
    crop: str,
    location_label: str | None,
    intent: str,
) -> List[str]:
    crop_label = crop if crop and crop.lower() != "mixed farm" else "my farm"
    location_suffix = f" in {location_label}" if location_label else ""

    templates_by_intent: Dict[str, List[str]] = {
        "symptom_diagnosis": [
            f"List likely causes affecting {crop_label}{location_suffix}",
            f"Build a 7-day treatment checklist for {crop_label}",
            f"Show signs that mean {crop_label} is improving",
        ],
        "pest_monitoring": [
            f"Build a weekly scouting routine for {crop_label}",
            f"List high-risk pests for {crop_label}{location_suffix}",
            f"Show threshold signs before I intervene on {crop_label}",
        ],
        "weather_planning": [
            f"Adjust this week's field work for {crop_label}{location_suffix}",
            f"Plan irrigation and drainage steps for {crop_label}",
            f"List weather risks to monitor on {crop_label}",
        ],
        "market_planning": [
            f"Build a harvest and selling plan for {crop_label}",
            f"Estimate value-adding options for {crop_label}",
            f"List price signals I should track this week",
        ],
        "crop_selection": [
            f"Compare the best crop options for {location_label or 'my area'}",
            "List input needs and costs for each crop option",
            "Rank the safest crops for this season",
        ],
        "pre_plant_planning": [
            f"Build a land preparation checklist for {crop_label}",
            f"List seed, spacing, and fertilizer needs for {crop_label}",
            f"Create a planting week plan for {crop_label}",
        ],
        "establishment": [
            f"Build a first 21-day care plan for {crop_label}",
            f"List early warning signs to monitor in {crop_label}",
            f"Show gap-filling and weed-control steps for {crop_label}",
        ],
        "general_agronomy": [
            f"Build a weekly management checklist for {crop_label}",
            f"List the biggest production risks for {crop_label}",
            f"Show low-cost practices to improve {crop_label} yield",
        ],
    }
    prompts = templates_by_intent.get(intent) or templates_by_intent["general_agronomy"]
    return [_sanitize_follow_up_prompt(item) for item in prompts if not _is_incomplete_follow_up(item)][:3]


def _parse_numbered_prompts(text: str) -> List[str]:
    prompts: List[str] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^\d+\.\s*", "", line).strip()
        line = re.sub(r"^[-*]\s*", "", line).strip()
        line = _sanitize_follow_up_prompt(line)
        if not line:
            continue
        prompts.append(line)
        if len(prompts) >= 3:
            break
    return prompts


def _generate_follow_up_prompts(
    question: str,
    reply_en: str,
    crop: str,
    location_label: str | None,
    intent: str,
    recent_chats: List[Dict[str, str]],
    extracted_prompts: List[str] | None = None,
) -> List[str]:
    candidates: List[str] = []
    if extracted_prompts:
        candidates.extend(extracted_prompts)

    cfg = get_ai_provider_config()
    provider = _advisory_provider(cfg)
    if provider in {"huggingface", "gemini"}:
        models = _gemini_candidate_models(cfg) if provider == "gemini" else _chat_candidate_models(cfg)
        messages = [
            {
                "role": "system",
                "content": (
                    "Generate short, tap-ready user requests for the next assistant turn. "
                    "Each line must be a complete, natural request a farmer can click and send as-is. "
                    "Never return fragments, dangling endings, or questions."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Intent: {intent}\n"
                    f"Crop focus: {crop or 'not clear'}\n"
                    f"Location: {location_label or 'not provided'}\n"
                    f"Original farmer message: {question}\n"
                    f"Current advisory summary:\n{_trim(reply_en, 900)}\n\n"
                    "Return exactly 3 numbered prompts the farmer can click/send next.\n"
                    "Rules:\n"
                    "- Keep each prompt between 6 and 14 words.\n"
                    "- Use user-request style (example: 'Build a 7-day scouting plan for my maize').\n"
                    "- Do not ask questions.\n"
                    "- Each prompt must stand alone and be fully complete.\n"
                    "- Do not end with words like 'to', 'for', 'with', 'about', or 'the'.\n"
                    "- Prefer action-oriented prompts that deepen diagnosis, monitoring, or decisions.\n"
                    "- Avoid repeating the same wording.\n"
                ),
            },
        ]
        generated = _call_advisory_chat(
            messages=messages,
            purpose="follow-up prompt generation",
            models=models,
            max_tokens=240,
            temperature=0.25,
        )
        candidates.extend(_parse_numbered_prompts(generated))

    recent_user_messages = [
        _normalize_follow_up_key(item.get("message", ""))
        for item in recent_chats
        if (item.get("role") or "").lower() == "user"
    ]
    recent_user_messages = [item for item in recent_user_messages if item]

    final_prompts: List[str] = []
    seen: set[str] = set()
    for raw in candidates:
        prompt = _sanitize_follow_up_prompt(raw)
        if not prompt:
            continue
        if _is_incomplete_follow_up(prompt):
            continue
        key = _normalize_follow_up_key(prompt)
        if not key or key in seen:
            continue
        if any(key == old or key in old or old in key for old in recent_user_messages):
            continue
        seen.add(key)
        final_prompts.append(prompt)
        if len(final_prompts) >= 3:
            break

    if len(final_prompts) < 3:
        for fallback in _fallback_follow_up_prompts(crop=crop, location_label=location_label, intent=intent):
            key = _normalize_follow_up_key(fallback)
            if not key or key in seen:
                continue
            if any(key == old or key in old or old in key for old in recent_user_messages):
                continue
            seen.add(key)
            final_prompts.append(fallback)
            if len(final_prompts) >= 3:
                break

    return final_prompts[:3]


def _extract_follow_ups(reply: str) -> List[str]:
    lines = reply.splitlines()
    collecting = False
    follow_ups: List[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            if collecting and follow_ups:
                break
            continue
        lower = line.lower()
        if "follow-up questions" in lower or "follow up questions" in lower or "suggested next prompts" in lower:
            collecting = True
            continue
        if collecting and line.startswith("###"):
            break
        if not collecting:
            continue
        cleaned = re.sub(r"^\d+\.\s*", "", line)
        cleaned = re.sub(r"^[-*]\s*", "", cleaned).strip()
        if not cleaned:
            continue
        cleaned = cleaned.rstrip(".")
        if cleaned not in follow_ups:
            follow_ups.append(cleaned)
        if len(follow_ups) >= 4:
            break
    return follow_ups[:3]


def _clean_model_reply(text: str) -> str:
    cleaned = _normalize_markdown(text)
    cleaned = re.sub(r"^\s*grik ai\s*:?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\s*[-=]{3,}\s*$", "", cleaned, flags=re.MULTILINE)

    # Remove malformed table artifacts like lone pipes or separators.
    lines: List[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped in {"|", "| --- |", "---", "- - -"}:
            continue
        lines.append(line)

    normalized_lines: List[str] = []
    previous_heading = ""
    for line in lines:
        lowered = line.strip().lower()
        if lowered.startswith("## "):
            candidate = "### " + line.strip()[3:].strip()
        else:
            candidate = line
        heading_key = candidate.strip().lower()
        if heading_key.startswith("### ") and heading_key == previous_heading:
            continue
        if heading_key.startswith("### "):
            previous_heading = heading_key
        normalized_lines.append(candidate)

    cleaned = "\n".join(normalized_lines)
    return cleaned.strip()


def _is_structured_reply(text: str) -> bool:
    if not text.strip():
        return False
    lowered = text.lower()
    if "<think>" in lowered:
        return False

    required_sections = [
        "### quick diagnosis",
        "### immediate actions (today)",
        "### 7-day plan",
        "### monitoring checklist",
    ]
    if any(section not in lowered for section in required_sections):
        return False
    if not (
        "### follow-up questions" in lowered
        or "### follow up questions" in lowered
        or "### suggested next prompts" in lowered
    ):
        return False

    has_header = re.search(
        r"^\|\s*action\s*\|\s*how to do it\s*\|\s*why it matters\s*\|",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    has_divider = re.search(r"^\|\s*-{2,}\s*\|\s*-{2,}\s*\|\s*-{2,}\s*\|", text, flags=re.MULTILINE)
    has_action_row = re.search(r"^\|\s*[^|\n]+\s*\|\s*[^|\n]+\s*\|\s*[^|\n]+\s*\|", text, flags=re.MULTILINE)
    if not (has_header and has_divider and has_action_row):
        return False
    if re.search(r"^\|\s*$", text, flags=re.MULTILINE):
        return False

    return len(text) >= 220


def _format_citation_line(citation: Dict[str, str]) -> str:
    title = citation.get("title") or citation.get("source_id") or "manual source"
    page = citation.get("page") or ""
    file_name = citation.get("file") or ""
    url = citation.get("url") or ""
    suffix_parts = [part for part in [f"p.{page}" if page else "", file_name, url] if part]
    if suffix_parts:
        return f"{title} ({', '.join(suffix_parts)})"
    return title


def _sources_markdown(citations: List[Dict[str, str]]) -> str:
    if not citations:
        return ""
    lines = ["### Sources used"]
    for citation in citations[:5]:
        lines.append(f"- {_format_citation_line(citation)}")
    return "\n".join(lines)


def _build_system_prompt(language: str, intent: str = "general_agronomy") -> str:
    language_hint = "Draft the advisory in English only. Translation is handled separately."
    if language == "en":
        language_hint = "Respond in clear English."
    if intent == "general_conversation":
        return (
            "You are GRIK, a helpful conversational assistant.\n"
            "Respond naturally and clearly, without assuming the topic is farming.\n"
            "If the user asks a farm question, provide practical farm guidance.\n"
            "If the user asks a general question, answer directly and briefly.\n"
            "Reason carefully, answer the core request first, and ask for clarification only when necessary.\n"
            f"{language_hint}\n"
            "Use GitHub-flavored Markdown only when helpful. No rigid section template is required."
        )
    return (
        "You are GRIK, an agricultural copilot for Ugandan farmers.\n"
        "Use grounded context first, then apply sound agronomy reasoning when context is incomplete.\n"
        "Do not fabricate products, institutions, policies, or numeric claims.\n"
        "If you infer beyond explicit references, keep it practical and state assumptions briefly.\n"
        "Think like a strong field advisor: identify the likely issue, sequence actions by urgency, and call out the main uncertainty.\n"
        f"{language_hint}\n"
        "Return GitHub-flavored Markdown and keep it practical.\n"
        "Use this exact section order:\n"
        "### Quick diagnosis\n"
        "State the most likely issue, why it fits, and the single biggest uncertainty.\n"
        "### Immediate actions (today)\n"
        "Include a markdown table with columns: Action | How to do it | Why it matters.\n"
        "Order actions from highest urgency to lowest.\n"
        "### 7-day plan\n"
        "Give a short day-by-day or phase-based plan.\n"
        "### Monitoring checklist\n"
        "Use concise bullets with observable field signs.\n"
        "### Suggested next prompts\n"
        "Add 3 numbered prompt suggestions written as complete user requests (not questions).\n"
        "Do not use code blocks."
    )


def _resolve_response_language(
    message: str,
    locale_hint: str | None,
    settings_language: str | None,
) -> tuple[str, float]:
    hinted = normalize_locale_hint(locale_hint) or normalize_locale_hint(settings_language)
    detected_no_hint, detected_no_hint_conf = detect_language(message, None)

    if hinted:
        if hinted != detected_no_hint and detected_no_hint == "en" and detected_no_hint_conf >= 0.58:
            # Avoid forcing non-English output for clearly English farmer questions.
            return "en", detected_no_hint_conf
        if hinted == "en" and detected_no_hint != "en" and detected_no_hint_conf >= 0.66:
            return detected_no_hint, detected_no_hint_conf
        return detect_language(message, hinted)

    return detected_no_hint, detected_no_hint_conf


def _build_user_prompt(
    question: str,
    intent: str,
    language: str,
    user_id: str,
    phone: str,
    settings: Any,
    profile: Any,
    weather_line: str,
    market_line: str,
    references: List[str],
    recent_chats: List[Dict[str, str]],
    recent_interactions: List[Dict[str, str]],
) -> str:
    if intent == "general_conversation":
        return (
            f"Detected language: {language}\n\n"
            f"Detected intent: {intent}\n\n"
            f"User question:\n{question}\n\n"
            "Instructions:\n"
            "- Answer conversationally like a human assistant.\n"
            "- Keep the answer practical, clear, and logically sequenced.\n"
            "- Do not force farming context unless the user asks for it.\n"
            "- If the request is ambiguous, ask one concise clarification question."
        )

    location = ", ".join([part for part in [settings.parish, settings.district] if part]) if settings else ""
    crops = profile.crops if profile and isinstance(profile.crops, list) else []
    planting_dates = profile.planting_dates if profile else []
    soil_profile = profile.soil_profile if profile else {}
    climate_exposure = profile.climate_exposure if profile else {}
    yield_estimates = profile.yield_estimates if profile else []

    profile_block = (
        f"farmer_id: {user_id}\n"
        f"phone: {phone}\n"
        f"language_preference: {getattr(settings, 'preferred_language', '') or ''}\n"
        f"location: {location or 'not provided'}\n"
        f"crops: {', '.join([str(c) for c in crops]) if crops else 'not provided'}\n"
        f"planting_dates: {_dict_to_text(planting_dates, 180) or 'not provided'}\n"
        f"soil_profile: {_dict_to_text(soil_profile, 200) or 'not provided'}\n"
        f"climate_exposure: {_dict_to_text(climate_exposure, 200) or 'not provided'}\n"
        f"yield_estimates: {_dict_to_text(yield_estimates, 180) or 'not provided'}"
    )

    weather_block = weather_line or "No weather signal available."
    market_block = market_line or "No market signal available."
    references_block = "\n".join(references[:3]) if references else "No grounded manual excerpt found."
    chats_block = "\n".join([f"- {item.get('role')}: {item.get('message')}" for item in recent_chats]) or "- No prior chat messages."
    memory_block = (
        "\n".join([f"- Q: {item.get('message')} | A: {item.get('response')}" for item in recent_interactions])
        or "- No prior interaction memory."
    )

    return (
        f"Detected language: {language}\n\n"
        f"Detected intent: {intent}\n\n"
        f"Farmer profile:\n{profile_block}\n\n"
        f"Weather signal:\n{weather_block}\n\n"
        f"Market signal:\n{market_block}\n\n"
        f"Recent chat memory:\n{chats_block}\n\n"
        f"Recent advisory memory:\n{memory_block}\n\n"
        f"Grounded references:\n{references_block}\n\n"
        f"Farmer question:\n{question}\n\n"
        "Important:\n"
        "- Keep actions realistic for smallholder farmers.\n"
        "- Prefer Uganda-grounded context, but reason with general agronomy principles when needed.\n"
        "- If assumptions are made, keep them short and operational.\n"
        "- Explain the likely cause or decision logic, not just the recommendation.\n"
        "- Prioritize actions by urgency and expected impact.\n"
        "- If critical details are missing, say what is missing without blocking the answer.\n"
        "- Mention weather or market only if relevant.\n"
        "- Keep each table cell short and clear."
    )


def _rewrite_to_structured_advisory(
    question: str,
    intent: str,
    crop: str,
    location_label: str | None,
    weather_line: str,
    market_line: str,
    draft: str,
) -> str:
    if not draft.strip():
        return ""
    messages = [
        {
            "role": "system",
            "content": (
                "You are an editor that rewrites agronomy advice into strict markdown structure. "
                "Keep useful ideas, remove noise, and output only the final advisory."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Farmer question: {question}\n"
                f"Intent: {intent}\n"
                f"Likely crop focus: {crop}\n"
                f"Location: {location_label or 'not provided'}\n"
                f"Weather signal: {weather_line or 'none'}\n"
                f"Market signal: {market_line or 'none'}\n\n"
                "Rewrite the draft below into this exact section order:\n"
                "### Quick diagnosis\n"
                "### Immediate actions (today)\n"
                "Use table: Action | How to do it | Why it matters.\n"
                "### 7-day plan\n"
                "### Monitoring checklist\n"
                "### Suggested next prompts\n"
                "Provide exactly 3 numbered suggested next prompts as user requests.\n"
                "Do not include code blocks.\n\n"
                f"DRAFT:\n{_trim(draft, 2400)}"
            ),
        },
    ]
    rewritten = _call_advisory_chat(messages, "structured advisory rewrite")
    return _clean_model_reply(rewritten)


def _filter_citations_for_relevance(citations: List[Dict[str, str]], question: str, crop: str) -> List[Dict[str, str]]:
    if not citations:
        return []
    crop_tokens = {token.lower() for token in re.findall(r"[a-zA-Z]+", crop) if token}
    agri_terms = {
        "maize",
        "beans",
        "cassava",
        "banana",
        "groundnut",
        "rice",
        "sorghum",
        "millet",
        "pest",
        "disease",
        "agriculture",
        "farming",
        "ipm",
        "fertilizer",
        "soil",
        "weather",
        "market",
    }

    kept: List[Dict[str, str]] = []
    seen_keys: set[str] = set()
    for citation in citations:
        source_id = (citation.get("source_id") or "").strip()
        title = (citation.get("title") or "").strip()
        searchable = f"{source_id} {title}".lower()

        key = f"{source_id}|{title}|{citation.get('url') or ''}"
        if key in seen_keys:
            continue

        is_external = source_id.startswith("wikimedia:")
        if is_external:
            has_crop_overlap = bool(crop_tokens.intersection(set(re.findall(r"[a-zA-Z]+", searchable))))
            has_agri_term = any(term in searchable for term in agri_terms)
            if not (has_crop_overlap or has_agri_term):
                continue

        seen_keys.add(key)
        kept.append(citation)
        if len(kept) >= 5:
            break
    return kept


def _score_source_confidence(
    citations: List[Dict[str, str]],
    weather_signal: Dict[str, Any] | None,
    market_signal: Dict[str, Any] | None,
) -> float:
    if not citations:
        return 0.0
    confidence = 0.45 + (0.08 * len(citations))
    external = sum(1 for item in citations if str(item.get("source_id", "")).startswith("wikimedia:"))
    confidence += min(0.08, external * 0.02)
    if weather_signal:
        confidence += 0.03
    if market_signal:
        confidence += 0.03
    return min(0.98, round(confidence, 2))


def generate_grik_chat_advice(
    db: Session,
    user: Any,
    message: str,
    locale_hint: str | None = None,
    location_hint: str | None = None,
    include_stored_history: bool = True,
    session_recent_chats: List[Dict[str, str]] | None = None,
    session_recent_interactions: List[Dict[str, str]] | None = None,
) -> AdviceResult:
    settings = get_or_create_settings(db, user.id)
    language, lang_conf = _resolve_response_language(
        message=message,
        locale_hint=locale_hint,
        settings_language=settings.preferred_language,
    )

    farmer = get_or_create_farmer(db, user.id, user.phone, preferred_language=language)
    profile = get_or_create_farmer_profile(db, farmer.id)

    location_text = (location_hint or "").strip()
    if not location_text:
        location_parts = [settings.parish, settings.district]
        location_text = ", ".join([part for part in location_parts if part]) if location_parts else ""
    if not location_text:
        location_text = None

    intent = _classify_query_intent(message)
    local_items = retrieve_grounded_advice(message, language=language, source="all", top_k=4)
    use_external = len(local_items) < 2 or language in {"sw", "lg", "nyn", "ach", "teo"}
    external_items = fetch_external_knowledge(message, language=language) if use_external else []
    grounded_items = [*local_items, *external_items]
    sources, citations, references = _collect_citations(grounded_items)

    weather_signal = _load_weather_signal(location_text)
    weather_line = _format_weather_line(weather_signal)
    market_signal = _load_market_signal(db, settings.district, profile.crops or [])
    market_line = _format_market_line(market_signal)

    if include_stored_history:
        recent_chats = _recent_chat_memory(db, user.id)
        recent_interactions = _recent_interaction_memory(db, user.id)
    else:
        recent_chats = []
        recent_interactions = []

    if session_recent_chats is not None:
        recent_chats = session_recent_chats
    if session_recent_interactions is not None:
        recent_interactions = session_recent_interactions

    system_prompt = _build_system_prompt(language, intent=intent)
    user_prompt = _build_user_prompt(
        question=message,
        intent=intent,
        language=language,
        user_id=user.id,
        phone=user.phone,
        settings=settings,
        profile=profile,
        weather_line=weather_line,
        market_line=market_line,
        references=references,
        recent_chats=recent_chats,
        recent_interactions=recent_interactions,
    )
    generated = _require_advisory_generation(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        purpose="primary advisory generation",
    )
    generated_clean = _clean_model_reply(generated)

    location_label = ", ".join([part for part in [settings.parish, settings.district] if part]) or None
    crop = _guess_crop(message, profile.crops or [], grounded_items, recent_chats=recent_chats)
    reply_mode = "model"
    if intent == "general_conversation":
        reply_en = generated_clean or _trim(generated, 3200)
        if not reply_en.strip():
            raise AIUnavailableError("GRIK AI returned no usable content for the conversation.")
        reply_mode = "model_general"
    elif _is_structured_reply(generated_clean):
        reply_en = generated_clean
    else:
        rewritten = _rewrite_to_structured_advisory(
            question=message,
            intent=intent,
            crop=crop,
            location_label=location_label,
            weather_line=weather_line,
            market_line=market_line,
            draft=generated_clean,
        )
        if _is_structured_reply(rewritten):
            reply_en = rewritten
            reply_mode = "rewrite"
        else:
            reply_en = rewritten or generated_clean
            if not reply_en.strip():
                raise AIUnavailableError(
                    "GRIK AI returned no usable content after generation and rewrite. "
                    "Fallback replies are disabled."
                )
            reply_mode = "rewrite_unvalidated"

    logger.info(
        "GRIK response mode=%s intent=%s lang=%s local_items=%s external_items=%s generated_len=%s",
        reply_mode,
        intent,
        language,
        len(local_items),
        len(external_items),
        len(generated_clean),
    )

    citations = _filter_citations_for_relevance(citations, message, crop)
    source_candidates = [citation.get("title") or citation.get("source_id") or "" for citation in citations]
    sources = []
    seen_source_keys: set[str] = set()
    for source in source_candidates:
        label = (source or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen_source_keys:
            continue
        seen_source_keys.add(key)
        sources.append(label)

    source_confidence = _score_source_confidence(citations, weather_signal, market_signal)
    min_threshold = get_min_confidence_threshold()
    if source_confidence < min_threshold and not grounded_items:
        reply_en = _normalize_markdown(
            f"{reply_en}\n\n### Extra details needed\n"
            "- Share crop name and growth stage.\n"
            "- Share visible symptoms and affected plant part.\n"
            "- Share district/parish and last rainfall."
        )
        citations = []
        sources = []
        source_confidence = 0.0

    if intent != "general_conversation" and citations and "### Sources used" not in reply_en:
        reply_en = _normalize_markdown(f"{reply_en}\n\n{_sources_markdown(citations)}")

    extracted_follow_ups = _extract_follow_ups(reply_en)
    if intent == "general_conversation":
        follow_ups = extracted_follow_ups[:3] if extracted_follow_ups else []
    else:
        follow_ups = _generate_follow_up_prompts(
            question=message,
            reply_en=reply_en,
            crop=crop,
            location_label=location_label,
            intent=intent,
            recent_chats=recent_chats,
            extracted_prompts=extracted_follow_ups,
        )

    reply = reply_en
    if language != "en":
        translated, translated_ok = _translate_markdown(reply_en, language)
        if translated_ok:
            reply = translated
            follow_ups = _translate_follow_ups(follow_ups, language)
        else:
            note = LANGUAGE_PILOT_NOTE.get(
                language,
                f"{LANGUAGE_NAME.get(language, language)} translation is currently limited, so core guidance is kept in English for reliability.",
            )
            reply = _normalize_markdown(
                f"### Language mode\n- {note}\n\n{reply_en}"
            )

    reply = _normalize_markdown(_trim(reply, 3200))
    citation_text = format_citations_short(citations)
    return AdviceResult(
        reply=reply,
        language=language,
        confidence=max(0.2, source_confidence) + (lang_conf * 0.1),
        sources=sources,
        citations=citations,
        source_confidence=source_confidence,
        citation_text=citation_text,
        follow_ups=follow_ups,
    )


def get_or_create_channel_auth_user(
    db: Session,
    farmer_id: str | None,
    phone: str | None,
) -> AuthUser:
    raw_farmer_id = (farmer_id or "").strip()
    normalized_phone = (phone or "").strip()

    user = None
    if raw_farmer_id and raw_farmer_id.lower() != "unknown":
        user = db.query(AuthUser).filter(AuthUser.id == raw_farmer_id).first()

    if user is None and normalized_phone and normalized_phone.lower() != "unknown":
        user = db.query(AuthUser).filter(AuthUser.phone == normalized_phone).first()

    if user:
        changed = False
        if user.role != "farmer":
            user.role = "farmer"
            changed = True
        if not user.status:
            user.status = "active"
            changed = True
        if not user.verification_status:
            user.verification_status = "unverified"
            changed = True
        if normalized_phone and normalized_phone.lower() != "unknown" and user.phone != normalized_phone:
            conflict = db.query(AuthUser).filter(AuthUser.phone == normalized_phone, AuthUser.id != user.id).first()
            if conflict is None:
                user.phone = normalized_phone
                changed = True
        if changed:
            db.commit()
            db.refresh(user)
        return user

    if normalized_phone and normalized_phone.lower() != "unknown":
        phone_value = normalized_phone
    elif raw_farmer_id and raw_farmer_id.lower() != "unknown":
        phone_value = f"unknown-{raw_farmer_id}"
    else:
        phone_value = f"unknown-{uuid.uuid4().hex[:12]}"

    candidate_id = raw_farmer_id if raw_farmer_id and raw_farmer_id.lower() != "unknown" else uuid.uuid4().hex
    while db.query(AuthUser).filter(AuthUser.id == candidate_id).first() is not None:
        candidate_id = uuid.uuid4().hex

    user = AuthUser(
        id=candidate_id,
        phone=phone_value,
        role="farmer",
        status="active",
        verification_status="unverified",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
