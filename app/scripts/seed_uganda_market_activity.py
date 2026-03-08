import json
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import sys

from sqlalchemy import and_
from sqlalchemy.orm import Session

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.db.models import (
    MarketAlert,
    MarketListing,
    MarketLocation,
    MarketOffer,
    MarketPrice,
    MarketService,
    MarketUser,
)
from app.db.session import SessionLocal
from app.services.phone_numbers import normalize_ugandan_phone

INPUT_USERS_PATH = Path("runtime/seeds/test_users_uganda.json")
OUTPUT_SUMMARY_PATH = Path("runtime/seeds/market_activity_uganda.json")

SEED_SOURCE = "uganda_market_activity_v1"
SEED_TAG = "[seed:uganda_market_activity_v1]"
TOTAL_UGANDA_DISTRICTS = 135

CROP_PRICE_BASE: dict[str, float] = {
    "maize": 1200.0,
    "beans": 2900.0,
    "cassava": 900.0,
    "groundnut": 4200.0,
    "banana": 1100.0,
    "coffee": 5200.0,
    "sorghum": 1700.0,
    "millet": 2100.0,
    "rice": 2800.0,
    "sweet potato": 1000.0,
}

SERVICE_TYPES = [
    "transport",
    "storage",
    "mechanization",
    "aggregation",
    "drying",
    "extension",
    "input_supply",
    "finance",
]


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(second=0, microsecond=0)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _as_text(value: Any) -> str:
    return str(value or "").strip()


def _extract_crop(user_record: dict[str, Any], fallback_index: int) -> str:
    crops = user_record.get("crops") or []
    focus = user_record.get("focus_crops") or []
    pool = [item for item in crops if _as_text(item)] + [item for item in focus if _as_text(item)]
    if pool:
        return _as_text(pool[fallback_index % len(pool)]).lower()
    defaults = list(CROP_PRICE_BASE.keys())
    return defaults[fallback_index % len(defaults)]


def _price_for_crop(crop: str, district_index: int, offset: int = 0) -> float:
    base = CROP_PRICE_BASE.get(crop.lower(), 1400.0)
    swing = ((district_index * 37 + offset * 11) % 19) - 9
    return round(base + swing * 35, 2)


