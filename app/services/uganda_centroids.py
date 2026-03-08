import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RUNTIME_CACHE_PATH = Path(__file__).resolve().parents[2] / "runtime" / "cache" / "uganda_district_centroids.json"
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "uganda_district_centroids.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_district_key(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def coerce_float(value: Any) -> float | None:
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


def _load_cache_file(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
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
        key = normalize_district_key(district)
        if not key:
            continue
        lat = coerce_float(row.get("latitude"))
        lon = coerce_float(row.get("longitude"))
        if lat is None or lon is None:
            continue
        cache[key] = {
            "district": district,
            "latitude": lat,
            "longitude": lon,
            "source": str(row.get("source") or "uganda-centroids").strip() or "uganda-centroids",
            "updated_at": str(row.get("updated_at") or "").strip() or utc_now_iso(),
        }
    return cache


def load_centroid_cache() -> dict[str, dict[str, Any]]:
    runtime_cache = _load_cache_file(RUNTIME_CACHE_PATH)
    data_cache = _load_cache_file(DATA_PATH)
    merged = dict(data_cache)
    merged.update(runtime_cache)
    return merged


def save_runtime_cache(cache: dict[str, dict[str, Any]]) -> None:
    rows = [
        {
            "district": value["district"],
            "latitude": value["latitude"],
            "longitude": value["longitude"],
            "source": value.get("source") or "open-meteo",
            "updated_at": value.get("updated_at") or utc_now_iso(),
        }
        for _, value in sorted(cache.items(), key=lambda item: item[1]["district"].lower())
    ]
    payload = {
        "generated_at": utc_now_iso(),
        "source": "uganda district centroids",
        "districts": rows,
    }
    RUNTIME_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def get_known_centroid(district_name: str) -> dict[str, Any] | None:
    cache = load_centroid_cache()
    return cache.get(normalize_district_key(district_name))


def find_centroid_for_query(query: str) -> dict[str, Any] | None:
    raw = str(query or "").strip()
    if not raw:
        return None

    candidates: list[str] = []
    for token in raw.split(","):
        cleaned = token.strip()
        if not cleaned:
            continue
        candidates.append(cleaned)
        if cleaned.lower().endswith(" district"):
            candidates.append(cleaned[: -len(" district")].strip())

    candidates.append(raw)
    seen: set[str] = set()
    for candidate in candidates:
        key = normalize_district_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        centroid = get_known_centroid(candidate)
        if centroid:
            return centroid
    return None
