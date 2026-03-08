import base64
import hashlib
import hmac
import json
import time
from typing import Optional, Dict, Any


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def sign_token(payload: Dict[str, Any], secret: str, ttl_minutes: int) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {**payload, "iat": now, "exp": now + (ttl_minutes * 60)}

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def verify_token(token: str, secret: str) -> Optional[Dict[str, Any]]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError:
        return None

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    expected_b64 = _b64url_encode(expected)
    if not hmac.compare_digest(expected_b64, signature_b64):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    exp = payload.get("exp")
    if exp is not None and int(time.time()) > int(exp):
        return None
    return payload
