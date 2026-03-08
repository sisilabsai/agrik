from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.core.config import get_auth_config
from app.schemas.auth import (
    AuthRegisterRequest,
    AuthLoginRequest,
    AuthVerifyRequest,
    AuthTokenResponse,
    AuthUserOut,
    AuthPhoneAvailabilityOut,
)
from app.services.auth import (
    register_user,
    send_login_code,
    login_user,
    try_dev_bypass_login,
    issue_login_token,
    verify_code,
    get_user_from_token,
    check_phone_availability,
)

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _serialize_user(user) -> AuthUserOut:
    return AuthUserOut(
        id=user.id,
        phone=user.phone,
        role=user.role,
        status=user.status,
        verification_status=user.verification_status,
        created_at=user.created_at,
    )


def _device_id_from_request(request: Request) -> str | None:
    value = request.headers.get("X-Device-ID", "").strip()
    return value or None


@router.post("/register")
def register(payload: AuthRegisterRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    cfg = get_auth_config()
    device_id = _device_id_from_request(request)
    try:
        user = register_user(
            db,
            phone=payload.phone,
            password=payload.password,
            role=payload.role,
            full_name=payload.full_name,
            district=payload.district,
            parish=payload.parish,
            crops=payload.crops,
            organization_name=payload.organization_name,
            service_categories=payload.service_categories,
            focus_crops=payload.focus_crops,
        )
        if cfg.get("require_otp"):
            send_login_code(db, user)
            return {"status": "otp_sent", "user": _serialize_user(user)}

        result = issue_login_token(db, user, mark_verified=False, device_id=device_id)
        return {"status": "logged_in", "token": result.token, "user": _serialize_user(result.user)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/login")
def login(payload: AuthLoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    cfg = get_auth_config()
    device_id = payload.device_id or _device_id_from_request(request)
    try:
        user = login_user(db, payload.phone, payload.password)

        if not cfg.get("require_otp"):
            result = issue_login_token(db, user, mark_verified=False, device_id=device_id)
            return {
                "status": "logged_in",
                "token": result.token,
                "user": _serialize_user(result.user),
            }

        bypass = try_dev_bypass_login(db, user, device_id=device_id)
        if bypass and bypass.token:
            return {"status": "logged_in", "token": bypass.token, "user": _serialize_user(bypass.user)}

        send_login_code(db, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "otp_sent", "user": _serialize_user(user)}


@router.post("/verify-otp", response_model=AuthTokenResponse)
def verify_otp(payload: AuthVerifyRequest, request: Request, db: Session = Depends(get_db)) -> AuthTokenResponse:
    device_id = payload.device_id or _device_id_from_request(request)
    try:
        result = verify_code(db, payload.phone, payload.code, device_id=device_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthTokenResponse(token=result.token or "", user=_serialize_user(result.user))


@router.get("/me", response_model=AuthUserOut)
def me(request: Request, db: Session = Depends(get_db)) -> AuthUserOut:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    user = get_user_from_token(db, token, device_id=_device_id_from_request(request))
    if not user:
        raise HTTPException(status_code=401, detail="Session expired or invalid token")
    return _serialize_user(user)


@router.get("/phone-availability", response_model=AuthPhoneAvailabilityOut)
def phone_availability(phone: str, db: Session = Depends(get_db)) -> AuthPhoneAvailabilityOut:
    try:
        normalized_phone, available = check_phone_availability(db, phone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthPhoneAvailabilityOut(
        phone=phone,
        normalized_phone=normalized_phone,
        available=available,
    )
