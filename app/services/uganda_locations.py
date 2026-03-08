import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "uganda_locations.json"


def _normalize_key(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


@dataclass(frozen=True)
class DistrictOption:
    id: str
    name: str
    parish_count: int


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


@lru_cache(maxsize=1)
def _load_index() -> dict[str, Any]:
    if not DATA_PATH.exists():
        raise RuntimeError(f"Uganda locations file not found: {DATA_PATH}")

    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    district_rows: list[dict[str, Any]] = []
    district_by_name: dict[str, dict[str, Any]] = {}
    district_by_id: dict[str, dict[str, Any]] = {}
    all_parishes: list[dict[str, str]] = []

    for district in payload.get("districts", []):
        district_id = _coerce_text(district.get("id"))
        district_name = _coerce_text(district.get("name"))
        parish_rows: list[dict[str, str]] = []
        parish_by_id: dict[str, dict[str, str]] = {}
        parish_by_name: dict[str, dict[str, str]] = {}

        for parish in district.get("parishes", []):
            parish_row = {
                "id": _coerce_text(parish.get("id")),
                "name": _coerce_text(parish.get("name")),
                "subcounty": _coerce_text(parish.get("subcounty")),
                "district": district_name,
                "district_id": district_id,
            }
            parish_rows.append(parish_row)
            all_parishes.append(parish_row)

            if parish_row["id"]:
                parish_by_id[parish_row["id"]] = parish_row
            parish_key = _normalize_key(parish_row["name"])
            if parish_key and parish_key not in parish_by_name:
                parish_by_name[parish_key] = parish_row

        parish_rows.sort(key=lambda item: (item["name"].lower(), item["subcounty"].lower(), item["id"]))
        district_row = {
            "id": district_id,
            "name": district_name,
            "parish_count": len(parish_rows),
            "parishes": parish_rows,
            "parish_by_id": parish_by_id,
            "parish_by_name": parish_by_name,
        }
        district_rows.append(district_row)
        if district_id:
            district_by_id[district_id] = district_row
        district_name_key = _normalize_key(district_name)
        if district_name_key:
            district_by_name[district_name_key] = district_row

    district_rows.sort(key=lambda item: item["name"].lower())
    all_parishes.sort(key=lambda item: (item["district"].lower(), item["name"].lower(), item["subcounty"].lower(), item["id"]))

    return {
        "country": _coerce_text(payload.get("country")) or "Uganda",
        "district_count": len(district_rows),
        "parish_count": len(all_parishes),
        "districts": district_rows,
        "all_parishes": all_parishes,
        "district_by_name": district_by_name,
        "district_by_id": district_by_id,
    }


def summary() -> dict[str, Any]:
    idx = _load_index()
    return {
        "country": idx["country"],
        "district_count": idx["district_count"],
        "parish_count": idx["parish_count"],
    }


def list_districts() -> list[DistrictOption]:
    idx = _load_index()
    return [
        DistrictOption(
            id=item["id"],
            name=item["name"],
            parish_count=item["parish_count"],
        )
        for item in idx["districts"]
    ]


def _resolve_district(district: str) -> dict[str, Any]:
    district_input = _coerce_text(district)
    if not district_input:
        raise ValueError("district is required")

    idx = _load_index()
    district_row = idx["district_by_id"].get(district_input)
    if district_row:
        return district_row

    district_key = _normalize_key(district_input)
    district_row = idx["district_by_name"].get(district_key)
    if district_row:
        return district_row

    raise ValueError("district not found in Uganda reference data")


def list_parishes(district: str | None = None) -> tuple[str | None, list[dict[str, str]]]:
    idx = _load_index()
    if district is None or not district.strip():
        return None, idx["all_parishes"]

    district_row = _resolve_district(district)
    return district_row["name"], district_row["parishes"]


def resolve_district_and_parish(district: str, parish: str) -> tuple[str, str]:
    district_row = _resolve_district(district)
    parish_input = _coerce_text(parish)
    if not parish_input:
        raise ValueError("parish is required")

    parish_row = district_row["parish_by_id"].get(parish_input)
    if not parish_row:
        parish_key = _normalize_key(parish_input)
        parish_row = district_row["parish_by_name"].get(parish_key)

    if not parish_row:
        raise ValueError(f"parish not found in district {district_row['name']}")

    return district_row["name"], parish_row["name"]
