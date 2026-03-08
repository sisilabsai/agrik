from typing import Any

from app.services.weather import geocode_location
from app.services.uganda_centroids import (
    coerce_float,
    load_centroid_cache,
    normalize_district_key,
    save_runtime_cache,
    utc_now_iso,
)


def get_district_centroids(
    district_names: list[str],
    max_refresh: int = 24,
) -> dict[str, dict[str, Any]]:
    cache = load_centroid_cache()

    wanted: list[tuple[str, str]] = []
    for district_name in district_names:
        district = str(district_name or "").strip()
        if not district:
            continue
        wanted.append((normalize_district_key(district), district))

    missing: list[tuple[str, str]] = []
    for key, district in wanted:
        if key and key not in cache:
            missing.append((key, district))

    changed = False
    for key, district in missing[: max(0, int(max_refresh))]:
        geocode = geocode_location(f"{district} District, Uganda")
        if geocode is None:
            geocode = geocode_location(f"{district}, Uganda")
        if geocode is None:
            continue
        lat = coerce_float(geocode.get("latitude"))
        lon = coerce_float(geocode.get("longitude"))
        if lat is None or lon is None:
            continue
        cache[key] = {
            "district": district,
            "latitude": lat,
            "longitude": lon,
            "source": "open-meteo",
            "updated_at": utc_now_iso(),
        }
        changed = True

    if changed:
        save_runtime_cache(cache)

    resolved: dict[str, dict[str, Any]] = {}
    for key, district in wanted:
        if key in cache:
            resolved[district] = cache[key]
    return resolved
