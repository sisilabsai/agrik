from typing import Dict
import logging
import httpx
from app.core.config import get_infobip_config
from app.services.infobip_voice import _normalize_base_url, _headers

logger = logging.getLogger("agrik.sms")


def send_sms_infobip(to: str, message: str) -> Dict[str, str]:
    cfg = get_infobip_config()
    if not cfg.get("api_key"):
        raise ValueError("INFOBIP_API_KEY is not configured")

    base_url = _normalize_base_url(cfg.get("base_url", ""))
    sender = cfg.get("sms_from") or cfg.get("voice_from")
    if not sender:
        raise ValueError("INFOBIP_SMS_FROM is not configured")

    payload = {
        "messages": [
            {
                "from": sender,
                "destinations": [{"to": to}],
                "text": message,
            }
        ]
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{base_url}/sms/2/text/advanced",
                json=payload,
                headers=_headers(cfg["api_key"]),
            )
            if 200 <= response.status_code < 300:
                return {
                    "status_code": str(response.status_code),
                    "response_text": response.text,
                }
            logger.warning("Infobip SMS failed: status=%s body=%s", response.status_code, response.text)
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        logger.error("Infobip SMS HTTP error: %s", exc)
        return {
            "status_code": "error",
            "response_text": str(exc),
        }
