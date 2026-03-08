import logging
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import get_auth_config, get_default_sms_provider
from app.db.models import AuthUser
from app.services.auth_tokens import sign_token
from app.services.onboarding import prepare_onboarding, upsert_registration_profile
from app.services.outbound_queue import send_and_record
from app.services.passwords import hash_password, verify_password
from app.services.phone_numbers import normalize_ugandan_phone, phone_lookup_variants

logger = logging.getLogger("agrik.auth")

ALLOWED_SELF_ROLES = {"farmer", "buyer", "offtaker", "service_provider", "input_supplier"}
DEVICE_ID_MAX_LENGTH = 128


@dataclass
class AuthResult:
    user: AuthUser
    token: Optional[str] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_device_id(device_id: Optional[str]) -> Optional[str]:
    if not device_id:
        return None
    value = str(device_id).strip()
    if not value:
        return None
    return value[:DEVICE_ID_MAX_LENGTH]


def _session_idle_window(cfg: dict) -> timedelta:
    idle_days = max(1, int(cfg.get("session_idle_days", 3)))
    return timedelta(days=idle_days)


def _hash_code(code: str, secret: str) -> str:
    import hashlib
    import hmac

    return hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def _generate_otp(length: int) -> str:
    max_value = 10 ** length
    return str(secrets.randbelow(max_value)).zfill(length)


def _send_otp(phone: str, code: str) -> None:
    message = f"Your AGRIK verification code is {code}. It expires soon."
    preferred = get_default_sms_provider()
    response = send_and_record(preferred, phone, message)
    status_code = str(response.get("status_code", "")).strip()
    if status_code.isdigit() and 200 <= int(status_code) < 300:
        return
    detail = response.get("response_text", "Unknown delivery failure")
    logger.warning("OTP delivery failed via %s: %s", preferred, detail)
    raise ValueError(f"OTP delivery failed via {preferred}. {detail}")


def _ensure_role(role: str) -> None:
    if role not in ALLOWED_SELF_ROLES:
        raise ValueError(f"role must be one of: {', '.join(sorted(ALLOWED_SELF_ROLES))}")


def _ensure_password(password: str, cfg: dict) -> str:
    value = str(password or "")
    min_length = max(4, int(cfg.get("password_min_length", 6)))
    if len(value) < min_length:
        raise ValueError(f"password must be at least {min_length} characters")
    return value


def _should_bypass_otp_for_dev() -> bool:
    cfg = get_auth_config()
    app_env = os.getenv("APP_ENV", "dev").strip().lower()
    if app_env in {"prod", "production"}:
        return False
    return bool(cfg.get("dev_bypass_otp", False))


def _find_user_by_phone(db: Session, phone: str) -> tuple[Optional[AuthUser], str]:
    normalized_phone = normalize_ugandan_phone(phone)
    variants = phone_lookup_variants(normalized_phone)

    preferred = db.query(AuthUser).filter(AuthUser.phone == normalized_phone).first()
    if preferred:
        return preferred, normalized_phone

    for variant in variants:
        if variant == normalized_phone:
            continue
        user = db.query(AuthUser).filter(AuthUser.phone == variant).first()
        if user:
            return user, normalized_phone

    return None, normalized_phone


def register_user(
    db: Session,
    phone: str,
    password: str,
    role: str,
    full_name: str,
    district: str,
    parish: str,
    crops: list[str] | None = None,
    organization_name: str | None = None,
    service_categories: list[str] | None = None,
    focus_crops: list[str] | None = None,
) -> AuthUser:
    cfg = get_auth_config()
    _ensure_role(role)
    password_value = _ensure_password(password, cfg)
    existing_user, normalized_phone = _find_user_by_phone(db, phone)
    if existing_user:
        raise ValueError("phone number is already registered")

    prepared = prepare_onboarding(
        role=role,
        full_name=full_name,
        district=district,
        parish=parish,
        crops=crops,
        organization_name=organization_name,
        service_categories=service_categories,
        focus_crops=focus_crops,
    )

    user = AuthUser(
        id=uuid.uuid4().hex,
        phone=normalized_phone,
        password_hash=hash_password(password_value),
        role=role,
        status="pending",
        verification_status="unverified",
    )
    db.add(user)
    db.flush()

    upsert_registration_profile(
        db=db,
        user_id=user.id,
        phone=normalized_phone,
        role=role,
        prepared=prepared,
    )

    db.commit()
    db.refresh(user)
    return user


def check_phone_availability(db: Session, phone: str) -> tuple[str, bool]:
    user, normalized_phone = _find_user_by_phone(db, phone)
    return normalized_phone, user is None


