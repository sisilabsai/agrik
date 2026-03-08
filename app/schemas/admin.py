from datetime import datetime
from pydantic import BaseModel, Field

from app.schemas.marketplace import MarketLocationIn, MarketLocationOut


class AdminUserActivityItem(BaseModel):
    action: str
    created_at: datetime
    detail_summary: str | None = None


class AdminUserOut(BaseModel):
    id: str
    phone: str
    role: str
    status: str
    verification_status: str
    full_name: str | None = None
    email: str | None = None
    district: str | None = None
    parish: str | None = None
    organization_name: str | None = None
    onboarding_stage: str | None = None
    crops: list[str] = Field(default_factory=list)
    service_categories: list[str] = Field(default_factory=list)
    focus_crops: list[str] = Field(default_factory=list)
    market_listings: int = 0
    market_alerts: int = 0
    market_offers: int = 0
    chat_messages: int = 0
    last_chat_at: datetime | None = None
    recent_activity: list[AdminUserActivityItem] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None
    last_login_at: datetime | None = None


class AdminUserUpdate(BaseModel):
    role: str | None = None
    status: str | None = None
    verification_status: str | None = None


class AdminListingUpdate(BaseModel):
    status: str | None = None
    price: float | None = None
    quantity: float | None = None
    unit: str | None = None
    currency: str | None = None
    grade: str | None = None


class AdminSummaryOut(BaseModel):
    users_total: int
    users_verified: int
    users_pending: int
    listings: int
    offers: int
    services: int
    alerts: int
    prices: int


class AdminServiceCreate(BaseModel):
    service_type: str
    description: str | None = None
    price: float | None = None
    currency: str | None = None
    status: str | None = None


class AdminServiceUpdate(BaseModel):
    service_type: str | None = None
    description: str | None = None
    price: float | None = None
    currency: str | None = None
    status: str | None = None


class AdminServiceOut(BaseModel):
    id: int
    service_type: str
    description: str | None = None
    price: float | None = None
    currency: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime | None = None


class AdminServicesResponse(BaseModel):
    items: list[AdminServiceOut]


class AdminAlertCreate(BaseModel):
    phone: str
    alert_type: str
    crop: str | None = None
    threshold: float | None = None
    channel: str | None = None
    active: bool | None = True
    min_interval_hours: int | None = 24
    location: MarketLocationIn | None = None


class AdminAlertBulkCreate(BaseModel):
    phones: list[str]
    alert_type: str
    crop: str | None = None
    threshold: float | None = None
    channel: str | None = None
    active: bool | None = True
    min_interval_hours: int | None = 24
    location: MarketLocationIn | None = None


class AdminAlertUpdate(BaseModel):
    alert_type: str | None = None
    crop: str | None = None
    threshold: float | None = None
    channel: str | None = None
    active: bool | None = None
    min_interval_hours: int | None = None
    location: MarketLocationIn | None = None


class AdminAlertOut(BaseModel):
    id: int
    user_id: str
    target_phone: str | None = None
    alert_type: str
    crop: str | None = None
    threshold: float | None = None
    channel: str
    active: bool
    min_interval_hours: int
    last_notified_at: datetime | None = None
    created_at: datetime
    location: MarketLocationOut | None = None


class AdminAlertsResponse(BaseModel):
    items: list[AdminAlertOut]


class AdminSeedServicesRequest(BaseModel):
    service_types: list[str] | None = None


class AdminMetadataUser(BaseModel):
    id: str
    phone: str
    role: str


class AdminMetadataOut(BaseModel):
    crops: list[str]
    districts: list[str]
    parishes: list[str]
    markets: list[str]
    currencies: list[str]
    price_sources: list[str]
    service_types: list[str]
    alert_types: list[str]
    channels: list[str]
    users: list[AdminMetadataUser]


class AdminPriceUpdate(BaseModel):
    crop: str | None = None
    market: str | None = None
    district: str | None = None
    price: float | None = None
    currency: str | None = None
    source: str | None = None
    captured_at: datetime | None = None


class AdminActivityOut(BaseModel):
    id: int
    admin_id: str
    action: str
    details: dict
    ip_address: str | None = None
    created_at: datetime


class AdminActivityResponse(BaseModel):
    items: list[AdminActivityOut]
