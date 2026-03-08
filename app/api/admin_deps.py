from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.services.admin_auth import get_admin_from_token


def get_admin_user(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    admin = get_admin_from_token(db, token)
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return admin


def require_admin_user(admin=Depends(get_admin_user)):
    return admin
