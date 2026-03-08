from pydantic import BaseModel


class WeatherDayOut(BaseModel):
    date: str
    precipitation_mm: float | None = None
    temp_max_c: float | None = None
    temp_min_c: float | None = None


class WeatherSummaryOut(BaseModel):
    location_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    next_rain_date: str | None = None
    days: list[WeatherDayOut]
    data_source: str
