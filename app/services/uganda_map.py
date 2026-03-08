import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.weather import geocode_location

CACHE_PATH = Path(__file__).resolve().parents[2] / "runtime" / "cache" / "uganda_district_centroids.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_district_key(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        number = float(value)
        if number != number:
            return None
        return number
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _load_cache() -> dict[str, dict[str, Any]]:
    if not CACHE_PATH.exists():
        return {}
    try:
        payload = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    if not isinstance(payload, dict):
        return {}

    rows = payload.get("districts")
    if not isinstance(rows, list):
        return {}

    cache: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        district = str(row.get("district") or "").strip()
        key = _normalize_district_key(district)
        if not key:
            continue
        lat = _to_float(row.get("latitude"))
        lon = _to_float(row.get("longitude"))
        if lat is None or lon is None:
            continue
        cache[key] = {
            "district": district,
            "latitude": lat,
            "longitude": lon,
            "source": str(row.get("source") or "open-meteo").strip() or "open-meteo",
            "updated_at": str(row.get("updated_at") or "").strip() or _utc_now_iso(),
        }
    return cache


def _save_cache(cache: dict[str, dict[str, Any]]) -> None:
    rows = [
        {
            "district": value["district"],
            "latitude": value["latitude"],
            "longitude": value["longitude"],
            "source": value.get("source") or "open-meteo",
            "updated_at": value.get("updated_at") or _utc_now_iso(),
        }
        for _, value in sorted(cache.items(), key=lambda item: item[1]["district"].lower())
    ]
    payload = {
        "generated_at": _utc_now_iso(),
        "source": "open-meteo geocoding",
        "districts": rows,
    }
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def get_district_centroids(
    district_names: list[str],
    max_refresh: int = 24,
) -> dict[str, dict[str, Any]]:
    cache = _load_cache()

    wanted: list[tuple[str, str]] = []
    for district_name in district_names:
        district = str(district_name or "").strip()
        if not district:
            continue
        wanted.append((_normalize_district_key(district), district))

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
        lat = _to_float(geocode.get("latitude"))
        lon = _to_float(geocode.get("longitude"))
        if lat is None or lon is None:
            continue
        cache[key] = {
            "district": district,
            "latitude": lat,
            "longitude": lon,
            "source": "open-meteo",
            "updated_at": _utc_now_iso(),
        }
        changed = True

    if changed:
        _save_cache(cache)

    resolved: dict[str, dict[str, Any]] = {}
    for key, district in wanted:
        if key in cache:
            resolved[district] = cache[key]
    return resolved
