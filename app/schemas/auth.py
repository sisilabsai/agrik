from datetime import datetime
from pydantic import BaseModel, Field


class AuthRegisterRequest(BaseModel):
    phone: str
    password: str
    role: str
    full_name: str
    district: str
    parish: str
    crops: list[str] = Field(default_factory=list)
    organization_name: str | None = None
    service_categories: list[str] = Field(default_factory=list)
    focus_crops: list[str] = Field(default_factory=list)


class AuthLoginRequest(BaseModel):
    phone: str
    password: str | None = None
    device_id: str | None = None


class AuthVerifyRequest(BaseModel):
    phone: str
    code: str
    device_id: str | None = None


class AuthUserOut(BaseModel):
    id: str
    phone: str
    role: str
    status: str
    verification_status: str
    created_at: datetime


class AuthTokenResponse(BaseModel):
    token: str
    user: AuthUserOut


class AuthPhoneAvailabilityOut(BaseModel):
    phone: str
    normalized_phone: str
    available: bool
