import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, List

from sqlalchemy.orm import Session

from app.core.config import get_default_sms_provider, get_price_alert_lookback_hours
from app.db.models import MarketAlert, MarketUser, MarketLocation, MarketPrice
from app.services.outbound_queue import send_with_fallback

logger = logging.getLogger("agrik.price_alerts")

SUPPORTED_PRICE_ALERTS = {"price_above", "price_below", "price"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _should_send(alert: MarketAlert) -> bool:
    if not alert.active:
        return False
    if not alert.min_interval_hours:
        return True
    last = _as_utc(alert.last_notified_at)
    if not last:
        return True
    return _now() - last >= timedelta(hours=alert.min_interval_hours)


def _latest_price(
    db: Session,
    crop: str,
    district: Optional[str],
    lookback_hours: int,
) -> Optional[MarketPrice]:
    query = db.query(MarketPrice).filter(MarketPrice.crop.ilike(f"%{crop}%"))
    if district:
        query = query.filter(MarketPrice.district == district)
    if lookback_hours:
        cutoff = _now() - timedelta(hours=lookback_hours)
        query = query.filter(MarketPrice.captured_at >= cutoff)
    return query.order_by(MarketPrice.captured_at.desc()).first()


def _format_message(alert: MarketAlert, price: MarketPrice, district: Optional[str]) -> str:
    loc = district or price.district or price.market or "your area"
    direction = (alert.alert_type or "").lower()
    if direction == "price_below":
        return (
            f"Price alert: {price.crop} in {loc} is UGX{price.price:g} "
            f"(<= UGX{alert.threshold:g})."
        )
    return (
        f"Price alert: {price.crop} in {loc} is UGX{price.price:g} "
        f"(>= UGX{alert.threshold:g})."
    )


def process_price_alerts(db: Session) -> int:
    preferred = get_default_sms_provider()
    lookback_hours = get_price_alert_lookback_hours()

    alerts: List[Tuple[MarketAlert, MarketUser, MarketLocation]] = (
        db.query(MarketAlert, MarketUser, MarketLocation)
        .join(MarketUser, MarketAlert.user_id == MarketUser.id)
        .outerjoin(MarketLocation, MarketAlert.location_id == MarketLocation.id)
        .filter(MarketAlert.active.is_(True))
        .filter(MarketAlert.alert_type.in_(SUPPORTED_PRICE_ALERTS))
        .all()
    )

    sent = 0
    for alert, user, location in alerts:
        if not _should_send(alert):
            continue
        if not alert.crop or alert.threshold is None:
            continue

        district = location.district if location else None
        latest = _latest_price(db, alert.crop, district, lookback_hours)
        if not latest:
            continue

        alert_type = (alert.alert_type or "price").lower()
        if alert_type == "price":
            alert_type = "price_above"

        triggered = False
        if alert_type == "price_above" and latest.price >= alert.threshold:
            triggered = True
        if alert_type == "price_below" and latest.price <= alert.threshold:
            triggered = True

        if not triggered:
            continue

        message = _format_message(alert, latest, district)
        response = send_with_fallback(user.phone, message, preferred=preferred)
        status_code = response.get("status_code", "")
        if status_code.isdigit() and 200 <= int(status_code) < 300:
            alert.last_notified_at = _now()
            db.commit()
            sent += 1
        else:
            logger.warning("Price alert send failed: %s", response)

    return sent
