from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.schemas.auth import (
    AuthEmailAvailabilityOut,
    AuthEmailCodeRequest,
    AuthLoginRequest,
    AuthPasswordResetConfirmRequest,
    AuthPhoneAvailabilityOut,
    AuthRegisterRequest,
    AuthStatusResponse,
    AuthTokenResponse,
    AuthUserOut,
    AuthVerifyRequest,
)
from app.services.auth import (
    check_email_availability,
    check_phone_availability,
    confirm_password_reset,
    get_user_from_token,
    issue_login_token,
    login_user,
    register_user,
    request_password_reset,
    send_email_verification_code,
    verify_email_code,
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
        email=user.email,
        role=user.role,
        status=user.status,
        verification_status=user.verification_status,
        created_at=user.created_at,
    )


def _device_id_from_request(request: Request) -> str | None:
    value = request.headers.get("X-Device-ID", "").strip()
    return value or None


@router.post("/register", response_model=AuthStatusResponse)
def register(payload: AuthRegisterRequest, db: Session = Depends(get_db)) -> AuthStatusResponse:
    try:
        user = register_user(
            db,
            phone=payload.phone,
            email=payload.email,
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthStatusResponse(
        status="verification_sent",
        message="Check your email for a 6-digit AGRIK verification code.",
        user=_serialize_user(user),
    )


@router.post("/login")
def login(payload: AuthLoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    device_id = payload.device_id or _device_id_from_request(request)
    try:
        user = login_user(db, payload.phone, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if (user.verification_status or "").lower() != "verified":
        try:
            send_email_verification_code(db, user.email)
        except ValueError:
            pass
        return {
            "status": "verification_required",
            "message": "Verify your email before signing in.",
            "user": _serialize_user(user),
        }

    result = issue_login_token(db, user, mark_verified=False, device_id=device_id)
    return {
        "status": "logged_in",
        "token": result.token,
        "user": _serialize_user(result.user),
    }


@router.post("/verify-email", response_model=AuthTokenResponse)
def verify_email(payload: AuthVerifyRequest, request: Request, db: Session = Depends(get_db)) -> AuthTokenResponse:
    device_id = payload.device_id or _device_id_from_request(request)
    try:
        result = verify_email_code(db, payload.email, payload.code, device_id=device_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthTokenResponse(token=result.token or "", user=_serialize_user(result.user))


@router.post("/resend-verification-code", response_model=AuthStatusResponse)
def resend_verification_code(payload: AuthEmailCodeRequest, db: Session = Depends(get_db)) -> AuthStatusResponse:
    try:
        user = send_email_verification_code(db, payload.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthStatusResponse(
        status="verification_sent",
        message="A new verification code has been sent to your email.",
        user=_serialize_user(user),
    )


@router.post("/forgot-password/request", response_model=AuthStatusResponse)
def forgot_password_request(payload: AuthEmailCodeRequest, db: Session = Depends(get_db)) -> AuthStatusResponse:
    try:
        request_password_reset(db, payload.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthStatusResponse(
        status="reset_code_sent",
        message="If the email exists, a password reset code has been sent.",
    )


@router.post("/forgot-password/reset", response_model=AuthTokenResponse)
def forgot_password_reset(
    payload: AuthPasswordResetConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    device_id = _device_id_from_request(request)
    try:
        result = confirm_password_reset(
            db,
            email=payload.email,
            code=payload.code,
            password=payload.password,
            device_id=device_id,
        )
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


@router.get("/email-availability", response_model=AuthEmailAvailabilityOut)
def email_availability(email: str, db: Session = Depends(get_db)) -> AuthEmailAvailabilityOut:
    try:
        normalized_email, available = check_email_availability(db, email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthEmailAvailabilityOut(
        email=email,
        normalized_email=normalized_email,
        available=available,
    )
