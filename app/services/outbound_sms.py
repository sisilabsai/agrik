from typing import Dict
import logging
import time
import httpx
from app.core.config import get_africas_talking_config

logger = logging.getLogger("agrik.sms")


def send_sms_africas_talking(to: str, message: str, max_retries: int = 3) -> Dict[str, str]:
    cfg = get_africas_talking_config()
    if not cfg["username"] or not cfg["api_key"]:
        raise ValueError("Africa's Talking credentials are not configured")

    url = f"{cfg['base_url'].rstrip('/')}/version1/messaging"
    data = {
        "username": cfg["username"],
        "to": to,
        "message": message,
    }
    if cfg["sender_id"]:
        data["from"] = cfg["sender_id"]

    headers = {
        "apiKey": cfg["api_key"],
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }

    # Single attempt; retry handled by background worker
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(url, data=data, headers=headers)
            if 200 <= response.status_code < 300:
                return {
                    "status_code": str(response.status_code),
                    "response_text": response.text,
                    "attempts": "1",
                }
            last_error = f"status={response.status_code} body={response.text}"
            logger.warning("Africa's Talking send failed: %s", last_error)
            return {"status_code": str(response.status_code), "response_text": last_error, "attempts": "1"}
    except httpx.HTTPError as exc:
        last_error = str(exc)
        logger.error("Africa's Talking HTTP error: %s", last_error)
        return {"status_code": "error", "response_text": last_error, "attempts": "1"}
