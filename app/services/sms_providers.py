from dataclasses import dataclass
from typing import Dict, Optional
import base64
import hashlib
import hmac


@dataclass
class ProviderMessage:
    farmer_id: str
    phone: str
    message: str
    locale_hint: Optional[str]
    location_hint: Optional[str]


def parse_twilio(payload: Dict[str, str]) -> ProviderMessage:
    # Twilio typical fields: From, Body
    return ProviderMessage(
        farmer_id=payload.get("From", "unknown"),
        phone=payload.get("From", "unknown"),
        message=payload.get("Body", ""),
        locale_hint=None,
        location_hint=None,
    )


def parse_africas_talking(payload: Dict[str, str]) -> ProviderMessage:
    # Africa's Talking typical fields: from, text
    return ProviderMessage(
        farmer_id=payload.get("from", "unknown"),
        phone=payload.get("from", "unknown"),
        message=payload.get("text", ""),
        locale_hint=None,
        location_hint=None,
    )


def validate_twilio_signature(url: str, params: Dict[str, str], signature: str, auth_token: str) -> bool:
    # Twilio signature = base64(hmac_sha1(auth_token, url + sorted(params)))
    if not signature or not auth_token:
        return False

    s = url
    for key in sorted(params.keys()):
        s += key + params[key]

    digest = hmac.new(auth_token.encode("utf-8"), s.encode("utf-8"), hashlib.sha1).digest()
    computed = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(computed, signature)


def validate_africas_talking_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    # Generic HMAC-SHA256 over raw body
    if not signature or not secret:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)