def send_login_code(db: Session, user: AuthUser) -> None:
    cfg = get_auth_config()
    if user.otp_last_sent_at:
        cooldown = timedelta(seconds=cfg["otp_resend_cooldown_seconds"])
        last_sent_at = _as_utc(user.otp_last_sent_at)
        if last_sent_at and _now() - last_sent_at < cooldown:
            raise ValueError("OTP recently sent. Please wait before requesting again.")

    code = _generate_otp(cfg["otp_length"])
    _send_otp(user.phone, code)
    now = _now()
    user.otp_hash = _hash_code(code, cfg["secret"])
    user.otp_expires_at = now + timedelta(minutes=cfg["otp_ttl_minutes"])
    user.otp_attempts = 0
    user.otp_last_sent_at = now
    db.commit()


def login_user(db: Session, phone: str, password: Optional[str] = None) -> AuthUser:
    cfg = get_auth_config()
    password_value = str(password or "")
    user, normalized_phone = _find_user_by_phone(db, phone)
    if not user:
        raise ValueError("invalid credentials")

    if user.password_hash:
        if not password_value:
            raise ValueError("password required")
        if not verify_password(password_value, user.password_hash):
            raise ValueError("invalid credentials")
    else:
        if password_value:
            user.password_hash = hash_password(_ensure_password(password_value, cfg))
            db.commit()
            db.refresh(user)
        elif not bool(cfg.get("allow_phone_only_login", True)):
            raise ValueError("password required")

    if user.phone != normalized_phone:
        phone_taken = (
            db.query(AuthUser)
            .filter(AuthUser.phone == normalized_phone, AuthUser.id != user.id)
            .first()
        )
        if not phone_taken:
            user.phone = normalized_phone
            db.commit()
            db.refresh(user)

    return user


def issue_login_token(
    db: Session,
    user: AuthUser,
    mark_verified: bool = False,
    device_id: Optional[str] = None,
) -> AuthResult:
    cfg = get_auth_config()
    now = _now()
    normalized_device_id = _normalize_device_id(device_id)
    user.status = "active"
    if mark_verified:
        user.verification_status = "verified"
    user.otp_hash = None
    user.otp_expires_at = None
    user.otp_attempts = 0
    user.last_login_at = now
    db.commit()
    db.refresh(user)

    payload = {"sub": user.id, "phone": user.phone, "role": user.role}
    if normalized_device_id:
        payload["device_id"] = normalized_device_id
    token = sign_token(payload, cfg["secret"], cfg["token_ttl_minutes"])
    return AuthResult(user=user, token=token)


def try_dev_bypass_login(db: Session, user: AuthUser, device_id: Optional[str] = None) -> Optional[AuthResult]:
    if not _should_bypass_otp_for_dev():
        return None
    return issue_login_token(db, user, mark_verified=True, device_id=device_id)


def verify_code(db: Session, phone: str, code: str, device_id: Optional[str] = None) -> AuthResult:
    cfg = get_auth_config()
    user, _ = _find_user_by_phone(db, phone)
    if not user:
        raise ValueError("user not found")
    if not user.otp_hash or not user.otp_expires_at:
        raise ValueError("no OTP requested")

    now = _now()
    expires_at = _as_utc(user.otp_expires_at)
    if expires_at and now > expires_at:
        raise ValueError("OTP expired")
    if user.otp_attempts >= cfg["otp_max_attempts"]:
        user.status = "locked"
        db.commit()
        raise ValueError("too many attempts")

    expected = _hash_code(code, cfg["secret"])
    if not secrets.compare_digest(expected, user.otp_hash):
        user.otp_attempts += 1
        db.commit()
        raise ValueError("invalid code")

    user.verification_status = "verified"
    return issue_login_token(db, user, mark_verified=False, device_id=device_id)


def get_user_from_token(
    db: Session,
    token: str,
    device_id: Optional[str] = None,
    touch_activity: bool = True,
) -> Optional[AuthUser]:
    from app.services.auth_tokens import verify_token

    cfg = get_auth_config()
    payload = verify_token(token, cfg["secret"])
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = db.query(AuthUser).filter(AuthUser.id == user_id).first()
    if not user:
        return None

    now = _now()
    last_seen_at = _as_utc(user.last_login_at)
    if not last_seen_at or now - last_seen_at > _session_idle_window(cfg):
        return None

    token_device_id = _normalize_device_id(payload.get("device_id"))
    request_device_id = _normalize_device_id(device_id)
    if token_device_id and token_device_id != request_device_id:
        return None

    if touch_activity:
        touch_seconds = max(30, int(cfg.get("activity_touch_seconds", 300)))
        if (now - last_seen_at).total_seconds() >= touch_seconds:
            user.last_login_at = now
            db.commit()
            db.refresh(user)

    return user
