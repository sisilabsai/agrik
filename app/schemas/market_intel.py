from datetime import datetime
from pydantic import BaseModel

from app.schemas.marketplace import MarketPriceOut


class MarketPricePrediction(BaseModel):
    crop: str
    district: str | None = None
    predicted_price: float
    currency: str
    direction: str
    confidence: float
    horizon_days: int
    points: int


class MarketInsight(BaseModel):
    title: str | None = None
    summary: str
    source: str | None = None
    score: float | None = None


class MarketIntelResponse(BaseModel):
    prices: list[MarketPriceOut]
    predictions: list[MarketPricePrediction]
    insights: list[MarketInsight]
    updated_at: datetime | None = None
    source: str | None = None
