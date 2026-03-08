import logging
from typing import Dict, Optional
import httpx
from app.core.config import get_infobip_config

logger = logging.getLogger("agrik.infobip")


def _normalize_base_url(base_url: str) -> str:
    base_url = (base_url or "").strip()
    if not base_url:
        base_url = "https://api.infobip.com"
    if not base_url.startswith("http://") and not base_url.startswith("https://"):
        base_url = f"https://{base_url}"
    return base_url.rstrip("/")


def _headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"App {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def send_voice_message_infobip(
    to: str,
    text: str,
    language: Optional[str] = None,
    voice_name: Optional[str] = None,
    voice_gender: Optional[str] = None,
    from_number: Optional[str] = None,
) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg["api_key"]:
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg["base_url"])
    from_number = from_number or cfg["voice_from"]
    if not from_number:
        raise ValueError("INFOBIP_VOICE_FROM is not configured")

    payload = {
        "messages": [
            {
                "destinations": [{"to": to}],
                "from": from_number,
                "language": language or cfg["voice_language"],
                "text": text,
                "voice": {
                    "name": voice_name or cfg["voice_name"],
                    "gender": (voice_gender or cfg["voice_gender"]),
                },
            }
        ]
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/tts/3/advanced",
                json=payload,
                headers=_headers(cfg["api_key"]),
            )
            if 200 <= response.status_code < 300:
                return {
                    "status_code": str(response.status_code),
                    "response_text": response.text,
                }
            logger.warning("Infobip TTS failed: status=%s body=%s", response.status_code, response.text)
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip TTS HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }


def send_ctc_voice_call_infobip(
    destination_a: str,
    destination_b: str,
    text: str,
    language: Optional[str] = None,
    voice_name: Optional[str] = None,
    voice_gender: Optional[str] = None,
    from_number: Optional[str] = None,
) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg["api_key"]:
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg["base_url"])
    from_number = from_number or cfg["voice_from"]
    if not from_number:
        raise ValueError("INFOBIP_VOICE_FROM is not configured")

    payload = {
        "messages": [
            {
                "destinationA": destination_a,
                "destinationB": destination_b,
                "from": from_number,
                "language": language or cfg["voice_language"],
                "voice": {
                    "name": voice_name or cfg["voice_name"],
                    "gender": (voice_gender or cfg["voice_gender"]),
                },
                "text": text,
            }
        ]
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/voice/ctc/1/send",
                json=payload,
                headers=_headers(cfg["api_key"]),
            )
            if 200 <= response.status_code < 300:
                return {
                    "status_code": str(response.status_code),
                    "response_text": response.text,
                }
            logger.warning("Infobip CTC failed: status=%s body=%s", response.status_code, response.text)
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip CTC HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }
