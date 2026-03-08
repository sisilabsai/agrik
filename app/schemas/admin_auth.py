from pydantic import BaseModel

from datetime import datetime


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminVerifyRequest(BaseModel):
    email: str
    code: str


class AdminAccountOut(BaseModel):
    id: str
    email: str
    status: str
    verification_status: str
    created_at: datetime
    updated_at: datetime | None = None
    last_login_at: datetime | None = None


class AdminTokenResponse(BaseModel):
    token: str
    admin: AdminAccountOut
