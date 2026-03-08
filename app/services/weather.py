import logging
from typing import Optional, Dict, Any, List
import httpx

from app.core.config import get_open_meteo_config
from app.services.uganda_centroids import find_centroid_for_query

logger = logging.getLogger("agrik.weather")


def geocode_location(query: str) -> Optional[Dict[str, Any]]:
    cfg = get_open_meteo_config()
    params = {
        "name": query,
        "count": 1,
        "language": "en",
        "format": "json",
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(cfg["geocode_url"], params=params)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Geocode failed for '%s': %s", query, exc)
        fallback = find_centroid_for_query(query)
        if fallback:
            return {
                "latitude": fallback.get("latitude"),
                "longitude": fallback.get("longitude"),
                "name": fallback.get("district"),
                "admin1": "Uganda",
                "admin2": None,
                "country": "Uganda",
            }
        return None

    results = data.get("results") if isinstance(data, dict) else None
    if not results:
        fallback = find_centroid_for_query(query)
        if fallback:
            return {
                "latitude": fallback.get("latitude"),
                "longitude": fallback.get("longitude"),
                "name": fallback.get("district"),
                "admin1": "Uganda",
                "admin2": None,
                "country": "Uganda",
            }
        return None
    first = results[0]
    if not isinstance(first, dict):
        return None
    return {
        "latitude": first.get("latitude"),
        "longitude": first.get("longitude"),
        "name": first.get("name"),
        "admin1": first.get("admin1"),
        "admin2": first.get("admin2"),
        "country": first.get("country"),
    }


def get_daily_forecast(latitude: float, longitude: float, days: Optional[int] = None) -> Optional[Dict[str, Any]]:
    cfg = get_open_meteo_config()
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "auto",
    }
    if days:
        params["forecast_days"] = days

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(cfg["forecast_url"], params=params)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Forecast fetch failed for %.4f, %.4f: %s", latitude, longitude, exc)
        return None


def summarize_daily_forecast(forecast: Dict[str, Any]) -> Dict[str, Any]:
    daily = forecast.get("daily") if isinstance(forecast, dict) else None
    if not isinstance(daily, dict):
        return {"days": [], "next_rain_date": None}

    dates = daily.get("time") or []
    precip = daily.get("precipitation_sum") or []
    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []

    days: List[Dict[str, Any]] = []
    next_rain = None
    for idx, date in enumerate(dates):
        entry = {
            "date": date,
            "precipitation_mm": precip[idx] if idx < len(precip) else None,
            "temp_max_c": tmax[idx] if idx < len(tmax) else None,
            "temp_min_c": tmin[idx] if idx < len(tmin) else None,
        }
        if next_rain is None and isinstance(entry["precipitation_mm"], (int, float)) and entry["precipitation_mm"] >= 5:
            next_rain = date
        days.append(entry)

    return {"days": days, "next_rain_date": next_rain}