def _group_seed_users(rows: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        district_id = _as_text(row.get("district_id"))
        role = _as_text(row.get("role")).lower()
        if not district_id or not role:
            continue
        grouped[district_id][role] = row
    return grouped


def _ensure_market_user(db: Session, phone: str, role: str) -> tuple[MarketUser, bool]:
    normalized_phone = normalize_ugandan_phone(phone)
    user = db.query(MarketUser).filter(MarketUser.phone == normalized_phone).first()
    if user:
        changed = False
        if role and user.role != role:
            user.role = role
            changed = True
        if user.verification_status != "verified":
            user.verification_status = "verified"
            changed = True
        return user, changed

    user = MarketUser(
        id=uuid.uuid4().hex,
        phone=normalized_phone,
        role=role,
        verification_status="verified",
        preferred_language=None,
    )
    db.add(user)
    db.flush()
    return user, True


def _ensure_location(db: Session, user_id: str, district: str, parish: str) -> tuple[MarketLocation, bool]:
    location = (
        db.query(MarketLocation)
        .filter(
            MarketLocation.user_id == user_id,
            MarketLocation.district == district,
            MarketLocation.parish == parish,
        )
        .order_by(MarketLocation.id.desc())
        .first()
    )
    if location:
        return location, False

    location = MarketLocation(
        user_id=user_id,
        district=district,
        parish=parish,
        latitude=None,
        longitude=None,
        geometry_wkt=None,
    )
    db.add(location)
    db.flush()
    return location, True


def _ensure_listing(
    db: Session,
    user: MarketUser,
    location: MarketLocation,
    role: str,
    crop: str,
    district_name: str,
    quantity: float,
    unit: str,
    price: float,
    created_at: datetime,
    status: str = "open",
) -> tuple[MarketListing, str]:
    existing = (
        db.query(MarketListing)
        .filter(
            MarketListing.user_id == user.id,
            MarketListing.role == role,
            MarketListing.crop == crop,
            MarketListing.location_id == location.id,
            MarketListing.description.ilike(f"%{SEED_TAG}%"),
        )
        .first()
    )

    description = f"{district_name} {crop} {role} listing {SEED_TAG}"
    media_urls = [f"https://images.agrik.app/{crop.replace(' ', '-')}.jpg"]

    if existing:
        existing.quantity = quantity
        existing.unit = unit
        existing.price = price
        existing.currency = "UGX"
        existing.grade = existing.grade or "standard"
        existing.description = description
        existing.contact_name = existing.contact_name or "AGRIK Market Desk"
        existing.contact_phone = existing.contact_phone or user.phone
        existing.contact_whatsapp = existing.contact_whatsapp or user.phone
        existing.media_urls = media_urls
        existing.availability_start = created_at
        existing.availability_end = created_at + timedelta(days=21)
        existing.status = status
        existing.created_at = created_at
        existing.updated_at = created_at
        return existing, "updated"

    listing = MarketListing(
        user_id=user.id,
        role=role,
        crop=crop,
        quantity=quantity,
        unit=unit,
        price=price,
        currency="UGX",
        grade="standard",
        description=description,
        contact_name="AGRIK Market Desk",
        contact_phone=user.phone,
        contact_whatsapp=user.phone,
        media_urls=media_urls,
        availability_start=created_at,
        availability_end=created_at + timedelta(days=21),
        status=status,
        location_id=location.id,
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(listing)
    db.flush()
    return listing, "created"


def _ensure_offer(
    db: Session,
    listing: MarketListing,
    user: MarketUser,
    price: float,
    quantity: float,
    created_at: datetime,
) -> str:
    existing = (
        db.query(MarketOffer)
        .filter(
            MarketOffer.listing_id == listing.id,
            MarketOffer.user_id == user.id,
        )
        .first()
    )
    if existing:
        existing.price = price
        existing.quantity = quantity
        existing.status = "open"
        existing.created_at = created_at
        return "updated"

    row = MarketOffer(
        listing_id=listing.id,
        user_id=user.id,
        price=price,
        quantity=quantity,
        status="open",
        created_at=created_at,
    )
    db.add(row)
    db.flush()
    return "created"


def _ensure_service(
    db: Session,
    user: MarketUser,
    location: MarketLocation,
    service_type: str,
    district_name: str,
    price: float,
    created_at: datetime,
) -> str:
    existing = (
        db.query(MarketService)
        .filter(
            MarketService.user_id == user.id,
            MarketService.service_type == service_type,
            MarketService.location_id == location.id,
            MarketService.description.ilike(f"%{SEED_TAG}%"),
        )
        .first()
    )

    description = f"{service_type.title()} support for {district_name} producers {SEED_TAG}"
    media_urls = [f"https://images.agrik.app/service-{service_type.replace(' ', '-')}.jpg"]

    if existing:
        existing.description = description
        existing.media_urls = media_urls
        existing.coverage_radius_km = 36.0
        existing.price = price
        existing.currency = "UGX"
        existing.status = "open"
        existing.created_at = created_at
        existing.updated_at = created_at
        return "updated"

    row = MarketService(
        user_id=user.id,
        service_type=service_type,
        description=description,
        media_urls=media_urls,
        coverage_radius_km=36.0,
        price=price,
        currency="UGX",
        status="open",
        location_id=location.id,
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(row)
    db.flush()
    return "created"


def _alert_match_filter(threshold: float | None):
    if threshold is None:
        return MarketAlert.threshold.is_(None)
    return and_(
        MarketAlert.threshold.isnot(None),
        MarketAlert.threshold >= threshold - 0.001,
        MarketAlert.threshold <= threshold + 0.001,
    )


def _ensure_alert(
    db: Session,
    user: MarketUser,
    location: MarketLocation,
    alert_type: str,
    crop: str | None,
    threshold: float | None,
    min_interval_hours: int,
    created_at: datetime,
) -> str:
    existing = (
        db.query(MarketAlert)
        .filter(
            MarketAlert.user_id == user.id,
            MarketAlert.location_id == location.id,
            MarketAlert.alert_type == alert_type,
            MarketAlert.crop == crop,
            _alert_match_filter(threshold),
            MarketAlert.channel == "sms",
        )
        .first()
    )

    if existing:
        existing.threshold = threshold
        existing.active = True
        existing.channel = "sms"
        existing.min_interval_hours = min_interval_hours
        existing.created_at = created_at
        return "updated"

    row = MarketAlert(
        user_id=user.id,
        alert_type=alert_type,
        crop=crop,
        threshold=threshold,
        channel="sms",
        active=True,
        location_id=location.id,
        min_interval_hours=min_interval_hours,
        created_at=created_at,
    )
    db.add(row)
    db.flush()
    return "created"


def _ensure_price(
    db: Session,
    crop: str,
    district_name: str,
    market_name: str,
    price: float,
    captured_at: datetime,
) -> str:
    existing = (
        db.query(MarketPrice)
        .filter(
            MarketPrice.crop == crop,
            MarketPrice.district == district_name,
            MarketPrice.market == market_name,
            MarketPrice.source == SEED_SOURCE,
        )
        .first()
    )

    if existing:
        existing.price = price
        existing.currency = "UGX"
        existing.captured_at = captured_at
        return "updated"

    row = MarketPrice(
        crop=crop,
        market=market_name,
        district=district_name,
        price=price,
        currency="UGX",
        source=SEED_SOURCE,
        captured_at=captured_at,
    )
    db.add(row)
    db.flush()
    return "created"


def _increment(counter: dict[str, int], key: str) -> None:
    counter[key] = counter.get(key, 0) + 1


def _role_to_market_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized in {"buyer", "offtaker", "service_provider", "input_supplier", "farmer"}:
        return normalized
    return "farmer"


def _safe_user(group: dict[str, dict[str, Any]], role: str) -> dict[str, Any] | None:
    row = group.get(role)
    if row:
        return row
    return None


def main() -> None:
    if not INPUT_USERS_PATH.exists():
        raise FileNotFoundError(f"Seed users file not found: {INPUT_USERS_PATH}")

    payload = json.loads(INPUT_USERS_PATH.read_text(encoding="utf-8"))
    users = payload.get("users") or []
    if not isinstance(users, list) or not users:
        raise RuntimeError("No users found in runtime/seeds/test_users_uganda.json")

    anchor = _parse_iso_datetime(_as_text(payload.get("generated_at"))) or _now_utc()
    district_groups = _group_seed_users(users)
    ordered_groups = sorted(
        district_groups.items(),
        key=lambda item: (
            _as_text((_safe_user(item[1], "farmer") or {}).get("district")),
            item[0],
        ),
    )

    created: dict[str, int] = {}
    updated: dict[str, int] = {}
    skipped_districts: list[str] = []
    sampled_districts: list[dict[str, Any]] = []

    db = SessionLocal()
    try:
        for district_index, (district_id, group) in enumerate(ordered_groups):
            farmer = _safe_user(group, "farmer")
            buyer = _safe_user(group, "buyer")
            offtaker = _safe_user(group, "offtaker")
            provider = _safe_user(group, "service_provider")
            supplier = _safe_user(group, "input_supplier")

            if not farmer:
                skipped_districts.append(district_id)
                continue

            district_name = _as_text(farmer.get("district"))
            parish_name = _as_text(farmer.get("parish"))

            base_day = district_index % 12
            base_time = anchor - timedelta(days=base_day, hours=(district_index * 2) % 16)

            farmer_crop = _extract_crop(farmer, district_index)
            demand_crop = _extract_crop(buyer or offtaker or farmer, district_index + 3)
            supply_price = _price_for_crop(farmer_crop, district_index, 1)
            demand_price = _price_for_crop(demand_crop, district_index, 2)

            farmer_user, farmer_changed = _ensure_market_user(db, _as_text(farmer.get("phone")), "farmer")
            if farmer_changed:
                _increment(created, "market_users")

            farmer_location, farmer_location_created = _ensure_location(
                db,
                farmer_user.id,
                district_name,
                parish_name or district_name,
            )
            if farmer_location_created:
                _increment(created, "market_locations")

            seller_listing, seller_state = _ensure_listing(
                db=db,
                user=farmer_user,
                location=farmer_location,
                role="seller",
                crop=farmer_crop,
                district_name=district_name,
                quantity=280.0 + (district_index % 9) * 22.0,
                unit="kg",
                price=supply_price,
                created_at=base_time - timedelta(hours=4),
            )
            _increment(created if seller_state == "created" else updated, "market_listings")

            if buyer:
                buyer_user, buyer_changed = _ensure_market_user(
                    db,
                    _as_text(buyer.get("phone")),
                    _role_to_market_role(_as_text(buyer.get("role"))),
                )
                if buyer_changed:
                    _increment(created, "market_users")
                buyer_location, buyer_loc_created = _ensure_location(
                    db,
                    buyer_user.id,
                    _as_text(buyer.get("district")) or district_name,
                    _as_text(buyer.get("parish")) or parish_name,
                )
                if buyer_loc_created:
                    _increment(created, "market_locations")

                buyer_listing, buyer_listing_state = _ensure_listing(
                    db=db,
                    user=buyer_user,
                    location=buyer_location,
                    role="buyer",
                    crop=demand_crop,
                    district_name=district_name,
                    quantity=320.0 + (district_index % 7) * 18.0,
                    unit="kg",
                    price=demand_price,
                    created_at=base_time - timedelta(hours=2),
                )
                _increment(created if buyer_listing_state == "created" else updated, "market_listings")

                buyer_offer_state = _ensure_offer(
                    db=db,
                    listing=seller_listing,
                    user=buyer_user,
                    price=round(supply_price * 0.98, 2),
                    quantity=120.0 + (district_index % 4) * 25.0,
                    created_at=base_time - timedelta(hours=1),
                )
                _increment(created if buyer_offer_state == "created" else updated, "market_offers")

                # Link another offer path from seller listing into buyer demand listing for richer feed.
                cross_offer_state = _ensure_offer(
                    db=db,
                    listing=buyer_listing,
                    user=farmer_user,
                    price=round(demand_price * 0.97, 2),
                    quantity=90.0 + (district_index % 5) * 16.0,
                    created_at=base_time,
                )
                _increment(created if cross_offer_state == "created" else updated, "market_offers")

            if offtaker:
                offtaker_user, offtaker_changed = _ensure_market_user(
                    db,
                    _as_text(offtaker.get("phone")),
                    _role_to_market_role(_as_text(offtaker.get("role"))),
                )
                if offtaker_changed:
                    _increment(created, "market_users")

                off_offer_state = _ensure_offer(
                    db=db,
                    listing=seller_listing,
                    user=offtaker_user,
                    price=round(supply_price * 1.03, 2),
                    quantity=180.0 + (district_index % 6) * 22.0,
                    created_at=base_time + timedelta(hours=1),
                )
                _increment(created if off_offer_state == "created" else updated, "market_offers")

            service_actors = [
                (provider, SERVICE_TYPES[district_index % len(SERVICE_TYPES)], 56000.0),
                (supplier, "input_supply", 76000.0),
            ]
            for actor, service_type, base_service_price in service_actors:
                if not actor:
                    continue
                actor_user, actor_changed = _ensure_market_user(
                    db,
                    _as_text(actor.get("phone")),
                    _role_to_market_role(_as_text(actor.get("role"))),
                )
                if actor_changed:
                    _increment(created, "market_users")
                actor_location, actor_loc_created = _ensure_location(
                    db,
                    actor_user.id,
                    _as_text(actor.get("district")) or district_name,
                    _as_text(actor.get("parish")) or parish_name,
                )
                if actor_loc_created:
                    _increment(created, "market_locations")

                service_state = _ensure_service(
                    db=db,
                    user=actor_user,
                    location=actor_location,
                    service_type=service_type,
                    district_name=district_name,
                    price=base_service_price + (district_index % 9) * 2500.0,
                    created_at=base_time - timedelta(hours=3),
                )
                _increment(created if service_state == "created" else updated, "market_services")

            price_alert_state = _ensure_alert(
                db=db,
                user=farmer_user,
                location=farmer_location,
                alert_type="price_above",
                crop=farmer_crop,
                threshold=round(supply_price * 1.12, 2),
                min_interval_hours=24,
                created_at=base_time - timedelta(hours=5),
            )
            _increment(created if price_alert_state == "created" else updated, "market_alerts")

            weather_alert_state = _ensure_alert(
                db=db,
                user=farmer_user,
                location=farmer_location,
                alert_type="weather",
                crop=None,
                threshold=18.0 + float(district_index % 8),
                min_interval_hours=12,
                created_at=base_time - timedelta(hours=6),
            )
            _increment(created if weather_alert_state == "created" else updated, "market_alerts")

            market_main = f"{district_name} Central Market"
            market_secondary = f"{district_name} Farm Gate"

            price_state_main = _ensure_price(
                db=db,
                crop=farmer_crop,
                district_name=district_name,
                market_name=market_main,
                price=supply_price,
                captured_at=base_time - timedelta(hours=2),
            )
            _increment(created if price_state_main == "created" else updated, "market_prices")

            price_state_secondary = _ensure_price(
                db=db,
                crop=demand_crop,
                district_name=district_name,
                market_name=market_secondary,
                price=round(demand_price * 1.02, 2),
                captured_at=base_time - timedelta(hours=1),
            )
            _increment(created if price_state_secondary == "created" else updated, "market_prices")

            if len(sampled_districts) < 20:
                sampled_districts.append(
                    {
                        "district_id": district_id,
                        "district": district_name,
                        "parish": parish_name,
                        "supply_crop": farmer_crop,
                        "demand_crop": demand_crop,
                        "supply_price": supply_price,
                        "demand_price": demand_price,
                    }
                )

            db.commit()

        totals = {
            "market_users": db.query(MarketUser).count(),
            "market_locations": db.query(MarketLocation).count(),
            "market_listings": db.query(MarketListing).count(),
            "market_offers": db.query(MarketOffer).count(),
            "market_services": db.query(MarketService).count(),
            "market_alerts": db.query(MarketAlert).count(),
            "market_prices": db.query(MarketPrice).count(),
        }

        output = {
            "generated_at": _now_utc().isoformat(),
            "input_users_path": str(INPUT_USERS_PATH),
            "seed_source": SEED_SOURCE,
            "seed_tag": SEED_TAG,
            "district_groups_in_users_file": len(ordered_groups),
            "districts_seeded": len(ordered_groups) - len(skipped_districts),
            "districts_skipped": skipped_districts,
            "uganda_district_target": TOTAL_UGANDA_DISTRICTS,
            "created": created,
            "updated": updated,
            "totals": totals,
            "sampled_districts": sampled_districts,
        }
        OUTPUT_SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_SUMMARY_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")

        print(f"Seeded market activity from {INPUT_USERS_PATH}")
        print(f"Created: {created}")
        print(f"Updated: {updated}")
        print(f"Totals: {totals}")
        print(f"Summary file: {OUTPUT_SUMMARY_PATH}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
