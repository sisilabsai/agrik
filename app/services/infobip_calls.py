import logging
from typing import Dict, Optional
import httpx
from app.core.config import get_infobip_config
from app.services.infobip_voice import _normalize_base_url, _headers

logger = logging.getLogger("agrik.infobip")


def create_call_infobip(
    to: str,
    from_number: Optional[str] = None,
    application_id: Optional[str] = None,
    connect_timeout: int = 30,
) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg["api_key"]:
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg["base_url"])
    from_number = from_number or cfg["voice_from"]
    application_id = application_id or cfg["calls_application_id"]

    if not from_number:
        raise ValueError("INFOBIP_VOICE_FROM is not configured")
    if not application_id:
        raise ValueError("INFOBIP_CALLS_APP_ID is not configured")

    payload = {
        "from": from_number,
        "to": to,
        "applicationId": application_id,
        "connectTimeout": connect_timeout,
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/calls/1/calls",
                json=payload,
                headers=_headers(cfg["api_key"]),
            )
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip create call HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }


def answer_call_infobip(call_id: str) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg["api_key"]:
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg["base_url"])

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/calls/1/calls/{call_id}/answer",
                json={},
                headers=_headers(cfg["api_key"]),
            )
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip answer call HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }


def say_call_infobip(
    call_id: str,
    text: str,
    language: Optional[str] = None,
    voice_name: Optional[str] = None,
    voice_gender: Optional[str] = None,
) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg["api_key"]:
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg["base_url"])
    gender = (voice_gender or cfg["voice_gender"] or "female").upper()

    payload = {
        "text": text,
        "language": language or cfg["voice_language"],
        "preferences": {
            "voiceGender": gender,
            "voiceName": voice_name or cfg["voice_name"],
        },
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/calls/1/calls/{call_id}/say",
                json=payload,
                headers=_headers(cfg["api_key"]),
            )
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip say call HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }
