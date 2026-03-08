from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.admin_deps import get_admin_user
from app.schemas.admin_auth import AdminLoginRequest, AdminVerifyRequest, AdminTokenResponse, AdminAccountOut
from app.core.config import get_admin_auth_config
from app.services.admin_auth import (
    login_admin,
    send_admin_otp,
    verify_admin_code,
    issue_admin_login_token,
    seed_admin_user,
)
from app.db.models import AdminUser
from app.services.admin_audit import record_admin_activity

router = APIRouter()


def _serialize_admin(admin) -> AdminAccountOut:
    return AdminAccountOut(
        id=admin.id,
        email=admin.email,
        status=admin.status,
        verification_status=admin.verification_status,
        created_at=admin.created_at,
        updated_at=admin.updated_at,
        last_login_at=admin.last_login_at,
    )


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


@router.post("/login")
def admin_login(payload: AdminLoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    cfg = get_admin_auth_config()
    email = payload.email.strip().lower()
    ip_address = _client_ip(request)
    try:
        # Keep dev/admin seed credentials recoverable without a server restart sequence.
        seed_email = (cfg.get("seed_email") or "").strip().lower()
        if seed_email and email == seed_email:
            seed_admin_user(db)

        existing = db.query(AdminUser).filter(AdminUser.email == email).first()
        if not existing:
            record_admin_activity(
                db,
                "unknown",
                "admin_login_failed",
                details={"email": email, "reason": "admin_not_found"},
                ip_address=ip_address,
            )
            raise HTTPException(status_code=404, detail="admin not found")

        admin = login_admin(db, email, payload.password)
        if cfg.get("require_otp"):
            send_admin_otp(db, admin)
            record_admin_activity(
                db,
                admin.id,
                "admin_login_requested",
                details={"email": email},
                ip_address=ip_address,
            )
            record_admin_activity(
                db,
                admin.id,
                "admin_otp_sent",
                details={"email": email},
                ip_address=ip_address,
            )
            return {"status": "otp_sent"}

        result = issue_admin_login_token(db, admin, mark_verified=True)
        record_admin_activity(
            db,
            admin.id,
            "admin_login_success",
            details={"email": email, "method": "password_only"},
            ip_address=ip_address,
        )
        return {"status": "logged_in", "token": result.token, "admin": _serialize_admin(result.admin)}
    except HTTPException:
        raise
    except ValueError as exc:
        detail = str(exc)
        status_code = 401 if detail == "invalid credentials" else 400
        record_admin_activity(
            db,
            "unknown",
            "admin_login_failed",
            details={"email": email, "reason": detail},
            ip_address=ip_address,
        )
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/verify-otp", response_model=AdminTokenResponse)
def admin_verify(payload: AdminVerifyRequest, request: Request, db: Session = Depends(get_db)) -> AdminTokenResponse:
    email = payload.email.strip().lower()
    ip_address = _client_ip(request)
    try:
        result = verify_admin_code(db, email, payload.code)
        record_admin_activity(
            db,
            result.admin.id,
            "admin_login_success",
            details={"email": email},
            ip_address=ip_address,
        )
    except ValueError as exc:
        record_admin_activity(
            db,
            "unknown",
            "admin_otp_failed",
            details={"email": email, "reason": str(exc)},
            ip_address=ip_address,
        )
        raise HTTPException(status_code=400, detail=str(exc))
    return AdminTokenResponse(token=result.token or "", admin=_serialize_admin(result.admin))


@router.get("/me", response_model=AdminAccountOut)
def admin_me(admin=Depends(get_admin_user)) -> AdminAccountOut:
    return _serialize_admin(admin)
