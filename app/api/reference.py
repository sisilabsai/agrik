from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import (
    AdminUser,
    AuthUser,
    AuthUserProfile,
    MarketAlert,
    MarketListing,
    MarketLocation,
    MarketOffer,
    MarketService,
)
from app.schemas.reference import (
    OnboardingOptionsOut,
    UgandaDistrictListOut,
    UgandaDistrictOut,
    UgandaLiveMapDistrictOut,
    UgandaLiveMapOut,
    UgandaLiveMapRoleTotalsOut,
    UgandaParishListOut,
    UgandaParishOut,
)
from app.services.onboarding import get_onboarding_options
from app.services.uganda_map import get_district_centroids
from app.services.uganda_locations import list_districts, list_parishes, summary

router = APIRouter()


def _normalize_name(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _max_dt(*values: datetime | None) -> datetime | None:
    rows = [value for value in values if value is not None]
    if not rows:
        return None
    return max(rows)


def _clamp(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, value))


@router.get("/uganda/districts", response_model=UgandaDistrictListOut)
def uganda_districts() -> UgandaDistrictListOut:
    stats = summary()
    items = list_districts()
    return UgandaDistrictListOut(
        country=stats["country"],
        total=len(items),
        items=[
            UgandaDistrictOut(
                id=item.id,
                name=item.name,
                parish_count=item.parish_count,
            )
            for item in items
        ],
    )


@router.get("/uganda/parishes", response_model=UgandaParishListOut)
def uganda_parishes(district: str | None = None) -> UgandaParishListOut:
    stats = summary()
    try:
        resolved_district, items = list_parishes(district)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return UgandaParishListOut(
        country=stats["country"],
        district=resolved_district,
        total=len(items),
        items=[
            UgandaParishOut(
                id=item["id"],
                name=item["name"],
                subcounty=item.get("subcounty") or None,
                district=item["district"],
                district_id=item["district_id"],
            )
            for item in items
        ],
    )


@router.get("/onboarding/options", response_model=OnboardingOptionsOut)
def onboarding_options() -> OnboardingOptionsOut:
    options = get_onboarding_options()
    return OnboardingOptionsOut(**options)


