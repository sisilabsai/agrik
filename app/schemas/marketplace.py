from __future__ import annotations

from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime


class MarketLocationIn(BaseModel):
    district: Optional[str] = None
    parish: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geometry_wkt: Optional[str] = None


class MarketLocationOut(MarketLocationIn):
    id: int


class MarketListingCreate(BaseModel):
    phone: str
    role: str = Field(description="seller or buyer")
    crop: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    grade: Optional[str] = None
    description: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_whatsapp: Optional[str] = None
    media_urls: Optional[List[str]] = None
    availability_start: Optional[datetime] = None
    availability_end: Optional[datetime] = None
    status: Optional[str] = None
    location: Optional[MarketLocationIn] = None


class MarketListingOut(BaseModel):
    id: int
    user_id: str
    role: str
    crop: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    grade: Optional[str] = None
    description: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_whatsapp: Optional[str] = None
    contact_unlocked: bool = False
    media_urls: List[str] = Field(default_factory=list)
    availability_start: Optional[datetime] = None
    availability_end: Optional[datetime] = None
    status: str
    created_at: datetime
    location: Optional[MarketLocationOut] = None


class MarketOfferCreate(BaseModel):
    phone: str
    listing_id: int
    price: Optional[float] = None
    quantity: Optional[float] = None


class MarketOfferOut(BaseModel):
    id: int
    listing_id: int
    user_id: str
    price: Optional[float] = None
    quantity: Optional[float] = None
    status: str
    created_at: datetime


class MarketServiceCreate(BaseModel):
    phone: str
    service_type: str
    description: Optional[str] = None
    media_urls: Optional[List[str]] = None
    coverage_radius_km: Optional[float] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    location: Optional[MarketLocationIn] = None


class MarketServiceOut(BaseModel):
    id: int
    user_id: str
    service_type: str
    description: Optional[str] = None
    media_urls: List[str] = Field(default_factory=list)
    coverage_radius_km: Optional[float] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    location: Optional[MarketLocationOut] = None


class MarketServiceUpdate(BaseModel):
    service_type: Optional[str] = None
    description: Optional[str] = None
    media_urls: Optional[List[str]] = None
    coverage_radius_km: Optional[float] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    location: Optional[MarketLocationIn] = None


class MarketAlertCreate(BaseModel):
    phone: str
    alert_type: str
    crop: Optional[str] = None
    threshold: Optional[float] = None
    channel: Optional[str] = None
    active: Optional[bool] = True
    min_interval_hours: Optional[int] = 24
    location: Optional[MarketLocationIn] = None


class MarketAlertOut(BaseModel):
    id: int
    user_id: str
    alert_type: str
    crop: Optional[str] = None
    threshold: Optional[float] = None
    channel: str
    active: bool
    min_interval_hours: int
    last_notified_at: Optional[datetime] = None
    created_at: datetime
    location: Optional[MarketLocationOut] = None


class MarketPriceCreate(BaseModel):
    crop: str
    market: Optional[str] = None
    district: Optional[str] = None
    price: float
    currency: Optional[str] = None
    source: Optional[str] = None
    captured_at: Optional[datetime] = None


class MarketPriceOut(BaseModel):
    id: int
    crop: str
    market: Optional[str] = None
    district: Optional[str] = None
    price: float
    currency: str
    source: Optional[str] = None
    captured_at: datetime


class MarketListingsResponse(BaseModel):
    items: List[MarketListingOut]


class MarketServicesResponse(BaseModel):
    items: List[MarketServiceOut]


class MarketAlertsResponse(BaseModel):
    items: List[MarketAlertOut]


class MarketOffersResponse(BaseModel):
    items: List[MarketOfferOut]


class MarketPricesResponse(BaseModel):
    items: List[MarketPriceOut]
