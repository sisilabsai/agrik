from datetime import datetime
from pydantic import BaseModel


class UserSettingsOut(BaseModel):
    user_id: str
    preferred_language: str | None = None
    district: str | None = None
    parish: str | None = None
    sms_opt_in: bool
    voice_opt_in: bool
    weather_alerts: bool
    price_alerts: bool
    updated_at: datetime | None = None


class UserSettingsUpdate(BaseModel):
    preferred_language: str | None = None
    district: str | None = None
    parish: str | None = None
    sms_opt_in: bool | None = None
    voice_opt_in: bool | None = None
    weather_alerts: bool | None = None
    price_alerts: bool | None = None


class SubscriptionCreate(BaseModel):
    plan: str
    status: str | None = None
    ends_at: datetime | None = None
    provider: str | None = None
    external_ref: str | None = None


class SubscriptionOut(BaseModel):
    id: int
    plan: str
    status: str
    starts_at: datetime
    ends_at: datetime | None = None
    provider: str | None = None
    external_ref: str | None = None


class PlatformServiceOut(BaseModel):
    id: int
    service_type: str
    description: str | None = None
    price: float | None = None
    currency: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime | None = None
