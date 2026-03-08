from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.services.auth import get_user_from_token


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    device_id = request.headers.get("X-Device-ID", "").strip() or None
    user = get_user_from_token(db, token, device_id=device_id)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired or invalid token")
    return user


def get_optional_current_user(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    device_id = request.headers.get("X-Device-ID", "").strip() or None
    return get_user_from_token(db, token, device_id=device_id)


def require_admin(user=Depends(get_current_user)):
    if getattr(user, "role", None) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
