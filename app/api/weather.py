from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.schemas.weather import WeatherSummaryOut, WeatherDayOut
from app.services.user_settings import get_or_create_settings
from app.services.weather import geocode_location, get_daily_forecast, summarize_daily_forecast

router = APIRouter()


@router.get("/summary", response_model=WeatherSummaryOut)
def weather_summary(
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    location: str | None = None,
    days: int = Query(5, ge=1, le=10),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> WeatherSummaryOut:
    settings = get_or_create_settings(db, user.id)
    location_name = None

    if lat is None or lon is None:
        if not location:
            parts = [settings.parish, settings.district]
            location = ", ".join([p for p in parts if p])

        if not location:
            raise HTTPException(status_code=400, detail="Location is required to fetch weather.")

        geo = geocode_location(location)
        if not geo or geo.get("latitude") is None or geo.get("longitude") is None:
            raise HTTPException(status_code=404, detail="Unable to resolve location.")
        lat = geo["latitude"]
        lon = geo["longitude"]
        location_name = ", ".join(
            [part for part in (geo.get("name"), geo.get("admin1"), geo.get("country")) if part]
        )
    else:
        location_name = location or f"{lat:.3f}, {lon:.3f}"

    forecast = get_daily_forecast(lat, lon, days=days)
    if not forecast:
        raise HTTPException(status_code=502, detail="Weather provider unavailable.")

    summary = summarize_daily_forecast(forecast)
    return WeatherSummaryOut(
        location_name=location_name,
        latitude=lat,
        longitude=lon,
        next_rain_date=summary.get("next_rain_date"),
        days=[WeatherDayOut(**day) for day in summary.get("days", [])],
        data_source="open-meteo",
    )
