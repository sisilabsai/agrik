import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple

from sqlalchemy.orm import Session

from app.core.config import get_open_meteo_config, get_default_sms_provider
from app.db.models import MarketAlert, MarketUser, MarketLocation
from app.services.weather import geocode_location, get_daily_forecast
from app.services.outbound_queue import send_with_fallback

logger = logging.getLogger("agrik.weather_alerts")

SUPPORTED_ALERTS = {"rain", "dry", "heat"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _combine_location_name(location: MarketLocation) -> Optional[str]:
    parts = [p for p in [location.parish, location.district] if p]
    if not parts:
        return None
    return ", ".join(parts)


def _extract_daily_series(forecast: Dict[str, Any]) -> Optional[Dict[str, List]]:
    daily = forecast.get("daily") if isinstance(forecast, dict) else None
    if not isinstance(daily, dict):
        return None
    required = ["time", "precipitation_sum", "temperature_2m_max", "temperature_2m_min"]
    if not all(k in daily for k in required):
        return None
    return daily


def _evaluate_rain(daily: Dict[str, List], threshold: float) -> Optional[Dict[str, Any]]:
    for date, precip in zip(daily["time"], daily["precipitation_sum"]):
        if precip is not None and precip >= threshold:
            return {"type": "rain", "date": date, "value": precip}
    return None


def _evaluate_dry(daily: Dict[str, List], threshold: float, days: int) -> Optional[Dict[str, Any]]:
    precip_series = list(daily["precipitation_sum"])[:days]
    if not precip_series:
        return None
    if all((p is not None and p <= threshold) for p in precip_series):
        return {
            "type": "dry",
            "date": daily["time"][0],
            "value": max(precip_series),
        }
    return None


def _evaluate_heat(daily: Dict[str, List], threshold: float) -> Optional[Dict[str, Any]]:
    for date, temp in zip(daily["time"], daily["temperature_2m_max"]):
        if temp is not None and temp >= threshold:
            return {"type": "heat", "date": date, "value": temp}
    return None


def _should_send(alert: MarketAlert) -> bool:
    if not alert.active:
        return False
    if not alert.min_interval_hours:
        return True
    last = _as_utc(alert.last_notified_at)
    if not last:
        return True
    return _now() - last >= timedelta(hours=alert.min_interval_hours)


def _build_message(event: Dict[str, Any], location: MarketLocation | None) -> str:
    loc = location.district if location and location.district else "your area"
    if event["type"] == "rain":
        return f"Weather alert: rain expected in {loc} on {event['date']} (approx {event['value']:.0f}mm)."
    if event["type"] == "dry":
        return f"Weather alert: low rainfall expected in {loc} starting {event['date']}."
    if event["type"] == "heat":
        return f"Weather alert: high temperatures expected in {loc} on {event['date']} (up to {event['value']:.1f}C)."
    return "Weather alert."


def evaluate_weather_alert(alert: MarketAlert, location: MarketLocation) -> tuple[Optional[Dict[str, Any]], bool]:
    cfg = get_open_meteo_config()
    location_updated = False
    if location.latitude is None or location.longitude is None:
        query = _combine_location_name(location)
        if query:
            geo = geocode_location(query)
            if geo and geo.get("latitude") is not None and geo.get("longitude") is not None:
                location.latitude = float(geo["latitude"])
                location.longitude = float(geo["longitude"])
                location_updated = True
    if location.latitude is None or location.longitude is None:
        return None, location_updated

    forecast = get_daily_forecast(location.latitude, location.longitude, days=cfg["lookahead_days"])
    if not forecast:
        return None, location_updated
    daily = _extract_daily_series(forecast)
    if not daily:
        return None, location_updated

    alert_type = (alert.alert_type or "").lower()
    threshold = alert.threshold or 10.0

    if alert_type == "rain":
        return _evaluate_rain(daily, threshold), location_updated
    if alert_type == "dry":
        return _evaluate_dry(daily, threshold, cfg["lookahead_days"]), location_updated
    if alert_type == "heat":
        return _evaluate_heat(daily, threshold), location_updated
    return None, location_updated


def process_weather_alerts(db: Session) -> int:
    preferred = get_default_sms_provider()

    alerts: List[Tuple[MarketAlert, MarketUser, MarketLocation]] = (
        db.query(MarketAlert, MarketUser, MarketLocation)
        .join(MarketUser, MarketAlert.user_id == MarketUser.id)
        .outerjoin(MarketLocation, MarketAlert.location_id == MarketLocation.id)
        .filter(MarketAlert.active.is_(True))
        .filter(MarketAlert.alert_type.in_(SUPPORTED_ALERTS))
        .all()
    )

    sent = 0
    for alert, user, location in alerts:
        if not location:
            continue
        if not _should_send(alert):
            continue

        event, location_updated = evaluate_weather_alert(alert, location)
        if location_updated:
            db.commit()
        if not event:
            continue

        message = _build_message(event, location)
        response = send_with_fallback(user.phone, message, preferred=preferred)
        status_code = response.get("status_code", "")
        if status_code.isdigit() and 200 <= int(status_code) < 300:
            alert.last_notified_at = _now()
            db.commit()
            sent += 1
        else:
            logger.warning("Weather alert send failed: %s", response)

    return sent