@router.get("/uganda/live-map", response_model=UgandaLiveMapOut)
def uganda_live_map(
    refresh: bool = False,
    refresh_limit: int = 8,
    db: Session = Depends(get_db),
) -> UgandaLiveMapOut:
    stats = summary()
    districts = list_districts()
    district_id_by_name = {_normalize_name(item.name): item.id for item in districts}
    district_payload: dict[str, dict] = {}

    def ensure_district(name: str) -> dict:
        key = _normalize_name(name)
        if key not in district_payload:
            district_payload[key] = {
                "district": name.strip(),
                "district_id": district_id_by_name.get(key),
                "users_total": 0,
                "farmers": 0,
                "buyers": 0,
                "offtakers": 0,
                "service_providers": 0,
                "input_suppliers": 0,
                "listings": 0,
                "offers": 0,
                "services": 0,
                "alerts": 0,
                "latest": None,
            }
        return district_payload[key]

    role_totals = {
        "total": 0,
        "farmers": 0,
        "buyers": 0,
        "offtakers": 0,
        "service_providers": 0,
        "input_suppliers": 0,
        "admins": db.query(AdminUser).count(),
    }

    role_rows = (
        db.query(AuthUserProfile.district, AuthUser.role, func.count(AuthUser.id))
        .join(AuthUser, AuthUser.id == AuthUserProfile.user_id)
        .group_by(AuthUserProfile.district, AuthUser.role)
        .all()
    )

    for district_name, role, count in role_rows:
        district = str(district_name or "").strip()
        if not district:
            continue
        row = ensure_district(district)
        count_value = int(count or 0)
        role_name = str(role or "").strip().lower()
        row["users_total"] += count_value
        role_totals["total"] += count_value
        if role_name == "farmer":
            row["farmers"] += count_value
            role_totals["farmers"] += count_value
        elif role_name == "buyer":
            row["buyers"] += count_value
            role_totals["buyers"] += count_value
        elif role_name == "offtaker":
            row["offtakers"] += count_value
            role_totals["offtakers"] += count_value
        elif role_name == "service_provider":
            row["service_providers"] += count_value
            role_totals["service_providers"] += count_value
        elif role_name == "input_supplier":
            row["input_suppliers"] += count_value
            role_totals["input_suppliers"] += count_value

    listing_rows = (
        db.query(MarketLocation.district, func.count(MarketListing.id), func.max(MarketListing.updated_at))
        .join(MarketListing, MarketListing.location_id == MarketLocation.id)
        .group_by(MarketLocation.district)
        .all()
    )
    for district_name, count, latest in listing_rows:
        district = str(district_name or "").strip()
        if not district:
            continue
        row = ensure_district(district)
        row["listings"] = int(count or 0)
        row["latest"] = _max_dt(row["latest"], latest)

    offer_rows = (
        db.query(MarketLocation.district, func.count(MarketOffer.id), func.max(MarketOffer.created_at))
        .join(MarketListing, MarketOffer.listing_id == MarketListing.id)
        .join(MarketLocation, MarketListing.location_id == MarketLocation.id)
        .group_by(MarketLocation.district)
        .all()
    )
    for district_name, count, latest in offer_rows:
        district = str(district_name or "").strip()
        if not district:
            continue
        row = ensure_district(district)
        row["offers"] = int(count or 0)
        row["latest"] = _max_dt(row["latest"], latest)

    service_rows = (
        db.query(MarketLocation.district, func.count(MarketService.id), func.max(MarketService.updated_at))
        .join(MarketService, MarketService.location_id == MarketLocation.id)
        .group_by(MarketLocation.district)
        .all()
    )
    for district_name, count, latest in service_rows:
        district = str(district_name or "").strip()
        if not district:
            continue
        row = ensure_district(district)
        row["services"] = int(count or 0)
        row["latest"] = _max_dt(row["latest"], latest)

    alert_rows = (
        db.query(MarketLocation.district, func.count(MarketAlert.id), func.max(MarketAlert.created_at))
        .join(MarketAlert, MarketAlert.location_id == MarketLocation.id)
        .group_by(MarketLocation.district)
        .all()
    )
    for district_name, count, latest in alert_rows:
        district = str(district_name or "").strip()
        if not district:
            continue
        row = ensure_district(district)
        row["alerts"] = int(count or 0)
        row["latest"] = _max_dt(row["latest"], latest)

    active_district_names = [
        row["district"]
        for row in district_payload.values()
        if (
            row["users_total"]
            + row["listings"]
            + row["offers"]
            + row["services"]
            + row["alerts"]
        )
        > 0
    ]
    max_refresh = max(0, min(int(refresh_limit), 40)) if refresh else 0
    centroids = get_district_centroids(active_district_names, max_refresh=max_refresh)

    markers: list[UgandaLiveMapDistrictOut] = []
    for district_name in active_district_names:
        row = district_payload.get(_normalize_name(district_name))
        centroid = centroids.get(district_name)
        if row is None or centroid is None:
            continue

        role_values = {
            "farmer": row["farmers"],
            "buyer": row["buyers"],
            "offtaker": row["offtakers"],
            "service_provider": row["service_providers"],
            "input_supplier": row["input_suppliers"],
        }
        dominant_role = max(role_values, key=role_values.get) if role_values else "farmer"
        market_activity = row["listings"] + row["offers"] + row["services"]
        readiness = _clamp(
            int(
                38
                + min(28, row["users_total"] * 2)
                + min(24, market_activity * 2)
                - min(16, row["alerts"] * 2)
            ),
            20,
            98,
        )
        markers.append(
            UgandaLiveMapDistrictOut(
                district_id=row["district_id"],
                district=row["district"],
                latitude=float(centroid["latitude"]),
                longitude=float(centroid["longitude"]),
                users_total=row["users_total"],
                farmers=row["farmers"],
                buyers=row["buyers"],
                offtakers=row["offtakers"],
                service_providers=row["service_providers"],
                input_suppliers=row["input_suppliers"],
                listings=row["listings"],
                offers=row["offers"],
                services=row["services"],
                alerts=row["alerts"],
                dominant_role=dominant_role,
                readiness=readiness,
                last_updated_at=_to_iso(row["latest"]),
            )
        )

    markers.sort(key=lambda item: (item.users_total, item.listings + item.offers + item.services), reverse=True)

    active_districts = len(active_district_names)
    coordinate_coverage_pct = round((len(markers) / active_districts * 100.0), 2) if active_districts else 0.0

    return UgandaLiveMapOut(
        country=stats["country"],
        generated_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        users_total=role_totals["total"],
        active_districts=active_districts,
        districts_total=len(districts),
        coordinate_coverage_pct=coordinate_coverage_pct,
        roles=UgandaLiveMapRoleTotalsOut(
            total=role_totals["total"],
            farmers=role_totals["farmers"],
            buyers=role_totals["buyers"],
            offtakers=role_totals["offtakers"],
            service_providers=role_totals["service_providers"],
            input_suppliers=role_totals["input_suppliers"],
            admins=role_totals["admins"],
        ),
        markers=markers,
    )
