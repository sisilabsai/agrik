import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from app.core.config import get_admin_auth_config
from app.db.models import AdminUser
from app.services.auth_tokens import sign_token, verify_token
from app.services.email import send_email

logger = logging.getLogger("agrik.admin_auth")


@dataclass
class AdminAuthResult:
    admin: AdminUser
    token: Optional[str] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _hash_code(code: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def _generate_otp(length: int) -> str:
    max_value = 10 ** length
    return str(secrets.randbelow(max_value)).zfill(length)


def _hash_password(password: str, iterations: int) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2${iterations}${salt}${derived.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iter_str, salt, digest = stored.split("$", 3)
        if scheme != "pbkdf2":
            return False
        iterations = int(iter_str)
    except (ValueError, AttributeError):
        return False
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return secrets.compare_digest(derived.hex(), digest)


def seed_admin_user(db: Session) -> Optional[AdminUser]:
    cfg = get_admin_auth_config()
    email = (cfg.get("seed_email") or "").strip().lower()
    password = cfg.get("seed_password") or ""
    if not email or not password:
        return None

    existing = db.query(AdminUser).filter(AdminUser.email == email).first()
    if existing:
        if cfg.get("seed_update_password"):
            existing.password_hash = _hash_password(password, cfg["password_hash_iters"])
            existing.status = "active"
            db.commit()
            db.refresh(existing)
        return existing

    admin = AdminUser(
        id=uuid.uuid4().hex,
        email=email,
        password_hash=_hash_password(password, cfg["password_hash_iters"]),
        status="active",
        verification_status="unverified",
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def login_admin(db: Session, email: str, password: str) -> AdminUser:
    email = email.strip().lower()
    admin = db.query(AdminUser).filter(AdminUser.email == email).first()
    if not admin:
        raise ValueError("invalid credentials")
    if admin.status != "active":
        raise ValueError("admin is not active")
    if not _verify_password(password, admin.password_hash):
        raise ValueError("invalid credentials")
    return admin


def issue_admin_login_token(db: Session, admin: AdminUser, mark_verified: bool = False) -> AdminAuthResult:
    cfg = get_admin_auth_config()
    now = _now()
    admin.status = "active"
    if mark_verified:
        admin.verification_status = "verified"
    admin.last_login_at = now
    db.commit()
    db.refresh(admin)
    token = sign_token({"sub": admin.id, "role": "admin", "email": admin.email}, cfg["secret"], cfg["token_ttl_minutes"])
    return AdminAuthResult(admin=admin, token=token)


def send_admin_otp(db: Session, admin: AdminUser) -> None:
    cfg = get_admin_auth_config()
    if admin.otp_last_sent_at:
        cooldown = timedelta(seconds=cfg["otp_resend_cooldown_seconds"])
        last_sent_at = _as_utc(admin.otp_last_sent_at)
        if last_sent_at and _now() - last_sent_at < cooldown:
            raise ValueError("OTP recently sent. Please wait before requesting again.")

    code = _generate_otp(cfg["otp_length"])
    now = _now()
    admin.otp_hash = _hash_code(code, cfg["secret"])
    admin.otp_expires_at = now + timedelta(minutes=cfg["otp_ttl_minutes"])
    admin.otp_attempts = 0
    admin.otp_last_sent_at = now
    db.commit()

    subject = "AGRIK Admin Verification Code"
    body = f"Your AGRIK admin verification code is {code}. It expires soon."
    sent = send_email(admin.email, subject, body)
    if not sent:
        logger.warning("Admin OTP email send failed.")
        raise ValueError("OTP delivery failed")


def verify_admin_code(db: Session, email: str, code: str) -> AdminAuthResult:
    cfg = get_admin_auth_config()
    admin = db.query(AdminUser).filter(AdminUser.email == email).first()
    if not admin:
        raise ValueError("admin not found")
    if not admin.otp_hash or not admin.otp_expires_at:
        raise ValueError("no OTP requested")

    now = _now()
    expires_at = _as_utc(admin.otp_expires_at)
    if expires_at and now > expires_at:
        raise ValueError("OTP expired")
    if admin.otp_attempts >= cfg["otp_max_attempts"]:
        admin.status = "locked"
        db.commit()
        raise ValueError("too many attempts")

    expected = _hash_code(code, cfg["secret"])
    if not secrets.compare_digest(expected, admin.otp_hash):
        admin.otp_attempts += 1
        db.commit()
        raise ValueError("invalid code")

    admin.otp_hash = None
    admin.otp_expires_at = None
    admin.otp_attempts = 0
    db.commit()
    return issue_admin_login_token(db, admin, mark_verified=True)


def get_admin_from_token(db: Session, token: str) -> Optional[AdminUser]:
    cfg = get_admin_auth_config()
    payload = verify_token(token, cfg["secret"])
    if not payload:
        return None
    admin_id = payload.get("sub")
    if not admin_id:
        return None
    return db.query(AdminUser).filter(AdminUser.id == admin_id).first()
