from typing import Dict
import httpx
from app.core.config import get_twilio_config


def send_sms_twilio(to: str, message: str) -> Dict[str, str]:
    cfg = get_twilio_config()
    from_number = str(cfg.get("from_number") or "").strip()
    messaging_service_sid = str(cfg.get("messaging_service_sid") or "").strip()
    if not cfg["account_sid"] or not cfg["auth_token"]:
        raise ValueError("Twilio credentials are not configured")
    if not from_number and not messaging_service_sid:
        raise ValueError("Twilio sender is not configured (set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID)")

    url = f"{cfg['base_url'].rstrip('/')}/2010-04-01/Accounts/{cfg['account_sid']}/Messages.json"
    data = {
        "To": to,
        "Body": message,
    }
    if from_number:
        data["From"] = from_number
    else:
        data["MessagingServiceSid"] = messaging_service_sid

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(url, data=data, auth=(cfg["account_sid"], cfg["auth_token"]))
            return {
                "status_code": str(response.status_code),
                "response_text": response.text,
            }
    except httpx.HTTPError as exc:
        return {
            "status_code": "error",
            "response_text": str(exc),
        }
